import { db } from "../pg/db";
import { npo_default_bapp } from "../pg/queries/banking";
import { npo_last_return, returned_payouts_resend } from "../pg/queries/payout";

export interface IReturnHold {
  /** the npo's latest returned settlement: the hold alert dedupes on it */
  settlement_id: string;
  reason: string;
}

/**
 * whether the npo's grants are held: its latest transfer came back, and the
 * account the grants run pays (`npo_default_bapp`) was not approved or made
 * default since that transfer was sent, so a run would pay the account that
 * bounced. keyed on the settlement, not the payouts: refunding or cancelling
 * the returned payouts leaves it held. null when not held
 */
export async function npo_return_hold(
  npo_id: number
): Promise<IReturnHold | null> {
  const last = await npo_last_return(npo_id);
  if (!last) return null;
  const pays_to = await npo_default_bapp(npo_id);
  if (!pays_to) {
    return { settlement_id: last.id, reason: "no approved account" };
  }
  const since = pays_to.updated_at ?? pays_to.date_created;
  if (Date.parse(since) <= Date.parse(last.date)) {
    return {
      settlement_id: last.id,
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
 * when an account is approved or made default; a repeat moves nothing
 */
export async function resend_returned(npo_id: number): Promise<ResendResult> {
  const hold = await npo_return_hold(npo_id);
  if (hold) return { status: "held", reason: hold.reason };
  const ids = await returned_payouts_resend(db, npo_id);
  return ids.length > 0 ? { status: "resent", ids } : { status: "none" };
}
