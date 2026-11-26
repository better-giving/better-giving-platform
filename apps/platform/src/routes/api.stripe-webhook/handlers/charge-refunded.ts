import type Stripe from "stripe";
import { stripe } from "$/kit/stripe";
import { refund_list } from "$/kit/stripe-money";
import { refunded_charge, reverse_refunds } from "../helpers/refunds";

const ALERT_FROM = "charge-refunded";

/** the refunds this event added, oldest first, or null when the event can't
 * say. charge.refunded names no refund, so they're found by where the event's
 * amount refunded before and after it falls in the refund list, or failing
 * that, as the latest refund by the event's time */
const added_by = (
  { created, data }: Stripe.ChargeRefundedEvent,
  refunds: Stripe.Refund[]
) => {
  // a refund made after this event isn't in it, so a redelivery marks the same ones
  const by_then = refunds.filter((r) => r.created <= created);
  // stripe documents previous_attributes for *.updated events only
  const before = data.previous_attributes?.amount_refunded;
  if (before === undefined) {
    const [latest, next] = by_then; // newest first
    const tied = latest && next && latest.created === next.created;
    return latest && !tied ? [latest] : null;
  }
  const oldest_first = by_then.reverse();
  let prior = 0;
  let i = 0;
  for (; i < oldest_first.length && prior < before; i++) {
    prior += oldest_first[i]?.amount ?? 0;
  }
  const added = oldest_first.slice(i);
  const total = added.reduce((sum, r) => sum + r.amount, prior);
  // a list that no longer adds up to the event's amounts (a refund failed
  // since) can't say which is new
  const reconciles = prior === before && total === data.object.amount_refunded;
  return reconciles && added.length > 0 ? added : null;
};

export async function handle_charge_refunded(
  event: Stripe.ChargeRefundedEvent
) {
  // a stale partial copy must not outvote a charge since refunded in full
  const refunded = await refunded_charge(
    await stripe.charges.retrieve(event.data.object.id)
  );
  if (!refunded) return;
  const added = added_by(event, refunded.refunds);
  await reverse_refunds(refunded, {
    alert_from: ALERT_FROM,
    seen_at: [`charge ${refunded.charge.id}`, `event ${event.id}`],
    event_id: event.id,
    lines: [
      `New in this event: ${added ? refund_list(added, refunded.charge.currency) : "could not tell which refund is new"}.`,
    ],
  });
}
