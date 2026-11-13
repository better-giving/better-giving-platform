import { db } from "../pg/db";
import { npo_default_bapp } from "../pg/queries/banking";
import {
  npo_last_return_sent,
  npo_returned_payouts,
  returned_payouts_resend,
} from "../pg/queries/payout";

export type ResendResult =
  | { status: "none" }
  | { status: "resent"; ids: string[] }
  | { status: "held"; reason: string };

/**
 * an npo's payouts whose transfer came back go out again once it has a new
 * account to pay: the account the grants run pays (`npo_default_bapp`) was
 * approved or made default after the returned transfer was sent. until then
 * they stay `returned`, and the grants run holds the npo. called when an
 * account is approved or made default; a repeat moves nothing
 */
export async function resend_returned(npo_id: number): Promise<ResendResult> {
  if (!(await npo_returned_payouts(npo_id))) return { status: "none" };
  const pays_to = await npo_default_bapp(npo_id);
  if (!pays_to) return { status: "held", reason: "no approved account" };
  const sent = await npo_last_return_sent(npo_id);
  const since = pays_to.updated_at ?? pays_to.date_created;
  if (sent !== null && Date.parse(since) <= Date.parse(sent)) {
    return {
      status: "held",
      reason: "the default account predates the returned transfer",
    };
  }
  const ids = await returned_payouts_resend(db, npo_id);
  return ids.length > 0 ? { status: "resent", ids } : { status: "none" };
}
