import { stripe } from "./kit/stripe";

export interface IOpenPayment {
  /** the donation id: the intent carries it as `metadata.order_id` */
  id: string;
  created_at: string;
}

/** an intent with no row of its own after this long was never created: the
 * search index lags by a minute or so, never hours */
const SEARCH_LAG_MS = 2 * 60 * 60 * 1000;

/** intents that can still be confirmed by the donor, so cancelling them is what
 * closes the payment for good */
const CANCELLABLE = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
]);

/** closes the stripe payment behind each donation so none of them can collect
 * money any more. returns the ids it closed, or `null` when any payment can't
 * be shown closed (processing, succeeded or awaiting capture, a cancel stripe
 * refused, or an intent the search can't find yet) — the caller then keeps the
 * campaign, because money may still land on it. */
export async function close_stripe_payments(
  rows: IOpenPayment[],
  now = Date.now()
): Promise<string[] | null> {
  for (const row of rows) {
    const found = await stripe.paymentIntents.search({
      query: `metadata['order_id']:'${row.id.replaceAll("'", "")}'`,
      limit: 10,
    });
    if (found.data.length === 0) {
      // no intent to cancel: either the checkout never got that far, or the
      // search hasn't indexed it yet — only an old row is the first
      if (now - new Date(row.created_at).getTime() < SEARCH_LAG_MS) return null;
      continue;
    }
    for (const intent of found.data) {
      if (intent.status === "canceled") continue;
      if (!CANCELLABLE.has(intent.status)) return null;
      try {
        await stripe.paymentIntents.cancel(intent.id);
      } catch {
        // it moved on (confirmed, processing) between the search and the cancel
        return null;
      }
    }
  }
  return rows.map((r) => r.id);
}
