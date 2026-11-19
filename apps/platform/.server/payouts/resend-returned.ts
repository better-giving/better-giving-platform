import { db } from "../pg/db";
import { npo_default_bapp } from "../pg/queries/banking";
import type { DbOrTx } from "../pg/queries/helpers";
import { npo_last_return, returned_payouts_resend } from "../pg/queries/payout";
import { lock_run } from "./owed-run";
import { type HoldCause, return_hold_cause } from "./return-hold";

export interface IReturnHold {
  /** the npo's latest returned, awaiting-repair or bounced settlement: the hold alert dedupes on it */
  settlement_id: string;
  /** `awaiting_repair`: its transfer came back but which payouts it covered
   * is unclear, so nothing is credited yet; `bounced`: wise reports it off
   * the ordinary path and may still deliver it late or refund it */
  status: "returned" | "awaiting_repair" | "bounced";
  /** the settlement's stored wise state: `charged_back` is final, any other bounce may still be delivered or refunded */
  wise_state: string;
  /** what the settlement sent, in usd, and when */
  amount: number;
  date: string;
  reason: string;
}

const REASONS: Record<HoldCause, string> = {
  no_account: "no approved account",
  predates: "the default account predates the returned transfer",
  unrecorded: "the returned transfer's recipient is not on record",
  same: "the default account is the one the transfer bounced from",
};

/**
 * whether the npo's grants are held: its latest transfer came back (returned,
 * or awaiting repair because which payouts are its own is unclear) or bounced
 * and wise has not delivered it (so the next run would pay the same failing
 * account), unless the account the grants run pays (`npo_default_bapp`) is a
 * different wise recipient from the one that transfer paid and was approved or
 * made default since it was sent. an edit to the account that bounced changes
 * neither, so a run would pay it again. a transfer whose recipient is not on
 * record holds too: the poll stores it from wise. keyed on the settlement, not
 * the payouts: refunding or cancelling the returned payouts leaves it held.
 * null when not held
 */
export async function npo_return_hold(
  npo_id: number,
  db_: DbOrTx = db
): Promise<IReturnHold | null> {
  const last = await npo_last_return(npo_id, db_);
  if (!last) return null;
  const of = {
    settlement_id: last.id,
    wise_state: last.status,
    status:
      last.status === "awaiting_repair" || last.status === "returned"
        ? last.status
        : "bounced",
    amount: last.amount,
    date: last.date,
  } as const;
  const pays_to = await npo_default_bapp(npo_id, db_);
  const cause = return_hold_cause(
    last,
    pays_to && {
      id: String(pays_to.id),
      since: pays_to.updated_at ?? pays_to.date_created,
    }
  );
  if (cause) return { ...of, reason: REASONS[cause] };
  return null;
}

export type ResendResult =
  | { status: "none" }
  | { status: "resent"; ids: string[] }
  | { status: "held"; reason: string };

/**
 * an npo's payouts whose transfer came back go out again once its grants are
 * no longer held (`npo_return_hold`); until then they stay `returned`. called
 * when an account is approved or made default, and after a return is taken
 * back; a repeat moves nothing. under the npo's run lock, which
 * `return_settlement` takes too: a return committing between the hold read
 * and the move would otherwise have its fresh `returned` payouts re-sent to
 * the account that bounced them
 */
export async function resend_returned(npo_id: number): Promise<ResendResult> {
  return db.transaction(async (tx): Promise<ResendResult> => {
    await lock_run(tx, `grant_run:npo:${npo_id}`);
    const hold = await npo_return_hold(npo_id, tx);
    if (hold) return { status: "held", reason: hold.reason };
    const ids = await returned_payouts_resend(tx, npo_id);
    return ids.length > 0 ? { status: "resent", ids } : { status: "none" };
  });
}
