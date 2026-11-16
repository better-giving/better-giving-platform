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
export const MONEY_BACK = "funds_refunded";
/** a transfer is polled for this long after it is sent; past it nothing reads
 * its state again, so a stored state older than this is history, not news */
export const WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
export const in_window = (date: string, now = Date.now()) =>
  now - Date.parse(date) <= WINDOW_DAYS * DAY_MS;

/** a settlement's stored state before the first poll read one */
export const UNREAD = "";

/** stored states of a transfer that is moving normally or came back whole */
export const ON_PATH: readonly string[] = [UNREAD, ...ORDINARY, MONEY_BACK];

/**
 * what a grant (a settlement) is to the nonprofit. `settled` only once wise
 * reported it sent; `returned` when its money is back in the balance;
 * `bounced` for every state off the ordinary path that is not the money back
 * (`awaiting_repair` is ours, and shows as a plain grant while it is checked)
 */
export type GrantState = "sending" | "settled" | "bounced" | "returned";

export function grant_state(
  s: {
    status: string;
    other_id: string | null;
    date: string;
  },
  now = Date.now()
): GrantState | "repair" {
  if (s.status === "returned") return "returned";
  if (s.status === "awaiting_repair") return "repair";
  // a run that paid what the npo owed sends no transfer: nothing to deliver
  if (s.other_id === null) return "settled";
  if (s.status === DELIVERED) return "settled";
  // the money is back in the balance, the return not yet recorded
  if (s.status === MONEY_BACK) return "returned";
  if (ON_PATH.includes(s.status)) {
    // never read again past the window: history from before delivery was
    // tracked, which the backfill leaves settled
    return in_window(s.date, now) ? "sending" : "settled";
  }
  return "bounced";
}
