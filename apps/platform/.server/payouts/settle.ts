import { report_error } from "#/errors/report";
import type { Alert } from "@/slack";
import { stage } from "../env";
import { aws_monitor } from "../kit/slack";
import { db } from "../pg/db";
import type { DbOrTx } from "../pg/queries/helpers";
import { npo_balance_update, npo_get_locked } from "../pg/queries/npo";
import { outstanding_for_npo, unrecover_owed } from "../pg/queries/owed";
import {
  payouts_in,
  payouts_move,
  payouts_own_loss,
  pending_payouts_locked,
  settlement_put,
} from "../pg/queries/payout";
import { reverse_unfunded_payout_loss } from "../refund/unfunded";
import { net_owed } from "./net-owed";
import { deduct, lock_run, owed_netting_on, undo_deductions } from "./owed-run";
import { type IReturnHold, npo_return_hold } from "./resend-returned";
import {
  NotFundedError,
  PayRefused,
  payout_total,
  recovered_run_ref,
  transfer_ref,
} from "./transfer";

/**
 * wires the money: returns the transfer id once funding was accepted. throws
 * `NotFundedError` only when wise was never asked to fund or refused funding
 * outright; any other throw means the money may have moved.
 */
export type Pay = (ref: string, total: number) => Promise<number | string>;

export type SettleResult =
  | { status: "none_pending" }
  | { status: "under_minimum"; total: number; minimum: number }
  /** a returned transfer holds the npo's payouts: read under the run lock, so
   * a return committing after the cron's eligibility read stops the claim */
  | { status: "held"; hold: IReturnHold }
  | { status: "released"; ref: string }
  | { status: "unreleased"; ref: string }
  | { status: "fund_unknown"; ref: string }
  | { status: "unrecorded"; ref: string; transfer_id: string }
  | { status: "settled"; ref: string; total: number; transfer_id: string }
  /** every payout went to what the npo owes: settled with no transfer */
  | { status: "recovered"; ref: string; total: number }
  | { status: "no_recipient"; total: number };

export interface ISettleNpo {
  id: number;
  name: string;
  /** resolved by the caller: the npo's own minimum or the platform default */
  payout_minimum: number;
}

export interface IRecipient {
  /** names the recipient; the ref binds it with the claimed set and total */
  ref_key: string;
  pay: Pay;
}

/** `to` is null for an npo with no recipient: only a run that sends nothing
 * settles */
export async function settle_npo_payouts(
  npo: ISettleNpo,
  payout_ids: string[],
  to: IRecipient | null
): Promise<SettleResult> {
  const nets = await owed_netting_on();
  const claim = await db.transaction(async (tx) => {
    // the lock `return_settlement` and `resend_returned` take: the hold read
    // and the claim below happen with no return or re-send in between
    await lock_npo_run(tx, npo.id);
    const hold = await npo_return_hold(npo.id, tx);
    if (hold) return { status: "held", hold } as const;
    const locked = await pending_payouts_locked(tx, payout_ids);
    if (locked.length === 0) return { status: "none_pending" } as const;
    // a refund locks payout, then npo, then owed row; the claim does too
    if (nets) await npo_get_locked(tx, npo.id);
    // wise moves cents: the minimum, quote and cash debit all start from this one figure
    const gross = payout_total(locked.map((p) => p.amount));
    const owed = nets ? await outstanding_for_npo(tx, npo.id) : [];
    const plan = net_owed(gross, owed, npo.payout_minimum);
    if (plan.status === "under_minimum") {
      const { net: total, minimum } = plan;
      return { status: "under_minimum", total, minimum } as const;
    }
    const ids = locked.map((p) => p.id);
    if (plan.status === "recover_only") {
      const ref = recovered_run_ref(npo.id, ids);
      await deduct(tx, { npo_id: npo.id }, "grant_run", plan, ref);
      await settle_recovered(tx, npo.id, locked, gross, ref);
      return { status: "recovered", ref, total: gross } as const;
    }
    const total = plan.net;
    if (to === null) return { status: "no_recipient", total } as const;
    // stored with the claim: a run that dies past here leaves only the rows to reconcile by
    const ref = transfer_ref(to.ref_key, total, ids);
    await deduct(tx, { npo_id: npo.id }, "grant_run", plan, ref);
    await payouts_move(tx, ids, "pending", { type: "processing", ref });
    return {
      status: "claimed",
      payouts: locked,
      ids,
      gross,
      total,
      ref,
      to,
    } as const;
  });
  if (claim.status !== "claimed") return claim;
  const { payouts: claimed, ids, gross, total, ref, to: recipient } = claim;

  const fields = [
    { name: "npo", value: `${npo.id}: ${npo.name}` },
    { name: "recipient", value: recipient.ref_key },
    { name: "amount", value: total.toString() },
    { name: "payout_ids", value: ids.join(", ") },
  ];

  let transfer_id: string;
  try {
    transfer_id = String(await recipient.pay(ref, total));
  } catch (err) {
    const ctx = { npo_id: npo.id, ref, payout_ids: ids };
    if (err instanceof NotFundedError) {
      let released: IRelease;
      try {
        released = await db.transaction((tx) =>
          release(tx, ids, nets ? { npo_id: npo.id, ref } : undefined)
        );
      } catch (release_err) {
        report_error(err.cause, ctx);
        report_error(release_err, ctx);
        const reset = nets
          ? `these payouts are safe to reset to pending only with this run's deductions taken back: ${undo_deductions({ npo_id: npo.id }, ref)}`
          : "these payouts are safe to reset to pending";
        await alert({
          title: `not funded, release failed for npo:${npo.id}`,
          body: `the transfer was not funded (${String(err.cause)}); ${reset}. customerTransactionId ${ref}`,
          fields,
        });
        return { status: "unreleased", ref };
      }
      const { not_released, kept } = released;
      report_error(err.cause, {
        ...ctx,
        ...(not_released.length > 0 && { not_released }),
      });
      if (err.cause instanceof PayRefused) {
        await alert({
          title: `payout refused for npo:${npo.id}`,
          body: `${err.cause.message}. no money moved; the payouts are back to pending. customerTransactionId ${ref}`,
          fields,
        });
      }
      // ops undoes a refund from before the owed ledger another way
      for (const pre_ledger of [true, false]) {
        const payouts = kept.filter((k) => k.pre_ledger === pre_ledger);
        if (payouts.length === 0) continue;
        await alert({
          title: `refunded ${pre_ledger ? "as a loss" : "as owed"} but never paid, npo:${npo.id}`,
          body: pre_ledger
            ? `these payouts were loss-refunded while their transfer was in flight, and the transfer failed before funding. the loss could not be reversed automatically, so the npo's cash still carries them and their loss log records a loss that did not happen: debit the cash or reverse the loss log. customerTransactionId ${ref}`
            : `these payouts were refunded while their transfer was in flight, and the transfer failed before funding, so the npo was never paid them. the refund could not be redone as if they were pending, so the npo's cash still carries each one's cash share and the gift's owed row stays, still counting it: debit the npo's cash by each one's cash share, then credit that amount on the gift's owed row. customerTransactionId ${ref}`,
          fields: [
            ...fields,
            {
              name: "not_reversed",
              value: payouts.map((k) => `${k.id}: ${k.reason}`).join("\n"),
            },
          ],
        });
      }
      return { status: "released", ref };
    }
    report_error(err, ctx);
    await alert({
      title: `funding status unknown for npo:${npo.id}`,
      body: `do not reset these payouts to pending or pay them again; reconcile in Wise by customerTransactionId ${ref}`,
      fields,
    });
    return { status: "fund_unknown", ref };
  }

  const date = new Date().toISOString();
  let unsettled: string[];
  try {
    unsettled = await db.transaction(async (tx) => {
      // before the payouts: their settled_id references it
      await settlement_put(tx, {
        id: transfer_id,
        other_id: ref,
        npo_id: npo.id,
        date,
        amount: total,
        sources: claimed.map((p) => p.source_id),
        status: "",
      });
      const settled = await payouts_move(tx, ids, "processing", {
        type: "settled",
        settled_date: date,
        settled_id: transfer_id,
      });
      await npo_balance_update(
        tx,
        npo.id,
        { liq: 0, lock: 0, lock_units: 0, cash: gross },
        "dec"
      );
      // a loss refund may take a payout in flight; the npo keeps that money
      const moved_on = ids.filter((id) => !settled.includes(id));
      const loss_refunded = await payouts_in(tx, moved_on, "refunded_loss");
      // the run owns them too: a return finds its payouts by `settled_id`, and
      // a copy of the run sharing its sources must never take them
      await payouts_own_loss(tx, loss_refunded, transfer_id);
      return moved_on.filter((id) => !loss_refunded.includes(id));
    });
  } catch (err) {
    report_error(err, {
      npo_id: npo.id,
      ref,
      transfer_id,
      payout_ids: ids,
    });
    // the commit may have landed with its reply lost, so the alert says check first
    await alert({
      title: `funded, not recorded for npo:${npo.id}`,
      body: `do not reset these payouts to pending or pay them again; Wise transfer ${transfer_id} (customerTransactionId ${ref}) was funded. if the payouts are still processing, record the settlement by hand: its settlement amount is the net, ${total}; debit the npo's cash by the gross, ${gross}`,
      fields: [...fields, { name: "gross", value: gross.toString() }],
    });
    return { status: "unrecorded", ref, transfer_id };
  }
  if (unsettled.length > 0) {
    await alert({
      title: `paid but not marked settled, npo:${npo.id}`,
      body: `Wise transfer ${transfer_id} (customerTransactionId ${ref}) paid these payouts and is recorded, but they had already moved out of processing by a path other than a loss refund, so they were not marked settled. check each before the next run: one back in pending is paid again`,
      fields: [...fields, { name: "unsettled", value: unsettled.join(", ") }],
    });
  }
  return { status: "settled", ref, total, transfer_id };
}

/** a settlement of $0 under the run's ref, no transfer behind it */
async function settle_recovered(
  tx: DbOrTx,
  npo_id: number,
  payouts: { id: string; source_id: string }[],
  gross: number,
  ref: string
) {
  const date = new Date().toISOString();
  await settlement_put(tx, {
    id: ref,
    other_id: null,
    npo_id,
    date,
    amount: 0,
    sources: payouts.map((p) => p.source_id),
    status: "",
  });
  const ids = payouts.map((p) => p.id);
  await payouts_move(tx, ids, "pending", {
    type: "settled",
    settled_date: date,
    settled_id: ref,
  });
  await npo_balance_update(
    tx,
    npo_id,
    { liq: 0, lock: 0, lock_units: 0, cash: gross },
    "dec"
  );
}

interface IRelease {
  not_released: string[];
  /** refunded in flight and not reversed, so what the npo owes (or, for a
   * refund recorded before the owed ledger, its loss log) still counts a payout
   * the npo was never paid */
  kept: { id: string; reason: string; pre_ledger: boolean }[];
}

/**
 * back to pending, for a transfer that was never funded. one loss-refunded
 * while in flight is refunded as if it had been pending; each in its own
 * savepoint, so one that fails leaves the others and the release standing.
 * `run` names a claim that netted what the npo owes: its deductions are
 * undone with it, or the release fails whole and the payouts stay claimed
 */
async function release(
  tx: DbOrTx,
  ids: string[],
  run?: { npo_id: number; ref: string }
): Promise<IRelease> {
  if (run) await lock_npo_run(tx, run.npo_id);
  const released = await payouts_move(tx, ids, "processing", {
    type: "pending",
  });
  if (run) {
    // payout, then npo, then owed row: the order a refund locks them in
    await npo_get_locked(tx, run.npo_id);
    await unrecover_owed(tx, { ...run, now: new Date().toISOString() });
  }
  const not_released = ids.filter((id) => !released.includes(id));
  const kept: IRelease["kept"] = [];
  for (const id of await payouts_in(tx, not_released, "refunded_loss")) {
    try {
      const r = await tx.transaction((sp) =>
        reverse_unfunded_payout_loss(sp, id)
      );
      if (r.status === "kept") {
        kept.push({ id, reason: r.reason, pre_ledger: r.pre_ledger === true });
      }
    } catch (err) {
      report_error(err, { payout_id: id });
      kept.push({ id, reason: String(err), pre_ledger: false });
    }
  }
  return { not_released, kept };
}

const lock_npo_run = (tx: DbOrTx, npo_id: number) =>
  lock_run(tx, `grant_run:npo:${npo_id}`);

/** an alert that fails to send is reported, never thrown past the money */
async function alert(a: Omit<Alert, "from" | "type">) {
  try {
    await aws_monitor.send_alert({
      ...a,
      type: "ERROR",
      from: `grants-processor:${stage}`,
    });
  } catch (err) {
    report_error(err, { alert: a.title });
  }
}
