import type Stripe from "stripe";
import { str_id } from "#/helpers/stripe";
import { stripe } from "$/kit/stripe";
import { refunded_charge, reverse_refunds } from "../helpers/refunds";

const ALERT_FROM = "refund-updated";

/**
 * takes back the share charge.refunded held for a pending refund, once the
 * last one on the charge settles. a failed or canceled one takes nothing
 * back: refund.failed tells ops.
 */
export async function handle_refund_updated(event: Stripe.RefundUpdatedEvent) {
  const refund = event.data.object;
  // stripe sends it for a trace number or metadata too: only a status change
  // can release a held share, and a repeat would re-post a recorded one's notice
  if (event.data.previous_attributes?.status === undefined) return;
  // judged on the charge as stripe has it now: the event's copy can be stale
  const charge = await stripe.charges.retrieve(str_id(refund.charge));
  const refunded = await refunded_charge(charge);
  if (!refunded) return;

  await reverse_refunds(refunded, {
    alert_from: ALERT_FROM,
    seen_at: [`refund ${refund.id}`, `event ${event.id}`],
    event_id: event.id,
    refunds: [refund],
  });
}
