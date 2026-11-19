/**
 * wise's transfer states (https://docs.wise.com/guides/product/send-money/tracking-transfers)
 * as a payout's settlement is read: on the ordinary path, delivered, bounced.
 * isomorphic so the query layer, the poll and the grants page share one reading
 */

/** funded and on its way, up to and including the bank having been paid */
export const ORDINARY: ReadonlySet<string> = new Set([
  "incoming_payment_waiting",
  "incoming_payment_initiated",
  "processing",
  "funds_converted",
  "outgoing_payment_sent",
]);
/** the bank has the money: a grant counts as settled from here */
export const DELIVERED = "outgoing_payment_sent";
/** the state a grants run stored before wise's own states were kept (written
 * before May 2026): delivered, exactly as `DELIVERED` */
export const LEGACY_SETTLED = "settled";
/** a manual cancel stored by ops, or wise's `cancelled` on the way to a refund:
 * read for the window, or while a payout of it is open, see `settlements_to_poll` */
export const CANCELLED = "cancelled";
export const MONEY_BACK = "funds_refunded";
/** wise's two states that bounce a funded transfer: it may still be delivered or refunded (`bounced_back`), or never will (`charged_back`) */
export const BOUNCED_BACK = "bounced_back";
export const CHARGED_BACK = "charged_back";
/**
 * the payout reached the npo by another route than a wise transfer: the
 * settlement's `other_id` holds that payment's reference, not a transfer ref.
 * delivered and final, and never read as a transfer
 */
export const PAID = "paid";
/** stored states that mean the bank has the money */
export const DELIVERED_STATES: readonly string[] = [
  DELIVERED,
  LEGACY_SETTLED,
  PAID,
];
/** a delivered transfer is polled for this long after it is sent, in case it
 * bounces; an open one (not delivered, not refunded) is polled whatever its age */
export const WINDOW_DAYS = 90;

/** a settlement's stored state before the first poll read one */
export const UNREAD = "";

/** stored states of a transfer that is moving normally or came back whole */
export const ON_PATH: readonly string[] = [
  UNREAD,
  ...ORDINARY,
  MONEY_BACK,
  LEGACY_SETTLED,
  PAID,
];

/**
 * what a grant (a settlement) is to the nonprofit. `settled` only once wise
 * reported it sent; `returned` when its money is back in the balance;
 * `bounced` for every state off the ordinary path that is not the money back
 * (`awaiting_repair` is ours, and shows as a plain grant while it is checked)
 */
export type GrantState = "sending" | "settled" | "bounced" | "returned";

export function grant_state(s: {
  status: string;
  other_id: string | null;
  /** wise bounced a payout of it: what makes `cancelled` a bounce, not ops' own cancel */
  bounced?: boolean;
}): GrantState | "repair" {
  if (s.status === "returned") return "returned";
  if (s.status === "awaiting_repair") return "repair";
  // a run that paid what the npo owed sends no transfer: nothing to deliver
  if (s.other_id === null) return "settled";
  if (DELIVERED_STATES.includes(s.status)) return "settled";
  // the money is back in the balance, the return not yet recorded
  if (s.status === MONEY_BACK) return "returned";
  if (ON_PATH.includes(s.status)) return "sending";
  // a transfer ops cancelled by hand is history, not a bounce
  if (s.status === CANCELLED && !s.bounced) return "settled";
  return "bounced";
}
