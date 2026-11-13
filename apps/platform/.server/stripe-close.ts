import { report_error } from "#/errors/report";
import { stripe } from "./kit/stripe";

export interface IOpenPayment {
  /** the donation id: the intent carries it as `metadata.order_id` */
  id: string;
  frequency: string;
}

/** intents that can still be confirmed by the donor, so cancelling them is what
 * closes the payment for good */
const CANCELLABLE = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
]);

/** closes the stripe payment behind each donation so none of them can collect
 * money any more. returns the ids it closed, or `null` when any payment can't
 * be shown closed; the caller then keeps the campaign, because money may
 * still land on it. what counts as closed is a PaymentIntent found by its
 * `order_id` and cancelled (or already canceled). refused, never inferred
 * closed: a recurring gift (its setup intent can start a subscription later),
 * an intent that is processing, succeeded or awaiting capture, a cancel stripe
 * refused, and a row with no intent found (the search lags, and a checkout
 * session's payment isn't found by it at all). */
export async function close_stripe_payments(
  rows: IOpenPayment[]
): Promise<string[] | null> {
  // look at every payment before cancelling any: a refusal found late would
  // leave the donors whose payments were already cancelled with a dead checkout
  // for a campaign that is staying
  if (rows.some((r) => r.frequency !== "one-time")) return null;
  const to_cancel: string[] = [];
  for (const row of rows) {
    // a rate limit or timeout is a refusal like any other: the campaign stays
    const found = await stripe.paymentIntents
      .search({
        query: `metadata['order_id']:'${row.id.replaceAll("'", "")}'`,
        limit: 10,
      })
      .catch((err) => {
        report_error(err);
        return null;
      });
    if (!found || found.data.length === 0) return null;
    for (const intent of found.data) {
      if (intent.status === "canceled") continue;
      if (!CANCELLABLE.has(intent.status)) return null;
      to_cancel.push(intent.id);
    }
  }
  for (const id of to_cancel) {
    try {
      await stripe.paymentIntents.cancel(id);
    } catch (err) {
      // already canceled (a retry after a partial run) is closed; anything
      // else moved on (confirmed, processing) between the search and the cancel
      const now = await stripe.paymentIntents.retrieve(id).catch(() => null);
      if (now?.status === "canceled") continue;
      report_error(err);
      return null;
    }
  }
  return rows.map((r) => r.id);
}
