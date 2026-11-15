/**
 * a referrer commission transfer that came back (`funds_refunded`): the
 * referrer was never paid, so what they are owed goes back to where the run
 * found it, and its commissions wait in `returned` until they name a new payout
 * account. for a run that claimed commissions C (gross G = payout_total(C)),
 * withheld R it owed and paid Q it was due back (net N = G - R + Q, the payout
 * row's amount and what wise sent):
 *
 * - payout row: `status` 'returned', which ends polling and makes a second
 *   detection change nothing. amount, date and transfer_id stay, so the
 *   referrer's history still lists it; `v_referrer_payout_ltd` stops counting it.
 * - commissions the run paid and still `paid`: 'returned', ref kept. they count
 *   in `pending_earnings` again. one refunded another way stays as it is.
 * - owed rows: `unrecover_owed` under the run's ref, as the grants return does.
 * - a commission `refunded_loss` while the transfer was in flight: its referrer
 *   was never paid it, so `credit_unfunded_commissions` credits what the gift's
 *   row counts for it back.
 *
 * fail closed: when G recomputed from the run's commissions disagrees with what
 * the ledger says the run sent (N + R - Q), nothing is written and ops is told
 * both figures, again on each poll until it is reconciled.
 *
 * `resend_returned_commissions` puts them back to pending once the referrer's
 * payout account is a different wise recipient from the one that bounced.
 */
import { report_error } from "#/errors/report";
import { db } from "../pg/db";
import type { DbOrTx } from "../pg/queries/helpers";
import { run_netted_usd, unrecover_owed } from "../pg/queries/owed";
import {
  commissions_mark_returned,
  commissions_of_ref_locked,
  type ReferrerPayoutRow,
  referrer_last_return,
  referrer_payout_locked,
  referrer_payout_recipient_fill,
  referrer_payout_referrer,
  referrer_payout_status_set,
  referrer_payouts_to_poll,
  referrer_returned_missing_recipient,
  referrers_with_returned,
  returned_commissions_resend,
} from "../pg/queries/referrer";
import { credit_unfunded_commissions, referrer_of } from "../refund/commission";
import { lock_run } from "./owed-run";
import { payout_cents, payout_total } from "./transfer";
import {
  alert,
  FINAL,
  MONEY_BACK,
  ORDINARY,
  RETURNED,
  RETURNING,
  read_transfer,
  type TransferState,
  WINDOW_DAYS,
} from "./wise-states";

export type CommissionReturnResult =
  | { status: "not_found" }
  /** an earlier detection already took it back */
  | { status: "already_returned" }
  /** marked returned with nothing moved: no commission of it was left paid */
  | { status: "nothing_to_return" }
  | { status: "gross_mismatch"; recomputed: number; ledger: number }
  | { status: "failed" }
  | { status: "returned"; returned: string[]; loss_credited: string[] };

/** takes back the commission run behind payout `id`, whose wise transfer came
 * back: once, in one transaction under the referrer's run lock */
export async function return_commission_payout(
  id: string,
  recipient?: string
): Promise<CommissionReturnResult> {
  let out: { res: CommissionReturnResult; p?: ReferrerPayoutRow };
  try {
    out = await db.transaction(async (tx) => {
      const referrer = await referrer_payout_referrer(tx, id);
      if (referrer === undefined) return { res: { status: "not_found" } };
      await lock_run(tx, `commission_run:${referrer}`);
      const p = await referrer_payout_locked(tx, id);
      if (!p) return { res: { status: "not_found" } };
      if (recipient) await referrer_payout_recipient_fill(tx, id, recipient);
      if (p.status === RETURNED) {
        return { res: { status: "already_returned" } };
      }
      return take_back(tx, p);
    });
  } catch (err) {
    report_error(err, { payout_id: id });
    await alert({
      title: `Commission transfer returned, not recorded: payout ${id}`,
      body: "the transfer's money came back to the Wise balance, but taking the run back failed and nothing was written; the next poll tries again. if it keeps failing, take it back by hand: its commissions to returned and the run's owed deductions undone",
      fields: [{ name: "payout", value: id }],
    });
    return { status: "failed" };
  }
  await announce(out.res, out.p);
  return out.res;
}

async function take_back(
  tx: DbOrTx,
  p: ReferrerPayoutRow
): Promise<{ res: CommissionReturnResult; p: ReferrerPayoutRow }> {
  const party = referrer_of(p);
  const run = (await commissions_of_ref_locked(tx, p.id)).filter(
    (c) => c.status === "paid" || c.status === "refunded_loss"
  );
  const recomputed = payout_total(run.map((c) => c.amount));
  const ledger = p.amount + (await run_netted_usd(tx, party, p.id));
  if (payout_cents([recomputed]) !== payout_cents([ledger])) {
    return { res: { status: "gross_mismatch", recomputed, ledger }, p };
  }
  const returned = (await commissions_mark_returned(tx, p.id)).map(
    (c) => c.donation_id
  );
  const losses = run
    .filter((c) => c.status === "refunded_loss")
    .map((c) => c.donation_id);
  await referrer_payout_status_set(tx, p.id, p.status, RETURNED);
  if (returned.length === 0 && losses.length === 0) {
    return { res: { status: "nothing_to_return" }, p };
  }
  await unrecover_owed(tx, {
    ...party,
    ref: p.id,
    now: new Date().toISOString(),
  });
  if (losses.length > 0) await credit_unfunded_commissions(tx, p.id);
  return {
    res: { status: "returned", returned, loss_credited: losses },
    p,
  };
}

async function announce(
  res: CommissionReturnResult,
  p: ReferrerPayoutRow | undefined
) {
  if (!p) return;
  const who = p.referrer_user ?? p.referrer_npo;
  const base = [
    { name: "referrer", value: String(who) },
    { name: "payout", value: p.id },
    { name: "amount", value: p.amount.toString() },
  ];
  if (res.status === "gross_mismatch") {
    await alert({
      title: `Commission transfer returned, run does not add up: ${who}`,
      body: `payout ${p.id}'s transfer came back, but its commissions total ${res.recomputed} while the ledger says the run's gross was ${res.ledger} (payout amount plus what the run netted). nothing was changed, and each poll says so again until it is reconciled by hand`,
      fields: [
        ...base,
        { name: "recomputed", value: res.recomputed.toString() },
        { name: "ledger", value: res.ledger.toString() },
      ],
    });
    return;
  }
  if (res.status === "nothing_to_return") {
    await alert({
      title: `Commission transfer returned, nothing to return: ${who}`,
      body: `payout ${p.id}'s transfer came back, but no commission of it was left paid, so nothing was returned. check by hand`,
      fields: base,
    });
    return;
  }
  if (res.status !== "returned") return;
  await alert({
    title: `Commission transfer returned for ${who}`,
    body: "the commissions are owed to the referrer again and wait as returned until they name a different payout account, then go out with the next commissions run",
    fields: [
      ...base,
      { name: "donation_ids", value: res.returned.join(", ") },
      ...(res.loss_credited.length > 0
        ? [
            {
              name: "refunded_in_flight_credited",
              value: res.loss_credited.join(", "),
            },
          ]
        : []),
    ],
  });
}

/**
 * asks wise the state of every commission transfer from the last 90 days not
 * yet final and stores it when it changed; money back takes the run back, any
 * other state off the ordinary path is told to ops. a returned run recorded
 * without its recipient has it read off the transfer
 */
export async function poll_commission_returns(state_of: TransferState) {
  const since = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  for (const p of await referrer_payouts_to_poll(since, FINAL)) {
    try {
      const { status: state, recipient } = await read_transfer(
        state_of,
        String(p.transfer_id)
      );
      if (recipient) await referrer_payout_recipient_fill(db, p.id, recipient);
      if (state === p.status) continue;
      if (state === MONEY_BACK) {
        await return_commission_payout(p.id, recipient);
        continue;
      }
      const changed = await referrer_payout_status_set(
        db,
        p.id,
        p.status,
        state
      );
      if (changed && !ORDINARY.has(state)) {
        await alert({
          title: `Wise commission transfer ${state}: ${p.referrer_user ?? p.referrer_npo}`,
          body: RETURNING.has(state)
            ? `Wise is returning this transfer, or may still deliver it: if it reaches ${MONEY_BACK}, the next poll takes the run back by itself. Change nothing by hand`
            : "nothing was changed but the stored state: check the transfer in Wise and settle its commissions by hand if its money moved",
          fields: [
            { name: "payout", value: p.id },
            { name: "state", value: state },
            { name: "was", value: p.status || "(none stored)" },
            { name: "amount", value: p.amount.toString() },
          ],
        });
      }
    } catch (err) {
      report_error(err, { payout_id: p.id });
    }
  }
  try {
    for (const p of await referrer_returned_missing_recipient(since)) {
      try {
        const { recipient } = await read_transfer(
          state_of,
          String(p.transfer_id)
        );
        if (recipient)
          await referrer_payout_recipient_fill(db, p.id, recipient);
      } catch (err) {
        report_error(err, { payout_id: p.id });
      }
    }
  } catch (err) {
    report_error(err);
  }
}

export type CommissionResend =
  | { status: "none" }
  | { status: "resent"; ids: string[] }
  | { status: "held"; reason: string };

/**
 * a referrer's returned commissions go back to pending once the payout
 * account they have now is a different wise recipient from the one that
 * bounced (and one is on record); until then they stay `returned`. a repeat
 * moves nothing. under the referrer's run lock, which the return takes too
 */
export async function resend_returned_commissions(
  referrer: string,
  pay_id: number | undefined
): Promise<CommissionResend> {
  return db.transaction(async (tx): Promise<CommissionResend> => {
    await lock_run(tx, `commission_run:${referrer}`);
    const last = await referrer_last_return(referrer, tx);
    if (!last) return { status: "none" };
    if (pay_id === undefined) {
      return { status: "held", reason: "no payout account" };
    }
    if (last.recipient_id === null) {
      return {
        status: "held",
        reason: "the returned transfer's recipient is not on record",
      };
    }
    if (String(pay_id) === last.recipient_id) {
      return {
        status: "held",
        reason: "the payout account is the one the transfer bounced from",
      };
    }
    const ids = await returned_commissions_resend(tx, referrer);
    return ids.length > 0 ? { status: "resent", ids } : { status: "none" };
  });
}

/** every referrer holding returned commissions is asked to re-send them, with
 * the payout account `pay_id_of` finds for them now; a failure is reported and
 * the commissions stay `returned` for the next run */
export async function resend_all_returned_commissions(
  pay_id_of: (referrer: string) => Promise<number | undefined>
) {
  try {
    for (const referrer of await referrers_with_returned()) {
      try {
        const res = await resend_returned_commissions(
          referrer,
          await pay_id_of(referrer)
        );
        if (res.status !== "resent") continue;
        await alert({
          type: "NOTICE",
          title: `Returned commissions re-sent for ${referrer}`,
          body: "the referrer's payout account is a different recipient from the one that bounced: these commissions are pending again and go out with this run",
          fields: [{ name: "donation_ids", value: res.ids.join(", ") }],
        });
      } catch (err) {
        report_error(err, { referrer });
      }
    }
  } catch (err) {
    report_error(err);
  }
}
