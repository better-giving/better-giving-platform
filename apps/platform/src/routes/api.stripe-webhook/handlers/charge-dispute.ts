import type Stripe from "stripe";
import { from_stripe_amount, str_id } from "#/helpers/stripe";
import { msg } from "@/queue";
import { stage } from "$/env";
import { enqueue } from "$/kit/queue";
import { money, refund_list } from "$/kit/stripe-money";
import { db } from "$/pg/db";
import { dispute_close, dispute_get, dispute_open } from "$/pg/queries/dispute";
import { dispute_opened, dispute_won, owed_lines } from "$/refund/dispute";
import { load_reversible, reverse_charge } from "$/refund/reverse";
import { charge_refunds, refund_take } from "$/refund/unsent";
import {
  held_transfers,
  released_lines,
  routed_open_lines,
  send_held,
} from "$/stripe-connect/release";
import {
  reverse_routed_refunds,
  routed_dispute_reversals,
} from "$/stripe-connect/reverse";
import { ReversalIncompleteError } from "../helpers/reversal-incomplete";
import { settled_donation } from "../helpers/settled-donation";

const ALERT_FROM = "charge-dispute";

const iso = (unix: number) => new Date(unix * 1000).toISOString();

const dispute_line = (d: Stripe.Dispute, don_id: string, event_id: string) =>
  `donation ${don_id}, dispute ${d.id}, charge ${str_id(d.charge)}, event ${event_id}`;

/** in its balance transactions' own (settlement) currency, never the dispute's */
const fee_txns = (d: Stripe.Dispute) =>
  d.balance_transactions.filter((bt) => bt.fee !== 0);

const dispute_fees = (d: Stripe.Dispute) =>
  fee_txns(d)
    .map((bt) => `${money(bt.fee, bt.currency)} (${bt.id})`)
    .join(", ") || "none recorded";

/** the dispute fee owed in usd. a dispute's balance transactions all settle
 * in the charge's settlement currency, so their fees sum; the account settles
 * in usd, so a fee in any other currency is no figure this can owe: it counts
 * as none, and `line` tells ops */
const dispute_fee_usd = (d: Stripe.Dispute): { usd: number; line?: string } => {
  const [first, ...rest] = fee_txns(d);
  if (!first) return { usd: 0 };
  const amount = rest.reduce((sum, bt) => sum + bt.fee, first.fee);
  if (first.currency !== "usd") {
    return {
      usd: 0,
      line: `dispute fee settled in ${first.currency.toUpperCase()} (${money(amount, first.currency)}): recorded as none owed, settle its share by hand.`,
    };
  }
  return { usd: from_stripe_amount(amount, first.currency) };
};

/** dispute.amount can be part of the charge: the gift reverses only once the
 * dispute and the refunds leave nothing on it, and less owes its share. a
 * charge has at most one dispute. only succeeded refunds count: stripe fails
 * one still pending when the charge is disputed */
async function taken_from_charge(d: Stripe.Dispute) {
  const { charge, of, all, sent, unsent } = await charge_refunds(
    str_id(d.charge)
  );
  const counted = sent.map(refund_take);
  const refunded = counted.reduce((sum, r) => sum + r.amount, 0);
  const share = { taken: d.amount + refunded, of };
  return {
    charge,
    refunds: all,
    counted,
    unsent: unsent.map((r) => r.id),
    share,
    partial: share.taken < share.of,
  };
}

const CLOSED_STATUSES = new Set<Stripe.Dispute.Status>([
  "lost",
  "won",
  "warning_closed",
]);

export async function handle_dispute_closed(
  event: Stripe.ChargeDisputeClosedEvent
) {
  const dispute = event.data.object;
  if (!CLOSED_STATUSES.has(dispute.status)) {
    console.info(`dispute ${dispute.id} closed ${dispute.status}: kept`);
    return;
  }
  const intent_id = str_id(dispute.payment_intent);
  const don = await settled_donation(intent_id);
  const at = { opened_at: iso(dispute.created), closed_at: iso(event.created) };
  const release = () => release_closed(event, don.id, intent_id);

  if (dispute.status === "warning_closed") {
    await dispute_close(db, {
      id: dispute.id,
      donation_id: don.id,
      status: "inquiry_closed",
      ...at,
    });
    return release();
  }

  if (dispute.status === "won") {
    const won = await dispute_won({
      donation_id: don.id,
      rail: "stripe",
      dispute_id: dispute.id,
      ...at,
    });
    if (won.status === "failed") {
      throw new Error(`dispute ${dispute.id} not credited: ${won.reason}`);
    }
    if (won.status === "credited") return release();
    // a loss recorded earlier reversed its cut of the routed transfers, which
    // nothing re-pays: ops get a line per transfer to settle by hand
    const routed = await routed_dispute_reversals(don.id, {
      id: dispute.id,
      amount: dispute.amount,
      charge: str_id(dispute.charge),
      created_at: iso(dispute.created),
    });
    if (won.status === "conflict") {
      // keyed on the event: a redelivery collapses into it
      await enqueue(
        msg("fiat-notice", {
          id: event.id,
          alert: {
            type: "NOTICE",
            from: `${ALERT_FROM}-${stage}`,
            title: "Dispute Outcome Changed",
            body: [
              dispute_line(dispute, don.id, event.id),
              `dispute ${dispute.id} won after it was recorded ${won.prior_status}: the chargeback stays owed; credit by hand if stripe returned the money.`,
              ...routed,
            ].join("\n"),
          },
        })
      );
      return;
    }
    const fee = dispute_fee_usd(dispute);
    // keyed on the event: a redelivery collapses into it inside the queue's
    // dedupe window only
    await enqueue(
      msg("fiat-notice", {
        id: event.id,
        alert: {
          type: "NOTICE",
          from: `${ALERT_FROM}-${stage}`,
          title: "Dispute Won on a Reversed Donation",
          body: [
            dispute_line(dispute, don.id, event.id),
            won.credited
              ? [
                  `stripe returned the disputed ${money(dispute.amount, dispute.currency)} after it was lost, and that loss reversed the donation (${won.donation_status}). what it recorded as owed is credited back${fee.line ? "" : ", its dispute fee included"}.`,
                  ...(fee.line ? [fee.line] : []),
                ].join(" ")
              : won.hand
                ? [
                    `stripe returned the disputed ${money(dispute.amount, dispute.currency)} after it was lost, and that loss reversed the donation (${won.donation_status}): credit the nonprofit by hand what the reversal took.`,
                    ...(fee.line ? [fee.line] : []),
                  ].join(" ")
                : `stripe returned the disputed ${money(dispute.amount, dispute.currency)}, the platform's own withdrawal: the donation was already ${won.donation_status}, reversed by its refund or another dispute rather than this one, so nothing is owed to the nonprofit.`,
            ...routed,
          ].join("\n"),
        },
      })
    );
    return;
  }

  await dispute_close(db, {
    id: dispute.id,
    donation_id: don.id,
    status: "lost",
    ...at,
  });
  // ahead of the stripe calls: a hiccup there must not turn an ack into retries
  const loaded = await load_reversible(don.id, "stripe");
  if (loaded.status === "already_reversed") {
    console.info(`already reversed: ${don.id}`);
    return;
  }

  const { charge, refunds, counted, unsent, share, partial } =
    await taken_from_charge(dispute);
  const fee = dispute_fee_usd(dispute);
  // reverse_charge leaves a dispute's routed cut to this; a throw fails the
  // delivery, for stripe's redelivery to retry
  const routed = await reverse_routed_refunds(don.id, {
    of: share.of,
    refunds: counted,
    unsent,
  });
  // the job sends the whole net, and its own reversal then takes back this
  // loss's cut. a full loss reverses the gift, so nothing is left to send.
  // sent after the notice naming them: a lost notice fails the delivery with
  // them still held, so the redelivery names them again
  const released = partial ? await held_transfers(don.id) : [];

  const result = await reverse_charge({
    donation_id: don.id,
    rail: "stripe",
    source: "dispute",
    share: { taken: dispute.amount, of: share.of },
    refunds: counted,
    dispute_id: dispute.id,
    dispute_fee_usd: fee.usd,
    source_ref: dispute.id,
    alert_from: ALERT_FROM,
    notice: {
      id: event.id,
      lines: [
        dispute_line(dispute, don.id, event.id),
        `disputed amount: ${money(dispute.amount, dispute.currency)}, reason: ${dispute.reason}`,
        `earlier refunds: ${refund_list(refunds, charge.currency) || "none"}`,
        ...(partial
          ? [
              `taken back so far: ${money(share.taken, charge.currency)} of ${money(share.of, charge.currency)}`,
            ]
          : []),
        `dispute fee: ${dispute_fees(dispute)}`,
        ...(fee.line ? [fee.line] : []),
        ...routed,
        ...released_lines(released),
      ],
    },
  });

  if (result.status === "already_reversed") {
    console.info(`already reversed: ${don.id}`);
  }
  if (result.status !== "failed") {
    return send_held(released, {
      donation_id: don.id,
      intent_id,
      dispute_id: dispute.id,
    });
  }
  if (result.reason === "incomplete") {
    throw new ReversalIncompleteError(
      don.id,
      result.failures.length,
      result.dists
    );
  }
  throw new Error(`dispute ${dispute.id} not reversed: ${result.reason}`);
}

/** a favorable close sends the transfers the dispute held, and tells ops */
async function release_closed(
  event: Stripe.ChargeDisputeClosedEvent,
  donation_id: string,
  intent_id: string
) {
  const dispute = event.data.object;
  const released = await held_transfers(donation_id);
  if (released.length === 0) return;
  // keyed on the event: a redelivery collapses into it. ahead of the
  // transfers, so a lost notice fails the delivery with them still held and
  // the redelivery sends both
  await enqueue(
    msg("fiat-notice", {
      id: event.id,
      alert: {
        type: "NOTICE",
        from: `${ALERT_FROM}-${stage}`,
        title: "Dispute Closed: Held Transfers Released",
        body: [
          dispute_line(dispute, donation_id, event.id),
          `dispute ${dispute.id} closed ${dispute.status}: the transfers it held are sent.`,
          ...released_lines(released),
        ].join("\n"),
      },
    })
  );
  await send_held(released, { donation_id, intent_id, dispute_id: dispute.id });
}

/** an inquiry escalating to a chargeback stays the same dispute and sends no
 * second `created`: its `funds_withdrawn` is when there is something owed.
 * a chargeback opened outright withdraws as it opens, so both may arrive, in
 * either order */
type DisputeEvent =
  | Stripe.ChargeDisputeCreatedEvent
  | Stripe.ChargeDisputeFundsWithdrawnEvent;

export async function handle_dispute_opened(event: DisputeEvent) {
  const dispute = event.data.object;
  const don = await settled_donation(str_id(dispute.payment_intent));

  // owed only once the funds have left, which the balance transactions show
  // and the status doesn't
  const withdrawn = dispute.balance_transactions.some((bt) => bt.amount < 0);
  const routed = await routed_open_lines(don.id);
  if (!withdrawn) {
    const inquiry = dispute.status.startsWith("warning_");
    return record_only(event, don.id, [
      `${inquiry ? "an inquiry: " : ""}stripe has withdrawn no funds, so nothing recorded as owed. if it withdraws them, as when an inquiry escalates to a chargeback, what the gift's parties owe is recorded then.`,
      ...routed,
    ]);
  }
  const { share, partial } = await taken_from_charge(dispute);
  const fee = dispute_fee_usd(dispute);
  const res = await dispute_opened({
    donation_id: don.id,
    rail: "stripe",
    dispute_id: dispute.id,
    opened_at: iso(dispute.created),
    disputed: { taken: dispute.amount, of: share.of },
    fee_usd: fee.usd,
  });
  if (res.status === "closed") return;
  if (res.status === "failed") {
    return record_only(event, don.id, [
      `nothing recorded as owed: ${res.reason}. settle the donation by hand.`,
    ]);
  }
  // news that grows nothing owed is told on the first sighting of the funds
  // leaving: the open, or an escalated inquiry's withdrawal. `created` and
  // `funds_withdrawn` of one open collapse in the queue's dedupe window
  const sighted =
    res.inserted || event.type === "charge.dispute.funds_withdrawn";
  if (res.status === "already_reversed") {
    if (!sighted) return;
    return notify_opened(event, don.id, `${dispute.id}_reversed`, [
      `the donation was already ${res.donation_status}, so nothing recorded as owed: the refund is the evidence to submit.`,
    ]);
  }

  if (res.owed.length === 0) {
    if (!sighted) return;
    return notify_opened(event, don.id, `${dispute.id}_unsettled`, [
      "nothing settled to the gift's parties yet, so nothing recorded as owed.",
      ...routed,
    ]);
  }
  if (res.prior_refs.length > 0 && sighted) {
    await notify_opened(event, don.id, `${dispute.id}_prior`, [
      `a second dispute on this payment: what is owed stands under ${res.prior_refs.join(", ")}, recorded before this dispute; this dispute's share is merged into it, and a win of it credits that share back.`,
    ]);
  }

  // only the delivery that grew what is owed tells ops, however late the
  // repeat: a redelivery, or the other of `created` and `funds_withdrawn`.
  // a failed enqueue after the write is not resent
  if (!res.owed_written) return;
  await notify_opened(event, don.id, `${dispute.id}_owed`, [
    ...owed_lines(res.owed),
    ...(fee.line ? [fee.line] : []),
    `the donation stays settled while the dispute is open, and what is owed is recovered from each party's next grants. if the dispute is lost, ${partial ? "it stays owed and the donation is not reversed" : "the donation reverses without taking it twice"}; if won, what is owed is credited back.`,
    ...routed,
  ]);
}

/** a dispute put on record with nothing owed for it. once on record, open or
 * closed, a redelivery or a late event notifies nothing again */
async function record_only(
  event: DisputeEvent,
  donation_id: string,
  why: string[]
) {
  const { id, created } = event.data.object;
  if (await dispute_get(id)) return;
  // ahead of the record: a lost notice fails the delivery with nothing
  // written, so the redelivery sends it
  await notify_opened(event, donation_id, `${id}_recorded`, why);
  await dispute_open(db, { id, donation_id, opened_at: iso(created) });
}

async function notify_opened(
  event: DisputeEvent,
  donation_id: string,
  notice_id: string,
  lines: string[]
) {
  const dispute = event.data.object;
  const due = dispute.evidence_details?.due_by;
  await enqueue(
    msg("fiat-notice", {
      id: notice_id,
      alert: {
        type: "NOTICE",
        from: `${ALERT_FROM}-${stage}`,
        title: "Stripe Dispute Opened",
        body: [
          dispute_line(dispute, donation_id, event.id),
          `amount: ${money(dispute.amount, dispute.currency)}, reason: ${dispute.reason}, status: ${dispute.status}`,
          `evidence due by: ${due ? iso(due) : "n/a"}`,
          ...lines,
        ].join("\n"),
      },
    })
  );
}
