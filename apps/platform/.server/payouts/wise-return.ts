/**
 * a grants run's wise transfer that came back (`funds_refunded`): the npo was
 * never paid, so its books go back to where the run found them, and its
 * payouts wait in `returned` until its grants are no longer held
 * (`./resend-returned`, asked again once the return commits, for an account
 * that changed while the transfer was out). what each record becomes, for a
 * run that claimed payouts P (gross G = payout_total(P)), withheld R it owed
 * and paid Q it was due back (net N = G - R + Q, the settlement's amount and what wise sent):
 *
 * - settlement: `status` 'returned', which ends polling and makes a second
 *   detection change nothing. amount, date and sources stay, so the grants page
 *   still lists it.
 * - payouts the run settled and still `settled`: 'returned'. `settled_id` and
 *   `settled_date` stay, naming the run that returned them. one moved on any
 *   other way (reset by hand, voided) is left as it is and named to ops.
 * - npo cash: credited payout_total of the payouts this transaction takes back:
 *   the ones it moves to 'returned' and the run's loss-refunded ones, so G
 *   when nothing moved on. never a figure read off the settlement alone.
 * - owed rows: `unrecover_owed` under the run's ref: each recovery taken back
 *   (the row owes it again) and each due-back payment taken back (the row is
 *   due it again), as entries under `unfunded:<ref>`, which owed history
 *   pairs off with the run's own.
 * - a payout of the run `refunded_loss`, in flight or
 *   after it settled (an older run's, with no `settled_id`, counts when no
 *   other settlement lists it; else the return waits, see
 *   `ownership_unclear`): its refund found the grant gone and recorded the cash
 *   share as owed (dist `refund_status` 'loss', donation 'refunded_loss'). the
 *   cash is back, so with the credit above the npo holds it as if the payout
 *   were pending, and `reverse_unfunded_payout_loss` redoes the refund that
 *   way: payout 'refunded'; a dist that can reverse in full takes the cash
 *   share (and any savings share) from the npo's balances, credits the owed
 *   row back under `transfer_unfunded`, and its dist goes 'completed' and its
 *   donation 'refunded'; one that can't (invested, savings short) has its cash
 *   share taken from cash and credited on the owed row as `payout_cancelled`,
 *   the rest still owed.
 * - loss_logs: untouched. a refund from before the owed ledger left a loss log
 *   and no owed row: it is kept, its cash stays credited, and ops is told to
 *   debit it or reverse the loss log.
 * - wise's fee came back with the transfer and was never the npo's.
 *
 * fail closed: when G recomputed from the run's payouts disagrees with what
 * the ledger says the run sent (N + R - Q), nothing is written and ops is
 * told both figures, again on each poll until it is reconciled.
 */
import { report_error } from "#/errors/report";
import type { Alert } from "@/slack";
import { stage } from "../env";
import { aws_monitor } from "../kit/slack";
import { db } from "../pg/db";
import type { DbOrTx } from "../pg/queries/helpers";
import { npo_balance_update, npo_get_locked } from "../pg/queries/npo";
import { run_netted_usd, unrecover_owed } from "../pg/queries/owed";
import {
  legacy_losses_locked,
  payouts_move,
  payouts_own_loss,
  run_payouts_locked,
  type SettlementRow,
  settlement_locked,
  settlement_npo_id,
  settlement_status_set,
  settlements_to_poll,
} from "../pg/queries/payout";
import { reverse_unfunded_payout_loss } from "../refund/unfunded";
import { lock_run } from "./owed-run";
import { resend_returned } from "./resend-returned";
import { payout_cents, payout_total } from "./transfer";

/** the state a settlement takes once its money is back in the npo's books */
export const RETURNED = "returned";
/** its transfer came back but which payouts are its own can't be decided: not
 * final, so polling goes on, and nothing is credited until ops repairs it */
export const AWAITING_REPAIR = "awaiting_repair";

export type ReturnResult =
  | { status: "not_found" }
  /** an earlier detection already took it back */
  | { status: "already_returned" }
  /** marked returned with nothing credited: no payout of it was left to take back */
  | { status: "nothing_to_return" }
  | { status: "gross_mismatch"; recomputed: number; ledger: number }
  /** loss-refunded payouts of the run carry no owner and another settlement
   * lists them too: nothing written but the state; `first` is false on every
   * poll after the one that told ops */
  | { status: "ownership_unclear"; first: boolean }
  /** nothing written; reported and told to ops */
  | { status: "failed" }
  | {
      status: "returned";
      credited: number;
      returned: string[];
      loss_reversed: string[];
      moved_on: string[];
      kept: IKept[];
    };

interface IKept {
  id: string;
  reason: string;
  pre_ledger: boolean;
}

/**
 * takes back the run behind settlement `id`, whose wise transfer came back:
 * once, in one transaction. locks as `release()` in ./settle does, with the
 * settlement added (only this locks it): the npo's run lock, the settlement,
 * the payouts, the npo, the owed rows
 */
export async function return_settlement(id: string): Promise<ReturnResult> {
  let out: { res: ReturnResult; s?: SettlementRow; npo_name?: string };
  try {
    out = await db.transaction(async (tx) => {
      const npo_id = await settlement_npo_id(tx, id);
      if (npo_id === undefined) return { res: { status: "not_found" } };
      if (npo_id !== null) await lock_run(tx, `grant_run:npo:${npo_id}`);
      const s = await settlement_locked(tx, id);
      if (!s) return { res: { status: "not_found" } };
      if (s.status === RETURNED) return { res: { status: "already_returned" } };
      return take_back(tx, s);
    });
  } catch (err) {
    report_error(err, { settlement_id: id });
    await alert({
      title: `Wise transfer returned, not recorded: settlement ${id}`,
      body: "the transfer's money came back to the Wise balance, but taking the run back failed and nothing was written; the next poll tries again. if it keeps failing, take it back by hand: its payouts to returned, the npo's cash credited by their gross, and the run's owed deductions undone",
      fields: [{ name: "settlement", value: id }],
    });
    return { status: "failed" };
  }
  await announce(out.res, out.s, out.npo_name);
  if (out.res.status === "returned" && out.s?.npo_id != null) {
    await resend_after_return(out.s.npo_id);
  }
  return out.res;
}

/** an account approved or made default after the transfer was sent found
 * nothing returned to re-send then, so the payouts just returned go out
 * again now unless the npo is held. reported, never thrown past the return
 * that already committed */
async function resend_after_return(npo_id: number) {
  try {
    const res = await resend_returned(npo_id);
    if (res.status !== "resent") return;
    await alert({
      type: "NOTICE",
      title: `Returned payouts re-sent for npo:${npo_id}`,
      body: "the npo's account that grants pay was approved or made default after the returned transfer was sent: these payouts are pending again and go out with the next grants run",
      fields: [{ name: "payout_ids", value: res.ids.join(", ") }],
    });
  } catch (err) {
    report_error(err, { npo_id });
  }
}

async function take_back(
  tx: DbOrTx,
  s: SettlementRow
): Promise<{ res: ReturnResult; s: SettlementRow; npo_name?: string }> {
  const owned = await run_payouts_locked(tx, s);
  // a run recorded before the settle stamped loss-refunded payouts in flight
  // has some with no owner. they are this run's when no other settlement lists
  // them, and not decidable when one does: never credit those
  const legacy = await legacy_losses_locked(tx, s);
  if (legacy.shared) {
    const first = s.status !== AWAITING_REPAIR;
    if (first) await settlement_status_set(tx, s.id, s.status, AWAITING_REPAIR);
    return { res: { status: "ownership_unclear", first }, s };
  }
  const run = [...owned, ...legacy.rows];
  // `settled_id` names one settlement: a second one sharing these sources
  // (a run sent again by hand) owns no payout, and taking any back would
  // credit the npo twice. the settle stamps it on every payout of the run,
  // those a refund took in flight included
  const npo_id = s.npo_id;
  if (npo_id === null || run.length === 0) {
    await settlement_status_set(tx, s.id, s.status, RETURNED);
    return { res: { status: "nothing_to_return" }, s };
  }
  const recomputed = payout_total(run.map((p) => p.amount));
  const ledger =
    s.other_id === null
      ? s.amount
      : s.amount + (await run_netted_usd(tx, { npo_id }, s.other_id));
  if (payout_cents([recomputed]) !== payout_cents([ledger])) {
    return { res: { status: "gross_mismatch", recomputed, ledger }, s };
  }

  // reconciled: the unowned ones are this run's, once and for all
  await payouts_own_loss(
    tx,
    legacy.rows.map((p) => p.id),
    s.id
  );
  const settled = run.filter((p) => p.type === "settled").map((p) => p.id);
  const returned = await payouts_move(tx, settled, "settled", {
    type: "returned",
  });
  const losses = run.filter((p) => p.type === "refunded_loss").map((p) => p.id);
  const taken = new Set([...returned, ...losses]);
  const moved_on = run.map((p) => p.id).filter((id) => !taken.has(id));
  await settlement_status_set(tx, s.id, s.status, RETURNED);
  if (taken.size === 0) return { res: { status: "nothing_to_return" }, s };

  const npo = await npo_get_locked(tx, npo_id);
  const credited = payout_total(
    run.filter((p) => taken.has(p.id)).map((p) => p.amount)
  );
  // before the loss reversals: each expects the npo to hold its cash share
  await npo_balance_update(
    tx,
    npo_id,
    { liq: 0, lock: 0, lock_units: 0, cash: credited },
    "inc"
  );
  if (s.other_id !== null) {
    await unrecover_owed(tx, {
      npo_id,
      ref: s.other_id,
      now: new Date().toISOString(),
    });
  }
  const kept: IKept[] = [];
  const loss_reversed: string[] = [];
  for (const id of losses) {
    try {
      const r = await tx.transaction((sp) =>
        reverse_unfunded_payout_loss(sp, id)
      );
      if (r.status === "kept") {
        kept.push({ id, reason: r.reason, pre_ledger: r.pre_ledger === true });
      } else loss_reversed.push(id);
    } catch (err) {
      report_error(err, { payout_id: id, settlement_id: s.id });
      kept.push({ id, reason: String(err), pre_ledger: false });
    }
  }
  return {
    res: {
      status: "returned",
      credited,
      returned,
      loss_reversed,
      moved_on,
      kept,
    },
    s,
    npo_name: npo?.name,
  };
}

async function announce(
  res: ReturnResult,
  s: SettlementRow | undefined,
  npo_name: string | undefined
) {
  if (!s) return;
  const npo = `${s.npo_id}${npo_name ? `: ${npo_name}` : ""}`;
  const base = [
    { name: "npo", value: npo },
    { name: "settlement", value: s.id },
  ];
  if (res.status === "gross_mismatch") {
    await alert({
      title: `Wise transfer returned, run does not add up: npo:${s.npo_id}`,
      body: `settlement ${s.id}'s transfer came back, but its payouts total ${res.recomputed} while the ledger says the run's gross was ${res.ledger} (settlement amount plus what the run netted under ref ${s.other_id}). nothing was changed, and each poll says so again until it is reconciled by hand`,
      fields: [
        ...base,
        { name: "recomputed", value: res.recomputed.toString() },
        { name: "ledger", value: res.ledger.toString() },
      ],
    });
    return;
  }
  if (res.status === "ownership_unclear") {
    if (!res.first) return;
    await alert({
      title: `Wise transfer returned, payouts' owner unclear: npo:${s.npo_id}`,
      body: `settlement ${s.id}'s transfer came back, but loss-refunded payouts listed in its sources carry no settlement and another settlement lists them too, so which run owns them can't be told. nothing was credited; the settlement is marked ${AWAITING_REPAIR} and each poll tries again. if this is the transfer that paid them, stamp settled_id on those payouts by hand; a hand-sent copy of another run owns none, so leave it`,
      fields: base,
    });
    return;
  }
  if (res.status === "nothing_to_return") {
    await alert({
      title: `Wise transfer returned, nothing to return: npo:${s.npo_id}`,
      body: `settlement ${s.id}'s transfer came back, but no payout of it was left to take back (already returned, moved on, or this settlement owns none), so the npo was credited nothing. check by hand`,
      fields: [...base, { name: "amount", value: s.amount.toString() }],
    });
    return;
  }
  if (res.status !== "returned") return;
  const ids = (xs: string[]) => xs.join(", ");
  await alert({
    title: `Wise transfer returned for npo:${s.npo_id}`,
    body: "the npo's cash is credited back and its payouts wait as returned until a newer approved account is the one grants pay, then go out with the next grants run (at once, if that account was already approved or made default while the transfer was out)",
    fields: [
      ...base,
      { name: "amount", value: res.credited.toString() },
      { name: "payout_ids", value: ids(res.returned) },
      ...(res.loss_reversed.length > 0
        ? [{ name: "loss_refund_reversed", value: ids(res.loss_reversed) }]
        : []),
      ...(res.moved_on.length > 0
        ? [{ name: "moved_on_not_credited", value: ids(res.moved_on) }]
        : []),
    ],
  });
  for (const pre_ledger of [true, false]) {
    const kept = res.kept.filter((k) => k.pre_ledger === pre_ledger);
    if (kept.length === 0) continue;
    await alert({
      title: `Wise transfer returned with a loss refund not reversed, npo:${s.npo_id}`,
      body: pre_ledger
        ? `these payouts were loss-refunded, and their transfer came back. the loss could not be reversed automatically, so the npo's cash now carries them and their loss log records a loss that did not happen: debit the cash or reverse the loss log. settlement ${s.id}`
        : `these payouts were refunded as owed, and their transfer came back. the refund could not be redone as if they were pending, so the npo's cash now carries each one's cash share and the gift's owed row still counts it: debit the npo's cash by each one's cash share, then credit that amount on the gift's owed row. settlement ${s.id}`,
      fields: [
        ...base,
        {
          name: "not_reversed",
          value: kept.map((k) => `${k.id}: ${k.reason}`).join("\n"),
        },
      ],
    });
  }
}

/** a transfer's wise state by its id */
export type TransferState = (transfer_id: number) => Promise<string>;

/** stored states nothing polls again: ours once the money is back, and
 * `charged_back`. not `cancelled`: every polled transfer was funded, and a
 * funded one passes through `cancelled` on its way to `funds_refunded` */
const FINAL = [RETURNED, "charged_back"] as const;
const WINDOW_DAYS = 90;

/**
 * wise's transfer states (https://docs.wise.com/guides/product/send-money/tracking-transfers).
 * `bounced_back` is not the money back: wise may still deliver it late or move
 * it on to `funds_refunded`, which alone is taken back
 */
const ORDINARY: ReadonlySet<string> = new Set([
  "incoming_payment_waiting",
  "incoming_payment_initiated",
  "processing",
  "funds_converted",
  "outgoing_payment_sent",
]);
const MONEY_BACK = "funds_refunded";
/** off the ordinary path and possibly on to `MONEY_BACK`, where the poll takes
 * the run back by itself: settling the payouts by hand too would count the
 * money twice */
const RETURNING: ReadonlySet<string> = new Set(["bounced_back", "cancelled"]);

/**
 * asks wise the state of every grants-run transfer from the last 90 days not
 * yet final, and stores it on its settlement when it changed: the stored state
 * is what makes each change act and alert once. money back takes the run back
 * (`return_settlement`); any other state off the ordinary path is told to ops
 */
export async function poll_wise_returns(state_of: TransferState) {
  const since = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  for (const s of await settlements_to_poll(since, FINAL)) {
    try {
      const state = await state_of(Number(s.id));
      if (state === s.status) continue;
      if (state === MONEY_BACK) {
        await return_settlement(s.id);
        continue;
      }
      const changed = await settlement_status_set(db, s.id, s.status, state);
      if (changed && !ORDINARY.has(state)) {
        await alert({
          title: `Wise transfer ${state}: npo:${s.npo_id}`,
          body: RETURNING.has(state)
            ? `Wise is returning this transfer, or may still deliver it: if it reaches ${MONEY_BACK}, the next poll takes the run back by itself. Change nothing by hand`
            : `nothing was changed but the stored state: check the transfer in Wise and settle its payouts by hand if its money moved`,
          fields: [
            { name: "settlement", value: s.id },
            { name: "state", value: state },
            { name: "was", value: s.status || "(none stored)" },
            { name: "amount", value: s.amount.toString() },
          ],
        });
      }
    } catch (err) {
      report_error(err, { settlement_id: s.id });
    }
  }
}

/** an alert that fails to send is reported, never thrown past the money;
 * an `ERROR` unless `type` says otherwise */
export async function alert(a: Omit<Alert, "from">) {
  try {
    await aws_monitor.send_alert({
      type: "ERROR",
      ...a,
      from: `wise-returns:${stage}`,
    });
  } catch (err) {
    report_error(err, { alert: a.title });
  }
}
