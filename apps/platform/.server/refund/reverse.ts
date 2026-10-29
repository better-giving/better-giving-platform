import { report_error } from "#/errors/report";
import { type IDonation, reversed_statuses } from "@/donations";
import { type Rail, rail_of } from "@/donations/rail";
import { humanize } from "@/helpers/decimal";
import { msg } from "@/queue";
import { stage } from "../env";
import { enqueue } from "../kit/queue";
import { db } from "../pg/db";
import { dists_for_refund } from "../pg/queries/dist";
import { donation_get } from "../pg/queries/donation";
import type { DbOrTx } from "../pg/queries/helpers";
import { type ITake, takes_of } from "../pg/queries/take";
import type { OwedSource } from "./apply";
import { record_takes } from "./partial";
import { dist_settled_usd, type PreviewLine } from "./plan";
import { load_refund_plan, process_refund, type RefundResult } from "./process";
import { fraction_of, type Share } from "./share";
import {
  claim_paid,
  type RefundTake,
  record_dispute_fees,
  take_chargeback,
  take_refund,
} from "./takes";

export type { Rail } from "@/donations/rail";
export { type Share, WHOLE } from "./share";

export type ReversalSource = "refund" | "dispute" | "admin";

interface RailAdapter {
  /** how a full reversal from `source` ends the recurring gift the payment
   * `payment_id` belongs to, or null when it ends none */
  subscription_end(
    source: ReversalSource
  ): ((payment_id: string) => Promise<void>) | null;
  /** takes back the refunds' and lost disputes' share of what the gift's
   * routed dists were transferred, or null when the rail routes none */
  routed_refunds:
    | ((donation_id: string, c: RoutedRefunds) => Promise<void>)
    | null;
  /** what the gift's routed dists had taken back for a refund that failed,
   * for ops, or null when the rail routes none */
  routed_refund_failed:
    | ((donation_id: string, refund_id: string) => Promise<IRoutedRefundFailed>)
    | null;
}

// loaded on use: `./subscription` builds a stripe client off env at import,
// which importing this entry from another rail must not need
async function cancel_stripe_subscription(intent_id: string) {
  const { cancel_refunded_subscription } = await import("./subscription");
  await cancel_refunded_subscription(intent_id);
}

async function stripe_routed_refund_failed(
  donation_id: string,
  refund_id: string
) {
  const { routed_refund_failed } = await import("../stripe-connect/reverse");
  return routed_refund_failed(donation_id, refund_id);
}

async function reverse_stripe_transfers(donation_id: string, c: RoutedRefunds) {
  const { reverse_routed_refunds } = await import("../stripe-connect/reverse");
  await reverse_routed_refunds(donation_id, c);
}

const rail_adapters: Record<Rail, RailAdapter> = {
  stripe: {
    // a full refund of a subscription payment ends the recurring gift, from
    // whatever surface it was issued. a lost dispute doesn't
    subscription_end: (source) =>
      source === "dispute" ? null : cancel_stripe_subscription,
    routed_refunds: reverse_stripe_transfers,
    routed_refund_failed: stripe_routed_refund_failed,
  },
  paypal: {
    subscription_end: () => null,
    routed_refunds: null,
    routed_refund_failed: null,
  },
  crypto: {
    subscription_end: () => null,
    routed_refunds: null,
    routed_refund_failed: null,
  },
};

/** `RailAdapter.routed_refund_failed` for `rail`: none when it routes none */
export const routed_refund_failed = async (
  rail: Rail,
  donation_id: string,
  refund_id: string
): Promise<IRoutedRefundFailed> =>
  (await rail_adapters[rail].routed_refund_failed?.(
    donation_id,
    refund_id
  )) ?? {
    credited: [],
    by_hand: [],
  };

/** one line per routed dist: what was credited back on its own, and what
 * ops is to do by hand */
export interface IRoutedRefundFailed {
  credited: string[];
  by_hand: string[];
}

export interface ChargeReversal {
  donation_id: string;
  rail: Rail;
  source: ReversalSource;
  /** this event's own part of the charge: one refund, or one chargeback. it
   * goes on the gift's ledger of takes, and the gift reverses once they take
   * the whole; less records each party's share of them as owed. null when the
   * provider can't say: nothing is reversed, ops told */
  share: Share | null;
  /** the provider's refunds the event confirms: each one's own amount, in
   * `share.of`'s unit, and its time at the provider, each its own take, put
   * on record by whichever event names it first. a refund event's `share`
   * then only gives `of` */
  refunds?: { id: string; amount: number; created_at?: string }[];
  /** a refund event's time at the provider, for its own take */
  refunded_at?: string;
  /** a refund whose own amount the event lacks: what the provider has
   * refunded to date, its own part being that less the gift's other refunds
   * on record */
  refunded_to_date?: Share;
  /** a chargeback's dispute, when the provider names it; else it lands on
   * the dispute filed on the gift, or waits for its filing */
  dispute_id?: string;
  /** what the provider charged for the dispute, in usd, owed in full */
  dispute_fee_usd?: number;
  /** the provider's own refund or chargeback id: the take's key, so a
   * redelivery records nothing more, and what a party's row is recorded
   * against when this event writes it first; absent, `notice.id` */
  source_ref?: string;
  /** the provider's refunds on the charge not yet sent, which can still
   * fail: while any is, nothing is reversed or recorded as owed */
  unsent_refunds?: string[];
  /** stripe's payment intent behind the charge: whose recurring gift a full
   * refund ends. absent, the gift's settlement names it */
  intent_id?: string;
  /** slack sender identity, e.g. `charge-refunded`; the stage is appended */
  alert_from: string;
  /** the event's own lines for an ops notice, and its dedupe id: a redelivery
   * of the same event reuses it */
  notice: { id: string; lines: string[] };
}

/** a charge's refunds, as a rail reverses its routed dists' transfers by */
export interface RoutedRefunds {
  /** the charge's captured amount, in the refunds' unit */
  of: number;
  /** its live refunds, sent or not */
  refunds: NonNullable<ChargeReversal["refunds"]>;
  /** of them, the ones not yet sent: while any is, nothing is reversed */
  unsent: string[];
}

export type ReversalResult =
  | {
      status: "reversed";
      dists: number;
      applied: number;
      owed_msgs: string[];
      has_loss: boolean;
    }
  /** an earlier run took the money back: acknowledge, nothing written */
  | {
      status: "already_reversed";
      donation_status: (typeof reversed_statuses)[number];
    }
  /** part of the charge: every party's share recorded as owed, nothing
   * reversed. `owed_msgs`: each party's row as it stands */
  | { status: "partial_owed"; owed_msgs: string[] }
  /** part of the charge, and some dist's grant hasn't gone out (its payout
   * pending, or its share still in the npo's balances): nothing recorded for
   * it, nothing reversed, and ops told to settle it by hand. `owed_msgs`: the
   * rows the gift's other parties owe as they stand */
  | { status: "partial_pending"; owed_msgs: string[] }
  /** a refund on the charge is unsent: nothing reversed or recorded, and a
   * full refund's recurring gift ended all the same */
  | { status: "held" }
  /** no share to size the event by: nothing reversed, ops told to settle it
   * by hand */
  | { status: "unsized" }
  /** nothing reversed: no such gift, or it wasn't paid on `rail` */
  | { status: "failed"; reason: "no_donation" | "wrong_rail" }
  /** settled but no dist yet (the dist is queued after the settle): nothing
   * reversed, so a redelivery finds it */
  | { status: "failed"; reason: "not_distributed" }
  /** some dists failed to reverse: the gift stays settled, and a rerun
   * retries the failed ones and skips the rest */
  | {
      status: "failed";
      reason: "incomplete";
      dists: number;
      applied: number;
      failures: string[];
    };

export type Unreversible = Extract<
  ReversalResult,
  { status: "already_reversed" } | { reason: "no_donation" | "wrong_rail" }
>;

/** the gift a reversal-side event acts on, or why it acts on none: no such
 * gift, not paid on `rail`, or its money already taken back. a gift that
 * exists comes back with either, so the event can still be put on record */
export async function load_reversible(
  donation_id: string,
  rail: Rail
): Promise<
  | { status: "reversible"; don: IDonation }
  | (Extract<Unreversible, { status: "already_reversed" }> & {
      don: IDonation;
    })
  | Extract<Unreversible, { status: "failed" }>
> {
  const don = await donation_get(donation_id);
  if (!don) return { status: "failed", reason: "no_donation" };
  if (rail_of(don.via) !== rail) {
    return { status: "failed", reason: "wrong_rail" };
  }
  const reversed = reversed_statuses.find((s) => s === don.status);
  if (reversed) {
    return { status: "already_reversed", donation_status: reversed, don };
  }
  return { status: "reversible", don };
}

/** the guard's answer, without the gift it loaded */
export const unreversible = (
  u: Exclude<
    Awaited<ReturnType<typeof load_reversible>>,
    { status: "reversible" }
  >
): Unreversible =>
  u.status === "already_reversed"
    ? { status: u.status, donation_status: u.donation_status }
    : u;

const UNSIZED_ACTION =
  "how much of the charge is taken back could not be read, so this reversal could not be sized against the charge. nothing was reversed automatically: settle it by hand.";

/** what a later event does on top of a hand adjustment for these dists */
const LATER_EVENTS =
  "any hand adjustment made for these dists must be undone if the rest is refunded or lost to a dispute, which reverses the donation, or if, once the grant has gone out, a later refund or dispute records as owed the whole share taken back so far, this one included; otherwise they are debited twice. a dispute filed while the grant is still pending records only its own share, so the adjustment stands then.";

const SHARE_OWED: Record<ReversalSource, string> = {
  refund: "Partial Refund Recorded as Owed",
  admin: "Partial Refund Recorded as Owed",
  dispute: "Lost Dispute: Share Recorded as Owed",
};

/** part of the charge, and no party's row owes anything for it: a routed
 * dist's share is reversed from its transfer instead */
const NOTHING_OWED: Record<ReversalSource, string> = {
  refund: "Partial Refund: Nothing Owed",
  admin: "Partial Refund: Nothing Owed",
  dispute: "Lost Dispute: Nothing Owed",
};

/** a refund's share, which owes nothing for a dist whose grant hasn't gone
 * out; a dispute's owes for every dist */
const REFUND_PENDING = {
  title: "Partial Refund Not Reversed",
  action: `nothing was reversed automatically for these dists. ${LATER_EVENTS}`,
};

/**
 * takes a gift back after its money went back to the donor: a refund, a lost
 * dispute, or an admin's refund. the whole charge reverses the gift; part of
 * it records each party's share as owed, reversing nothing. it loads the
 * dists and runs the refund core itself, so a caller hands over the event and
 * maps the result to its ack.
 *
 * safe to rerun: a reversed gift is acknowledged, a share already recorded
 * stays as it is, and an incomplete reversal is finished by the next run.
 */
export async function reverse_charge(
  r: ChargeReversal
): Promise<ReversalResult> {
  const loaded = await load_reversible(r.donation_id, r.rail);
  const src = {
    source: r.source === "dispute" ? "dispute" : "refund",
    source_ref: r.source_ref ?? r.notice.id,
  } as const;
  if (loaded.status === "already_reversed") {
    // a run that died between the reversal's commit and its fees left them
    // to the provider's redelivery
    await owe_dispute_fees(loaded.don.id, src);
  }
  if (loaded.status !== "reversible") return unreversible(loaded);
  const { don } = loaded;

  const ref = src.source_ref;
  const refunds = own_refunds(r, ref);
  const chargeback = r.source === "dispute" && r.share && fraction_of(r.share);
  if (refunds === null || chargeback === null) {
    // awaited: a lost notice fails the delivery, so the provider redelivers
    // it. keyed on the event, so the redelivery posts one notice
    await enqueue(
      msg("fiat-notice", {
        id: r.notice.id,
        alert: {
          type: "NOTICE",
          from: `${r.alert_from}-${stage}`,
          title: "Reversal Not Sized",
          body: [...r.notice.lines, UNSIZED_ACTION].join("\n"),
        },
      })
    );
    return { status: "unsized" };
  }

  // ahead of the reversal and whatever becomes of it, a held one included:
  // the donor has the money back, so the gift stops billing even while a
  // refund is unsent or a dist is left to retry. read unlocked: the ledger
  // is written under the lock below
  const end_subscription = rail_adapters[r.rail].subscription_end(r.source);
  const payment_id = r.intent_id ?? don.settlement?.id;
  if (end_subscription && payment_id) {
    const takes = await takes_of(db, don.id);
    if (refunds_take_all(takes, refunds(takes))) {
      await end_subscription(payment_id);
    }
  }
  // ahead of the gift's reversal, whose redelivery stops at the guard above,
  // so a transfer reversal that throws here is retried with the event. it
  // holds on an unsent refund itself. a lost dispute's close handler reverses
  // its cut before calling this, so it isn't asked twice
  const routed_refunds = rail_adapters[r.rail].routed_refunds;
  if (routed_refunds && r.source !== "dispute" && r.refunds && r.share) {
    await routed_refunds(don.id, {
      of: r.share.of,
      refunds: r.refunds,
      unsent: r.unsent_refunds ?? [],
    });
  }
  if (r.unsent_refunds?.length) {
    console.info(
      `${r.alert_from}: reversal of ${don.id} held on ${r.unsent_refunds.join(", ")}`
    );
    return { status: "held" };
  }

  const recorded = await record_takes({
    donation_id: don.id,
    src,
    refund: r.source !== "dispute",
    put: async (tx: DbOrTx, before: ITake[]) => {
      for (const t of refunds(before)) {
        await take_refund(tx, don.id, t);
      }
      if (chargeback !== false) {
        await take_chargeback(tx, {
          donation_id: don.id,
          ref,
          share: chargeback,
          fee_usd: r.dispute_fee_usd ?? 0,
          dispute_id: r.dispute_id,
        });
      }
    },
  });
  if (recorded.status === "undistributed") {
    return { status: "failed", reason: "not_distributed" };
  }
  if (recorded.status === "share") return notify_share(r, recorded);

  // `r.donation_id` may be the v1 id `donation_get` also matches
  const graphs = await dists_for_refund(don.id);
  if (graphs.length === 0) {
    return { status: "failed", reason: "not_distributed" };
  }

  const res = await process_refund(don.id, graphs, {
    form_id: don.form_id ?? null,
    program_id: don.program?.id ?? null,
    alert_from: r.alert_from,
    ...src,
  });
  await owe_dispute_fees(don.id, src);

  const failed = res.failures.length;
  console.info(
    `${r.alert_from}: reversed ${r.donation_id}, dists: ${graphs.length}, failures: ${failed}, owed: ${res.owed_msgs.length}`
  );
  if (r.source === "dispute") await notify_dispute_lost(r, graphs.length, res);

  if (failed > 0) {
    return {
      status: "failed",
      reason: "incomplete",
      dists: graphs.length,
      applied: res.applied,
      failures: res.failures,
    };
  }
  return {
    status: "reversed",
    dists: graphs.length,
    applied: res.applied,
    owed_msgs: res.owed_msgs,
    has_loss: res.has_loss,
  };
}

const owe_dispute_fees = (donation_id: string, src: OwedSource) =>
  db.transaction((tx) =>
    record_dispute_fees(tx, {
      donation_id,
      src,
      now: new Date().toISOString(),
    })
  );

/** a refund event's own takes, each its own part of the charge, given the
 * gift's takes on record; null when the event can't be sized */
function own_refunds(
  r: ChargeReversal,
  ref: string
): ((takes: ITake[]) => RefundTake[]) | null {
  const of = r.share?.of;
  if (r.refunds && of && of > 0) {
    return () =>
      r.refunds!.map((x) => ({
        ref: x.id,
        share: x.amount / of,
        refunded_at: x.created_at,
      }));
  }
  if (r.source === "dispute") return () => [];
  const refunded_at = r.refunded_at;
  const own = r.share && fraction_of(r.share);
  if (own) return () => [{ ref, share: own, refunded_at }];
  const to_date = r.refunded_to_date && fraction_of(r.refunded_to_date);
  if (!to_date) return null;
  return (takes) => {
    const others = takes
      .filter(
        (t) => t.kind === "refund" && t.status === "active" && t.ref !== ref
      )
      .reduce((sum, t) => sum + t.share, 0);
    return [{ ref, share: to_date - others, refunded_at }];
  };
}

/** whether the takes on record, with these refunds added in place of the
 * claims they pay, take the whole */
const refunds_take_all = (
  takes: ITake[],
  refunds: { ref: string; share: number }[]
) => {
  const left = takes.filter((t) => t.status === "active");
  let taken = left.reduce((sum, t) => sum + t.share, 0);
  for (const x of refunds) {
    if (x.share <= 0 || takes.some((t) => t.ref === x.ref)) continue;
    const claim = claim_paid(left, x.share);
    if (claim) {
      taken -= claim.share;
      left.splice(left.indexOf(claim), 1);
    }
    taken += x.share;
  }
  return taken >= 1;
};

/** part of the charge: each party's share recorded as owed, nothing reversed */
async function notify_share(
  r: ChargeReversal,
  res: { taken: number; owed_msgs: string[]; pending: string[] }
): Promise<ReversalResult> {
  const { owed_msgs, pending } = res;
  // awaited: a lost notice fails the delivery, so the provider redelivers it,
  // which records nothing more. keyed on the event, so it posts once
  await enqueue(
    msg("fiat-notice", {
      id: r.notice.id,
      alert: {
        type: "NOTICE",
        from: `${r.alert_from}-${stage}`,
        title:
          pending.length > 0
            ? REFUND_PENDING.title
            : owed_msgs.length > 0
              ? SHARE_OWED[r.source]
              : NOTHING_OWED[r.source],
        body: [
          ...r.notice.lines,
          `${humanize(res.taken * 100)}% of the charge taken back so far; the donation is not reversed.`,
          ...owed_msgs.map((m) => `owed: ${m}`),
          ...pending.map((m) => `not owed: ${m}`),
          ...(pending.length > 0 ? [REFUND_PENDING.action] : []),
        ].join("\n"),
      },
    })
  );
  return pending.length > 0
    ? { status: "partial_pending", owed_msgs }
    : { status: "partial_owed", owed_msgs };
}

/** whether `reverse_charge` would find dists to reverse, rather than answer
 * `not_distributed`. reads, plans nothing */
export async function has_settled_dists(donation_id: string) {
  return (await dists_for_refund(donation_id)).length > 0;
}

async function notify_dispute_lost(
  r: ChargeReversal,
  dists: number,
  res: RefundResult
) {
  const failed = res.failures.length;
  const title =
    failed === 0
      ? "Dispute Lost: Donation Reversed"
      : "Dispute Lost: Reversal Did Not Complete";
  const body = [
    ...r.notice.lines,
    failed === 0
      ? `all ${dists} dists reversed.`
      : `${failed} of ${dists} dists failed to reverse, and the donation stays settled.`,
    ...res.owed_msgs.map((m) => `owed: ${m}`),
  ].join("\n");
  // queued, not sent: once reversed, a redelivery stops at the guard, so only
  // the queue's retries can land a failed send. keyed on the outcome, so a
  // redelivery failing alike collapses into this notice
  await enqueue(
    msg("fiat-notice", {
      id: `${r.notice.id}_${failed}`,
      alert: { type: "NOTICE", from: `${r.alert_from}-${stage}`, title, body },
    })
  ).catch((err) =>
    report_error(err, { donation_id: r.donation_id, title, body })
  );
}

export interface DistPreview {
  id: string;
  npo_id: number;
  npo_name: string;
  /** usd */
  amount: number;
  net: number;
  refund_status: string | null;
  refund_error?: string | null;
  /** usd the npo would owe back, recovered from its future grants; 0 when none */
  owed: number;
  /** what will happen when the refund is processed */
  effects: PreviewLine[];
  /** blockers preventing the refund from proceeding */
  blockers: PreviewLine[];
  /** non-reversible items — refund proceeds; the npo or the referrer owes them back */
  warnings: PreviewLine[];
}

export interface ReversalPreview {
  /** one per settled dist; none means there is nothing to reverse yet */
  dists: DistPreview[];
}

/** what reversing `don` would do to each of its dists, writing nothing.
 * `sub_id` is the recurring gift the payment billed, if any */
export async function reversal_preview(
  don: IDonation,
  sub_id: string | null
): Promise<ReversalPreview> {
  const graphs = await dists_for_refund(don.id);

  const dists: DistPreview[] = [];
  for (const g of graphs) {
    const { dist } = g;
    const amount = dist_settled_usd({
      net: dist.net ?? 0,
      fee_base: dist.fee_base ?? 0,
      fee_fsa: dist.fee_fsa ?? 0,
      fee_processing: dist.fee_processing ?? 0,
      fee_allowance: dist.fee_allowance ?? 0,
      settled_net: dist.settled_net,
    });
    if (dist.refund_status === "completed" || dist.refund_status === "loss") {
      dists.push({
        id: dist.id,
        npo_id: dist.to_id ?? 0,
        npo_name: dist.to_name ?? "",
        amount,
        net: dist.net ?? 0,
        refund_status: dist.refund_status,
        owed: 0,
        effects: [
          {
            label:
              dist.refund_status === "loss"
                ? "Recorded as owed"
                : "Already completed",
            pass: true,
          },
        ],
        blockers: [],
        warnings: [],
      });
      continue;
    }
    const plan = await load_refund_plan(g, {
      form_id: don.form_id ?? null,
      program_id: don.program?.id ?? null,
      sub_id,
      strict: false,
    });
    const p = plan.preview;
    dists.push({
      id: dist.id,
      npo_id: dist.to_id ?? 0,
      npo_name: dist.to_name ?? "",
      amount,
      net: dist.net ?? 0,
      refund_status: dist.refund_status,
      refund_error: dist.refund_error,
      owed: plan.amount.find((a) => "npo_id" in a.party)?.usd ?? 0,
      // process_refund retries a failed dist, so it shows as a retry, not a blocker
      effects:
        dist.refund_status === "failed"
          ? [
              {
                label: "Retry failed reversal",
                pass: true,
                reason: dist.refund_error ?? "unknown",
              },
              ...p.effects,
            ]
          : p.effects,
      blockers: p.blockers,
      warnings: p.warnings,
    });
  }
  return { dists };
}
