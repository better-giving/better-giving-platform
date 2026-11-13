import { randomUUID } from "node:crypto";
import { report_error } from "#/errors/report";
import type { IPayout } from "@/referrals";
import type { Alert } from "@/slack";
import { stage } from "../env";
import { aws_monitor } from "../kit/slack";
import { db } from "../pg/db";
import type { DbOrTx } from "../pg/queries/helpers";
import { outstanding_for_party, unrecover_owed } from "../pg/queries/owed";
import {
  commissions_claim,
  commissions_mark_paid,
  commissions_release,
  referrer_payout_put,
} from "../pg/queries/referrer";
import {
  CREDIT_BY_HAND,
  credit_unfunded_commissions,
  type ReferrerParty,
  refunded_in_flight_lines,
} from "../refund/commission";
import { owe_takes_of_dists } from "../refund/takes";
import { net_owed } from "./net-owed";
import { deduct, lock_run, owed_netting_on, undo_deductions } from "./owed-run";
import type { Pay } from "./settle";
import {
  NotFundedError,
  PayRefused,
  payout_total,
  recovered_run_ref,
  transfer_ref,
} from "./transfer";

export interface ISettleReferrer {
  /** referral code, or the npo's `NPO-` referral id */
  id: string;
  pay_min: number;
}

export interface IReferrerRecipient {
  /** wise recipient account id */
  pay_id: number;
  pay: Pay;
}

export type CommissionSettleResult =
  | { status: "none_pending" }
  | { status: "under_minimum"; total: number; minimum: number }
  | { status: "released"; ref: string }
  | { status: "unreleased"; ref: string }
  | { status: "fund_unknown"; ref: string }
  | { status: "unrecorded"; ref: string; transfer_id: string }
  | { status: "paid"; ref: string; total: number; transfer_id: string }
  /** every commission went to what the referrer owes: paid with no transfer */
  | { status: "recovered"; ref: string; total: number }
  | { status: "no_recipient"; total: number };

/** thrown from inside the claim, so its tx rolls back and nothing is claimed */
class NotClaimed extends Error {
  constructor(
    readonly result: Extract<
      CommissionSettleResult,
      { status: "under_minimum" | "no_recipient" }
    >
  ) {
    super(result.status);
  }
}

/**
 * pays a referrer every commission still pending, as `settle_npo_payouts`
 * pays grants: claims them (pending → processing, ref stored) before wise is
 * asked, so a retry or a later run never takes a claimed commission into a
 * second transfer. a
 * transfer that moved no money releases the claim; any other failure leaves it
 * processing for a manual reconcile by ref. with owed deductions on, the
 * claim nets what the referrer owes, as the grant run nets an npo's
 */
export async function settle_referrer_commissions(
  referrer: ISettleReferrer,
  to: IReferrerRecipient | null
): Promise<CommissionSettleResult> {
  const nets = await owed_netting_on();
  const party = party_of(referrer.id);
  let claimed: Awaited<ReturnType<typeof claim>>;
  try {
    claimed = await claim(referrer, to, party, nets);
  } catch (err) {
    if (!(err instanceof NotClaimed)) throw err;
    return err.result;
  }
  if (!claimed) return { status: "none_pending" };
  if (!claimed.send) {
    await owe_takes_of_dists(claimed.commissions.map((c) => c.donation_id));
    return { status: "recovered", ref: claimed.ref, total: claimed.gross };
  }

  const { ref, commissions, gross } = claimed;
  const { total, to: recipient } = claimed.send;
  const ids = commissions.map((c) => c.donation_id);
  const fields = [
    { name: "referrer", value: referrer.id },
    { name: "recipient", value: String(recipient.pay_id) },
    { name: "amount", value: total.toString() },
    { name: "donation_ids", value: ids.join(", ") },
  ];
  const ctx = { referrer: referrer.id, ref, donation_ids: ids };

  let transfer_id: string;
  try {
    transfer_id = String(await recipient.pay(ref, total));
  } catch (err) {
    await error_row(referrer.id, total);
    if (err instanceof NotFundedError) {
      report_error(err.cause, ctx);
      let not_released: string[];
      try {
        // one transaction: a run dying between these would leave the claim
        // released, so no stuck-claim alert, with the referrer rows uncredited
        // or still counting this run's recoveries
        not_released = await db.transaction(async (tx) => {
          if (nets) await lock_referrer_run(tx, referrer.id);
          const released = (await commissions_release(tx, ref)).map(
            (c) => c.donation_id
          );
          if (nets) {
            const now = new Date().toISOString();
            await unrecover_owed(tx, { ...party, ref, now });
          }
          const refunded = ids.filter((id) => !released.includes(id));
          if (refunded.length > 0) await credit_unfunded_commissions(tx, ref);
          return refunded;
        });
      } catch (release_err) {
        report_error(release_err, ctx);
        const why = `the release failed (${String(release_err)})`;
        // unfunded either way, so the referrer rows are owed nothing for it
        const credit = await db
          .transaction((tx) => credit_unfunded_commissions(tx, ref))
          .then(
            () =>
              "any refunded while it was in flight have what their referrer owes for them credited back",
            async (credit_err) => {
              report_error(credit_err, ctx);
              const lines = await refunded_in_flight_lines([ref]).catch((e) => {
                report_error(e, ctx);
                return [];
              });
              return [
                `crediting back what the referrer owes for any refunded while it was in flight failed: ${CREDIT_BY_HAND}`,
                ...lines,
              ].join("\n");
            }
          );
        const reset = nets
          ? `these commissions are safe to reset to pending only with this run's deductions taken back: ${undo_deductions(party, ref)}`
          : "these commissions are safe to reset to pending";
        await alert({
          title: `commission not funded, release failed for ${referrer.id}`,
          body: `the transfer was not funded (${String(err.cause)}) and ${why}; ${reset}. ${credit}. customerTransactionId ${ref}`,
          fields,
        });
        return { status: "unreleased", ref };
      }
      if (err.cause instanceof PayRefused) {
        await alert({
          title: `commission payout refused for ${referrer.id}`,
          body: `${err.cause.message}. no money moved; the commissions are back to pending. customerTransactionId ${ref}`,
          fields,
        });
      }
      if (not_released.length > 0) {
        await alert({
          title: `commission refunded in flight, not funded, ${referrer.id}`,
          body: `these commissions were refunded while their transfer was in flight, and recorded as owed by the referrer; the transfer then failed before funding, so the referrer was never paid them, and what the referrer owes for them is credited back. customerTransactionId ${ref}`,
          fields: [
            ...fields,
            { name: "not_released", value: not_released.join(", ") },
          ],
        });
      }
      return { status: "released", ref };
    }
    report_error(err, ctx);
    const in_flight = await refunded_in_flight_lines([ref]).catch((e) => {
      report_error(e, ctx);
      return [];
    });
    await alert({
      title: `commission funding status unknown for ${referrer.id}`,
      body: [
        `do not reset these commissions to pending or pay them again; reconcile in Wise by customerTransactionId ${ref}`,
        ...(in_flight.length > 0
          ? [
              `refunded while the transfer held them, so recorded as owed by the referrer: once the transfer is confirmed unfunded, ${CREDIT_BY_HAND}`,
              ...in_flight,
            ]
          : []),
        ...(nets
          ? [
              `this claim netted what the referrer owes: any reset to pending needs ${undo_deductions(party, ref)}`,
            ]
          : []),
      ].join("\n"),
      fields,
    });
    return { status: "fund_unknown", ref };
  }

  let paid: string[];
  try {
    paid = await db.transaction(async (tx) => {
      const moved = await commissions_mark_paid(tx, ref);
      const payout: IPayout = {
        // the ref: one transfer, one row, found by its customerTransactionId
        id: ref,
        amount: total,
        date: new Date().toISOString(),
        transfer_id: +transfer_id,
        ...party,
      };
      await referrer_payout_put(tx, payout);
      return moved.map((c) => c.donation_id);
    });
  } catch (err) {
    report_error(err, { ...ctx, transfer_id });
    // the commit may have landed with its reply lost, so the alert says check first
    await alert({
      title: `commission funded, not recorded for ${referrer.id}`,
      body: `do not reset these commissions to pending or pay them again; Wise transfer ${transfer_id} (customerTransactionId ${ref}) was funded. if they are still processing, mark them paid by hand and record the payout at the transfer's amount, ${total}`,
      fields:
        gross === total
          ? fields
          : [...fields, { name: "gross", value: gross.toString() }],
    });
    return { status: "unrecorded", ref, transfer_id };
  }
  // a refund or dispute recorded while a commission was pending owed nothing for it
  await owe_takes_of_dists(paid);
  const unpaid = ids.filter((id) => !paid.includes(id));
  if (unpaid.length > 0) {
    await alert({
      title: `commission paid but refunded in flight, ${referrer.id}`,
      body: `Wise transfer ${transfer_id} (customerTransactionId ${ref}) paid these commissions, but they were refunded while it was in flight: each is recorded as owed by the referrer, recovered from its next commission`,
      fields: [...fields, { name: "refunded", value: unpaid.join(", ") }],
    });
  }
  return { status: "paid", ref, total, transfer_id };
}

/**
 * locks the referrer's pending commissions, nets what it owes against them
 * and claims them under one ref, in one transaction. owing at least their
 * total marks them paid with no transfer and returns no `send`; a net under the
 * minimum, or one with no recipient to send it to, throws `NotClaimed` and
 * claims nothing
 */
async function claim(
  referrer: ISettleReferrer,
  to: IReferrerRecipient | null,
  party: ReferrerParty,
  nets: boolean
) {
  return db.transaction(async (tx) => {
    if (nets) await lock_referrer_run(tx, referrer.id);
    let gross = 0;
    /** set when the claim sends a transfer: the net and who it goes to */
    let send: { total: number; to: IReferrerRecipient } | undefined;
    const claimed = await commissions_claim(
      tx,
      referrer.id,
      async (pending, sp) => {
        // wise moves cents: the minimum, quote and payout row all start from this one figure
        gross = payout_total(pending.map((c) => c.amount));
        // a refund locks the commission, then its owed row; the claim does too
        const owed = nets ? await outstanding_for_party(sp, party) : [];
        const plan = net_owed(gross, owed, referrer.pay_min);
        if (plan.status === "under_minimum") {
          const { net: total, minimum } = plan;
          throw new NotClaimed({ status: "under_minimum", total, minimum });
        }
        const ids = pending.map((c) => c.donation_id);
        let ref: string;
        if (plan.status === "recover_only") {
          ref = recovered_run_ref(referrer.id, ids);
        } else if (to === null) {
          throw new NotClaimed({ status: "no_recipient", total: plan.net });
        } else {
          const key = `referrer-commission:${to.pay_id}`;
          ref = transfer_ref(key, plan.net, ids);
          send = { total: plan.net, to };
        }
        await deduct(sp, party, "commission_run", plan, ref);
        return ref;
      }
    );
    if (!claimed) return undefined;
    if (!send) {
      await commissions_mark_paid(tx, claimed.ref);
      // a payout of $0 under the run's ref, no transfer behind it
      await referrer_payout_put(tx, {
        id: claimed.ref,
        amount: 0,
        date: new Date().toISOString(),
        ...party,
      });
    }
    return { ...claimed, gross, send };
  });
}

const party_of = (id: string): ReferrerParty =>
  id.startsWith("NPO-") ? { referrer_npo: id } : { referrer_user: id };

const lock_referrer_run = (tx: DbOrTx, referrer: string) =>
  lock_run(tx, `commission_run:${referrer}`);

/** the failed attempt, shown in the referrer's payout history; never thrown past the money */
async function error_row(referrer: string, amount: number) {
  try {
    await referrer_payout_put(db, {
      id: randomUUID(),
      amount,
      date: new Date().toISOString(),
      error: "Failed to process commission",
      ...party_of(referrer),
    });
  } catch (err) {
    report_error(err, { referrer });
  }
}

/** an alert that fails to send is reported, never thrown past the money */
async function alert(a: Omit<Alert, "from" | "type">) {
  try {
    await aws_monitor.send_alert({
      ...a,
      type: "ERROR",
      from: `commissions-processor:${stage}`,
    });
  } catch (err) {
    report_error(err, { alert: a.title });
  }
}
