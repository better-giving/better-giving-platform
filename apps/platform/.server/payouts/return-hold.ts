/**
 * the one rule behind a return hold, for grants (`npo_return_hold`) and
 * referrer commissions (`resend_returned_commissions`, the commissions run):
 * after a transfer came back, payouts stay held unless the account they would
 * go to now is a different wise recipient from the one that bounced and was
 * approved or made default after the transfer was sent. so the callers keep
 * their own wording for each cause and cannot drift on the rule
 */
export type HoldCause =
  /** nothing to pay */
  | "no_account"
  /** approved or made default no later than the transfer */
  | "predates"
  /** the returned transfer's recipient was never stored */
  | "unrecorded"
  /** the account that bounced, edited or approved again */
  | "same";

export function return_hold_cause(
  last: { date: string; recipient_id: string | null },
  pays_to: { id: string; since?: string } | undefined
): HoldCause | null {
  if (!pays_to) return "no_account";
  // no `since`: a payout account the holder names themselves carries no
  // approval time, and a recipient that differs from the one paid was named
  // after the transfer by construction
  if (pays_to.since && Date.parse(pays_to.since) <= Date.parse(last.date)) {
    return "predates";
  }
  if (last.recipient_id === null) return "unrecorded";
  if (pays_to.id === last.recipient_id) return "same";
  return null;
}
