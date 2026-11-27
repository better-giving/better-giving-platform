import type Stripe from "stripe";
import { str_id } from "#/helpers/stripe";
import { is_reversed } from "@/donations";
import { msg } from "@/queue";
import { stage } from "$/env";
import { enqueue } from "$/kit/queue";
import { money, money_label, refund_list } from "$/kit/stripe-money";
import { humanize_code, ops_alert } from "$/refund/ops-alert";
import { reverse_charge } from "$/refund/reverse";
import { charge_refunds, refund_take } from "$/refund/unsent";
import { ReversalIncompleteError } from "./reversal-incomplete";
import { settled_donation } from "./settled-donation";

export interface RefundedCharge {
  charge: Stripe.Charge;
  intent_id: string;
  don: Awaited<ReturnType<typeof settled_donation>>;
  /** newest first */
  refunds: Stripe.Refund[];
  /** the newest refund that took or is taking money back */
  latest: Stripe.Refund;
  /** the refunds not failed or canceled, sent or not: what the share counts */
  live: Stripe.Refund[];
  /** of them, the ones stripe hasn't sent */
  unsent: Stripe.Refund[];
}

/** `charge`'s donation and refunds as stripe has them now, or null when
 * nothing is left to act on: every refund failed or was canceled, or the
 * donation is already reversed. pass the charge freshly retrieved: events
 * arrive out of order, so a stale copy in one must not outvote what has
 * happened since */
export async function refunded_charge(
  charge: Stripe.Charge
): Promise<RefundedCharge | null> {
  const { all: refunds, live, unsent } = await charge_refunds(charge);
  const [latest] = live;
  if (!latest) return null;

  const intent_id = str_id(charge.payment_intent);
  const don = await settled_donation(intent_id);
  if (is_reversed(don.status)) {
    console.info(`already refunded: ${don.id}`);
    return null;
  }
  return { charge, intent_id, don, refunds, latest, live, unsent };
}

/**
 * takes back the share of the donation its charge's refunds have taken so
 * far: the whole reverses it, less records what each party owes. charge.refunded
 * counts a refund once made, not once sent: a bank refund (ach, acss) is
 * pending for days and can still fail, so nothing is taken while one is,
 * until the refund.updated that sees the last one settle.
 */
export async function reverse_refunds(
  { charge, intent_id, don, refunds, latest, live, unsent }: RefundedCharge,
  o: {
    alert_from: string;
    /** where it was seen, e.g. [`charge ch_1`, `event evt_1`] */
    seen_at: string[];
    /** the event: its notices' dedupe id */
    event_id: string;
    /** the event's own sentences for ops */
    lines?: string[];
    /** the refunds the event is about, whose amounts the alerts add up; absent,
     * the newest */
    refunds?: Stripe.Refund[];
  }
) {
  const don_id = don.id;
  const taken = live.reduce((sum, r) => sum + r.amount, 0);
  // a failed or canceled refund takes nothing back: the alert shows the event's
  // own refunds that do, or, when they all failed, what the charge's live
  // refunds take back in all, which is what the reversal then acts on
  const ids = new Set(live.map((r) => r.id));
  const own = (o.refunds ?? []).filter((r) => ids.has(r.id));
  const this_refund = money_label(
    own.length > 0 ? own.reduce((sum, r) => sum + r.amount, 0) : taken,
    charge.currency
  );
  const result = await reverse_charge({
    donation_id: don_id,
    rail: "stripe",
    source: "refund",
    share: { taken, of: charge.amount_captured },
    refunds: live.map(refund_take),
    unsent_refunds: unsent.map((r) => r.id),
    intent_id,
    source_ref: latest.id,
    alert_from: o.alert_from,
    notice: {
      id: o.event_id,
      amount: this_refund,
      ids: o.seen_at,
      lines: [
        ...(o.lines ?? []),
        `Refunds on this charge: ${refund_list(refunds, charge.currency)}.`,
        `Total refunded so far: ${money(taken, charge.currency)} of ${money(charge.amount_captured, charge.currency)}.`,
      ],
    },
  });

  switch (result.status) {
    case "held":
      // awaited: a lost notice fails the delivery, so stripe redelivers it.
      // keyed on the newest refund, which stays the same while held
      await enqueue(
        msg("fiat-notice", {
          id: `${latest.id}_held`,
          alert: await ops_alert({
            from: `${o.alert_from}-${stage}`,
            headline: "Reversal held until the refund succeeds",
            don,
            amount: this_refund,
            subject: "Refunded",
            fields: [
              {
                name: "Status",
                // what it waits on, not the latest: that one may have succeeded
                value: humanize_code(unsent[0]?.status ?? "pending"),
                inline: true,
              },
            ],
            note: [
              `Waiting on: ${refund_list(unsent, charge.currency)}.`,
              "Nothing more is taken back until Stripe reports every refund here succeeded; then it is taken back automatically.",
              "If they show succeeded in Stripe and nothing was taken back, the webhook may be missing refund.updated.",
            ],
            action: {
              text: "Check the webhook endpoint subscribes to refund.updated.",
            },
            ids: [...new Set([...o.seen_at, `refund ${latest.id}`])],
          }),
        })
      );
      return;
    case "already_reversed":
      console.info(`already refunded: ${don_id}`);
      return;
    case "failed":
      if (result.reason === "incomplete") {
        throw new ReversalIncompleteError(
          don_id,
          result.failures.length,
          result.dists
        );
      }
      throw new Error(`refund not reversed: ${don_id}: ${result.reason}`);
  }
}
