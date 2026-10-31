import type Stripe from "stripe";
import { report_error } from "#/errors/report";
import { is_reversed } from "@/donations/settle";
import { type IAttempt, type IConnectTransferPayload, msg } from "@/queue";
import { stage } from "../env";
import { enqueue } from "../kit/queue";
import { stripe } from "../kit/stripe";
import { payout_cents } from "../payouts/amount";
import { db } from "../pg/db";
import { disputes_of_donation } from "../pg/queries/dispute";
import {
  dist_stripe_transfer_get,
  dist_stripe_transfer_set,
  npo_donation_get,
} from "../pg/queries/dist";
import { donation_status_shared } from "../pg/queries/donation";
import { charge_refunds, refund_take } from "../refund/unsent";
import { settle_unrouted, type TUnrouted } from "../settlement/settle-npo";
import { is_refusal } from "./refusal";
import {
  type ITakeBack,
  lost_disputes,
  reverse_routed_refunds,
  take_cuts,
} from "./reverse";

/** pay a routed dist's net to the connected account settlement routed it to */
export async function transfer_routed_dist(
  p: IConnectTransferPayload,
  attempt: IAttempt
) {
  const stored = await dist_stripe_transfer_get(p.dist_id);
  if (stored === undefined) {
    report_error(new Error(`connect-transfer for missing dist ${p.dist_id}`), {
      donation_id: p.donation_id,
      dist_id: p.dist_id,
    });
    return;
  }
  // stored: a delivery retried after the reversal below threw, or a duplicate
  if (stored) return reverse_refunded_before(p, (await charge_of(p)).id);

  const dist = await npo_donation_get(p.dist_id);
  // a racing delivery stored its transfer after the read above
  if (!dist || dist.stripe_transfer_id) return;
  // a refusal rebooked it pooled; this delivery may be the retry of one whose
  // notice never went
  if (!dist.stripe_routed_to) {
    return enqueue(refused_notice(p, "taken", NO_CUT));
  }
  const npo_id = dist.to_id;
  if (npo_id === null) throw new Error(`dist ${p.dist_id} has no npo`);
  const routed: IRefusedDist = {
    id: dist.id,
    to_id: npo_id,
    net: dist.net ?? 0,
    date_created: dist.date_created,
    stripe_routed_to: dist.stripe_routed_to,
  };

  const failed = async (e: unknown, charge?: string) => {
    if (is_refusal(e)) return settle_refused(p, routed, e, charge);
    // no rebook: the transfer stripe never answered for may have been made
    if (attempt.last) await enqueue(unanswered_notice(p));
    // thrown, not reported: the queue route's error handler reports what
    // escapes it, and qstash retries the delivery
    throw new Error(`${what(p)} failed`, { cause: e });
  };

  let ch: ICharge;
  let tr: Stripe.Transfer | undefined;
  try {
    ch = await charge_of(p);
    tr = await transfer_made(p, ch);
  } catch (e) {
    return failed(e);
  }

  if (!tr) {
    if (await dispute_holds(p, ch)) {
      console.info(`${what(p)} held: its charge is disputed`);
      return;
    }
    // the donor has the money back; a refund that lands after this check
    // meets a transfer it has to reverse
    const status = await donation_status_shared(db, p.donation_id);
    if (status && is_reversed(status)) {
      report_error(
        new Error(`donation ${p.donation_id} ${status} before its transfer`),
        { donation_id: p.donation_id, dist_id: p.dist_id, status }
      );
      return;
    }
    try {
      tr = await create_transfer(p, ch.id, dist.stripe_routed_to, routed.net);
    } catch (e) {
      return failed(e, ch.id);
    }
  }

  const r = await dist_stripe_transfer_set(
    p.dist_id,
    tr.id,
    new Date(tr.created * 1000).toISOString()
  );
  // the same id is a racing delivery that got stripe's idempotent reply
  if (!r.set && r.existing !== tr.id) {
    report_error(new Error(`dist ${p.dist_id} paid by two transfers`), {
      donation_id: p.donation_id,
      dist_id: p.dist_id,
      transfer_id: tr.id,
      stored_transfer_id: r.existing,
    });
  }
  await reverse_refunded_before(p, ch.id);
}

const what = (p: IConnectTransferPayload) =>
  `stripe transfer for dist ${p.dist_id} of donation ${p.donation_id}`;

/** a routed dist as a refusal of its transfer rebooks it */
interface IRefusedDist {
  id: string;
  to_id: number;
  net: number;
  date_created: string;
  stripe_routed_to: string;
}

/** stripe refused the dist's transfer: it is booked pooled, less what the
 * charge's sent refunds and lost disputes would have reversed from the
 * transfer. `charge` absent: refused reading the intent, so no charge to
 * have taken any back */
async function settle_refused(
  p: IConnectTransferPayload,
  dist: IRefusedDist,
  e: Stripe.errors.StripeError,
  charge: string | undefined
) {
  report_error(
    new Error(`${what(p)} refused, settling it pooled`, { cause: e }),
    {
      donation_id: p.donation_id,
      dist_id: p.dist_id,
      destination: dist.stripe_routed_to,
      stripe_code: e.code,
    }
  );
  const cut = charge ? await rebook_cut(dist.net, charge) : NO_CUT;
  const r = await db.transaction((tx) =>
    settle_unrouted(tx, {
      id: dist.id,
      donation_id: p.donation_id,
      to_id: dist.to_id,
      net: dist.net - cut.usd,
      settled_net: dist.net,
      refunds_cut_share: cut.share,
      date_created: dist.date_created,
    })
  );
  const msgs = r.status === "booked" ? r.msgs : [];
  return enqueue(refused_notice(p, r.status, cut), ...msgs);
}

interface IRebookCut {
  /** usd off the routed net */
  usd: number;
  /** of the charge, null when none */
  share: number | null;
  /** the usd the refunds and the lost disputes each cut */
  refunds: number;
  disputes: number;
}

const NO_CUT: IRebookCut = { usd: 0, share: null, refunds: 0, disputes: 0 };

/**
 * what the charge's sent refunds and lost disputes take off a routed `net`:
 * their share of the charge, and in usd the cents their cuts of its transfer
 * would have been (`take_cuts`), all of it once they take the whole charge.
 * not an unsent refund: it can still fail, and a dist booked pooled has no
 * transfer to give its cut back from, so it is taken back the way a pooled
 * share's refund is
 */
async function rebook_cut(net: number, charge: string): Promise<IRebookCut> {
  const [{ of, sent }, lost] = await Promise.all([
    charge_refunds(charge),
    lost_disputes(charge),
  ]);
  const takes: ITakeBack[] = [
    ...sent.map((r) => ({ kind: "refund" as const, ...refund_take(r) })),
    ...lost,
  ];
  const taken = Math.min(
    takes.reduce((sum, t) => sum + t.amount, 0),
    of
  );
  if (taken === 0) return NO_CUT;
  const cuts = take_cuts(payout_cents([net]), of, takes);
  const cents_of = (kind?: ITakeBack["kind"]) =>
    cuts
      .filter((c) => !kind || c.kind === kind)
      .reduce((sum, c) => sum + c.amount, 0);
  return {
    usd: taken === of ? net : cents_of() / 100,
    share: taken / of,
    refunds: cents_of("refund") / 100,
    disputes: cents_of("dispute") / 100,
  };
}

const refused_notice = (
  p: IConnectTransferPayload,
  outcome: TUnrouted["status"],
  cut: IRebookCut
) =>
  msg("fiat-notice", {
    id: `connect-refused_${p.dist_id}`,
    alert: {
      type: "NOTICE",
      from: `connect-transfer-${stage}`,
      title: "Routed Transfer Refused: Settled Pooled",
      body: [
        `donation ${p.donation_id}, dist ${p.dist_id}`,
        {
          reversed:
            "stripe refused the transfer to the nonprofit's connected account, and the donation was refunded in full meanwhile: the share was unrouted and nothing booked, since the donor has the money back.",
          booked:
            "stripe refused the transfer to the nonprofit's connected account, so its share was settled the way a pooled one is: into its balances and a pending payout the grants run pays like any other.",
          // a redelivery, after the delivery that unrouted it
          taken:
            "stripe refused the transfer to the nonprofit's connected account and the share is no longer routed: see this dist's balance and payout rows for what was booked.",
        }[outcome],
        ...(outcome === "booked" && cut.usd > 0 ? [cut_line(cut)] : []),
        "check the nonprofit's stripe connection; later card gifts keep routing to it until it reads disconnected or not ready.",
      ].join("\n"),
    },
  });

const cut_line = ({ usd, refunds, disputes }: IRebookCut) => {
  const of =
    refunds > 0 && disputes > 0
      ? `${refunds} usd for the charge's refunds and ${disputes} usd for its lost disputes`
      : `its share of the charge's ${disputes > 0 ? "lost disputes" : "refunds"}`;
  return `booked less ${usd} usd, ${of}, which the transfer would have reversed.`;
};

const unanswered_notice = (p: IConnectTransferPayload) =>
  msg("fiat-notice", {
    id: `connect-unanswered_${p.dist_id}`,
    alert: {
      type: "ERROR",
      from: `connect-transfer-${stage}`,
      title: "Routed Transfer Unanswered",
      body: [
        `donation ${p.donation_id}, dist ${p.dist_id}`,
        `stripe never answered the transfer for this share, and nothing retries it. look in stripe for a transfer with metadata dist_id ${p.dist_id}: if there is one, the nonprofit was paid: store its id as the dist's stripe_transfer_id, or a refund won't reverse it. if not, the nonprofit is unpaid: the dist is still routed, with no payout row.`,
      ].join("\n"),
    },
  });

type ICharge = Pick<Stripe.Charge, "id" | "transfer_group" | "disputed">;

async function charge_of(p: IConnectTransferPayload): Promise<ICharge> {
  const intent = await stripe.paymentIntents.retrieve(p.intent_id, {
    expand: ["latest_charge"],
  });
  const charge = intent.latest_charge;
  if (!charge) throw new Error(`intent ${p.intent_id} has no charge`);
  return typeof charge === "string"
    ? { id: charge, transfer_group: null, disputed: false }
    : { ...charge, disputed: charge.disputed ?? false };
}

/**
 * a dispute holds the transfer until it closes: its close releases it
 * (`held_transfers`, `send_held`). the charge reads disputed before the dispute's
 * webhook puts it on record, and still does once it closes, so the flag alone
 * holds it only while the gift has no dispute on record at all
 */
async function dispute_holds(p: IConnectTransferPayload, ch: ICharge) {
  const disputes = await disputes_of_donation(p.donation_id);
  if (disputes.some((d) => d.status === "open")) return true;
  return ch.disputed && disputes.length === 0;
}

/**
 * the transfer an earlier delivery made for the dist and never stored: a
 * create under its idempotency key replays it only while stripe keeps the
 * key (24h), and makes a second one after. stripe puts a transfer from a
 * charge in the charge's `transfer_group`, which it sets to
 * `group_<intent id>` when the charge has none (docs: connect/separate-
 * charges-and-transfers, "transfer availability"), so the gift's transfers
 * are that group's and the dist's is the one its metadata names
 */
async function transfer_made(
  p: IConnectTransferPayload,
  ch: ICharge
): Promise<Stripe.Transfer | undefined> {
  const transfer_group = ch.transfer_group ?? `group_${p.intent_id}`;
  try {
    for await (const t of stripe.transfers.list({
      transfer_group,
      limit: 100,
    })) {
      if (t.metadata?.dist_id === p.dist_id) return t;
    }
    return undefined;
  } catch (e) {
    // not stripe refusing the transfer, which would rebook the dist pooled
    // with a transfer made: a lookup that fails is retried
    throw new Error(`listing transfer group ${transfer_group}`, { cause: e });
  }
}

/**
 * reverses the share of the transfer the charge's refunds took before it was
 * stored. a refund event reverses only a transfer already stored, so the
 * refunds it handled first are this one's; one that comes after finds it
 */
async function reverse_refunded_before(
  p: IConnectTransferPayload,
  charge: string
) {
  const { of, live, unsent } = await charge_refunds(charge);
  await reverse_routed_refunds(p.donation_id, {
    of,
    refunds: live.map(refund_take),
    unsent: unsent.map((r) => r.id),
  });
}

async function create_transfer(
  p: IConnectTransferPayload,
  charge: string,
  destination: string,
  net: number
) {
  return stripe.transfers.create(
    {
      // the cents the grants run would pay the same net
      amount: payout_cents([net]),
      // must be the charge's balance transaction currency; the stripe rail's
      // settlement (`net` included) is booked in usd
      currency: "usd",
      destination,
      source_transaction: charge,
      metadata: { donation_id: p.donation_id, dist_id: p.dist_id },
    },
    { idempotencyKey: `connect-transfer:${p.dist_id}` }
  );
}
