import { db } from "../pg/db";
import { npo_default_bapp } from "../pg/queries/banking";
import type { DbOrTx } from "../pg/queries/helpers";
import { npo_last_return, returned_payouts_resend } from "../pg/queries/payout";
import { lock_run } from "./owed-run";

export interface IReturnHold {
  /** the npo's latest returned or awaiting-repair settlement: the hold alert dedupes on it */
  settlement_id: string;
  /** `awaiting_repair`: its transfer came back but which payouts it covered
   * is unclear, so nothing is credited yet */
  status: "returned" | "awaiting_repair";
  /** what the settlement sent, in usd, and when */
  amount: number;
  date: string;
  reason: string;
}

/**
 * whether the npo's grants are held: its latest transfer came back (returned,
 * or awaiting repair of which payouts are its own), and the
 * account the grants run pays (`npo_default_bapp`) was not approved or made
 * default since that transfer was sent, so a run would pay the account that
 * bounced. keyed on the settlement, not the payouts: refunding or cancelling
 * the returned payouts leaves it held. null when not held
 */
export async function npo_return_hold(
  npo_id: number,
  db_: DbOrTx = db
): Promise<IReturnHold | null> {
  const last = await npo_last_return(npo_id, db_);
  if (!last) return null;
  const of = {
    settlement_id: last.id,
    status: last.status === "awaiting_repair" ? "awaiting_repair" : "returned",
    amount: last.amount,
    date: last.date,
  } as const;
  const pays_to = await npo_default_bapp(npo_id, db_);
  if (!pays_to) {
    return { ...of, reason: "no approved account" };
  }
  const since = pays_to.updated_at ?? pays_to.date_created;
  if (Date.parse(since) <= Date.parse(last.date)) {
    return {
      ...of,
      reason: "the default account predates the returned transfer",
    };
  }
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
