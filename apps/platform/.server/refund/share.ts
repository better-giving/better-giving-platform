import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { is_unsent } from "@/payouts";
import type { DbOrTx } from "../pg/queries/helpers";
import {
  credit_owed,
  figure_of,
  type IOwed,
  type IOwedRecord,
  type OwedCreditReason,
  type OwedParty,
  owed_total,
  owed_uncredited,
} from "../pg/queries/owed";
import { dists } from "../pg/schema/dist";
import { payouts } from "../pg/schema/payout";
import { referrer_commissions } from "../pg/schema/referrer";
import {
  dist_settled_usd,
  fee_processing_usd,
  past_cut,
  type RefundPlan,
  referrer_of,
  scaled,
  share_of_net,
} from "./plan";

/** a part of a charge, `taken` of `of`, in one unit */
export interface Share {
  taken: number;
  of: number;
}

/** the whole charge, for a caller that only ever takes all of it back */
export const WHOLE: Share = { taken: 1, of: 1 };

/** `taken` over `of`, at most 1; null when either can't size the charge */
export function fraction_of(s: Share): number | null {
  const { taken, of } = s;
  if (!Number.isFinite(taken) || !Number.isFinite(of)) return null;
  if (taken <= 0 || of <= 0) return null;
  return Math.min(taken / of, 1);
}

type PayoutType = (typeof payouts.$inferSelect)["type"];

export type LockedDist = Awaited<ReturnType<typeof dists_locked>>[number];

/** the gift's dists not yet reversed, each with its commission and its
 * payout's type, held locked: a reversal of one waits */
export const settled_dists_locked = (tx: DbOrTx, donation_id: string) =>
  dists_locked(
    tx,
    and(eq(dists.donation_id, donation_id), eq(dists.status, "settled"))
  );

/** `settled_dists_locked`, reversed dists included */
export const gift_dists_locked = (tx: DbOrTx, donation_id: string) =>
  dists_locked(tx, eq(dists.donation_id, donation_id));

/**
 * one lock order for a gift's rows, on every path that takes more than one:
 * its donation (`donation_lock`), its dists, a dist's payout, then the npo
 * (`npo_get_locked`), each path taking the ones it needs in that order. two
 * take it out of order, neither able to deadlock: `settle_npo` locks its npo
 * before `owe_takes` locks the gift's other dists, under a share lock on the
 * donation that every path locking the donation waits out, and no path
 * holding another npo's dist waits on this one's npo; a grant run's release
 * holds its own claim's payouts before `reverse_unfunded_payout_loss` takes
 * a donation, and no other path holding a donation waits on a claimed payout.
 * a netting run's release also holds its npo by then, so a refund holding one
 * of that npo's donations can still deadlock it. postgres aborts one side: a
 * losing reversal rolls back only its savepoint, so that payout is `kept` and
 * alerted for repair by hand while the release still returns `released`
 */
async function dists_locked(tx: DbOrTx, where: SQL | undefined) {
  const rows = await tx
    .select({
      id: dists.id,
      status: dists.status,
      refund_status: dists.refund_status,
      to_id: dists.to_id,
      to_name: dists.to_name,
      net: dists.net,
      fee_base: dists.fee_base,
      fee_fsa: dists.fee_fsa,
      fee_processing: dists.fee_processing,
      fee_allowance: dists.fee_allowance,
      alloc: dists.alloc,
      routed_to: dists.stripe_routed_to,
      refunds_cut_share: dists.refunds_cut_share,
      settled_net: dists.settled_net,
      // a subquery, not a join: nothing keeps a dist to one payout row, and a
      // second would count the dist twice. any one, as `dists_for_refund` takes
      payout_type: sql<PayoutType | null>`(SELECT ${payouts.type} FROM ${payouts}
        WHERE ${payouts.source_id} = ${dists.id} AND ${payouts.source} = 'donation'
        LIMIT 1)`,
      commission: {
        amount: referrer_commissions.amount,
        status: referrer_commissions.status,
        referrer_user: referrer_commissions.referrer_user,
        referrer_npo: referrer_commissions.referrer_npo,
        ref: referrer_commissions.ref,
      },
    })
    .from(dists)
    .leftJoin(
      referrer_commissions,
      eq(referrer_commissions.donation_id, dists.id)
    )
    .where(where)
    .orderBy(asc(dists.id))
    .for("update", { of: dists });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    refund_status: r.refund_status,
    to_id: r.to_id ?? 0,
    to_name: r.to_name ?? "",
    net: r.net ?? 0,
    fee_base: r.fee_base ?? 0,
    fee_fsa: r.fee_fsa ?? 0,
    fee_processing: r.fee_processing ?? 0,
    fee_allowance: r.fee_allowance ?? 0,
    cash_pct: r.alloc?.cash ?? 0,
    /** settled to a connected account: paid by a stripe transfer, which a
     * refund reverses, so no grant of it is ours to settle by hand */
    routed: r.routed_to !== null,
    refunds_cut_share: r.refunds_cut_share,
    settled_net: r.settled_net,
    payout_type: r.payout_type,
    commission: r.commission,
  }));
}

/** what a reversal taking `taken` from the npo's balances credits on the row
 * a dispute's open recorded: no more than the row counts it received, so a
 * share recorded at open keeps its fees owed */
export const open_credit = (row: IOwed, taken: number) =>
  Math.min(
    taken,
    row.received_usd,
    owed_total(row) - row.credited_back_usd - row.written_off_usd
  );

/** usd the plan takes back from the npo's balances and pending payout */
export const taken_from_npo = (plan: RefundPlan): number =>
  plan.effects.reduce(
    (sum, e) =>
      e.kind === "balance_update"
        ? sum + e.deltas.liq + e.deltas.lock + e.deltas.cash
        : sum,
    0
  );

/** whether the dist's grant has gone out: a payout of its cash share neither
 * unsent (`is_unsent`) nor void, as the refund plan judges it a loss */
export const grant_went_out = (d: LockedDist) =>
  d.cash_pct > 0 &&
  d.payout_type !== null &&
  !is_unsent(d.payout_type) &&
  d.payout_type !== "void";

/** the part of the dist its npo can owe for, fees included: all of it, less
 * a void payout's cash share, which left the npo and was never a grant, so
 * the platform takes its loss */
export const owable_part = (d: LockedDist) =>
  d.payout_type === "void" ? 1 - d.cash_pct / 100 : 1;

export type OwedShare = Pick<
  IOwedRecord,
  "party" | "received_usd" | "fee_processing_usd" | "fee_dispute_usd"
>;

/** one figure per party: for each dist `owes` picks, its npo owes `f` of
 * the charge past its refunds' cut (`past_cut`) of what the dist received
 * and of its card fee, plus its part of the dispute fee by settled amount,
 * in full; each referrer `f` of its commissions paid
 * or claimed for a transfer: one whose transfer goes unfunded goes back to
 * pending, and the run that pays it later nets what this recorded */
export function owed_shares(
  ds: LockedDist[],
  o: {
    f: number;
    /** the npo part's share of the charge past the dist's cut, when not
     * `f` past it */
    f_of?: (d: LockedDist) => number;
    /** the dispute fee, split over the dists by settled amount; or each
     * dist's part of it already split */
    fee_usd: number | number[];
    owes: (d: LockedDist) => boolean;
  }
): OwedShare[] {
  const fee_shares = Array.isArray(o.fee_usd)
    ? o.fee_usd
    : split_cents(o.fee_usd, ds.map(dist_settled_usd));
  const by_party = new Map<string, OwedShare>();
  const add = (key: string, s: OwedShare) => {
    const was = by_party.get(key);
    by_party.set(
      key,
      was
        ? {
            party: s.party,
            received_usd: was.received_usd + s.received_usd,
            fee_processing_usd: was.fee_processing_usd + s.fee_processing_usd,
            fee_dispute_usd:
              (was.fee_dispute_usd ?? 0) + (s.fee_dispute_usd ?? 0),
          }
        : s
    );
  };
  for (const [i, x] of ds.entries()) {
    const part = owable_part(x);
    if (o.owes(x) && part > 0) {
      const f = o.f_of?.(x) ?? past_cut(x.refunds_cut_share, o.f);
      add(`npo:${x.to_id}`, {
        party: { npo_id: x.to_id },
        received_usd: scaled(
          x.net,
          share_of_net(x.refunds_cut_share, f) * part
        ),
        fee_processing_usd: scaled(fee_processing_usd(x), f * part),
        fee_dispute_usd: scaled(fee_shares[i]!, part),
      });
    }
    const c = x.commission;
    if (c?.status !== "paid" && c?.status !== "processing") continue;
    const party = referrer_of(c);
    add(`ref:${JSON.stringify(party)}`, {
      party,
      received_usd: scaled(c.amount, o.f),
      fee_processing_usd: 0,
    });
  }
  return [...by_party.values()];
}

/** `usd` split in whole cents in proportion to `weights`, the cents rounding
 * leaves going to the largest remainders, so the shares sum to `usd` */
export function split_cents(usd: number, weights: number[]): number[] {
  const cents = Math.round(usd * 100);
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (cents * w) / total);
  const shares = exact.map(Math.floor);
  let left = cents - shares.reduce((s, c) => s + c, 0);
  const by_remainder = exact
    .map((e, i) => [e - shares[i]!, i] as const)
    .sort((a, b) => b[0] - a[0]);
  for (const [, i] of by_remainder) {
    if (left-- <= 0) break;
    shares[i]! += 1;
  }
  return shares.map((c) => c / 100);
}

/** one part of an event credited back, under its own reason so a later
 * record of the row adds it back onto that figure; keyed on `ref` */
export type CreditPart = readonly [
  reason: OwedCreditReason,
  usd: number,
  ref: string,
];

/** credits each part back on `row`, each capped at what its own figure
 * still holds and at what the row can still be credited; a part already
 * credited under its ref adds nothing. the row as it stands after */
export async function credit_parts(
  tx: DbOrTx,
  row: IOwed,
  c: { donation_id: string; party: OwedParty; now: string },
  parts: CreditPart[]
): Promise<IOwed> {
  let cur = row;
  const left = await owed_uncredited(tx, row);
  for (const [reason, usd, ref] of parts) {
    const figure = figure_of(reason);
    // each to 1e-9: summed in floats, 65.24 - 64.28 would cap 0.96 at
    // 0.9599…, and 2.24 - 1.28 credit 0.9600…02, past what the row holds
    const creditable = to_nano(
      owed_total(cur) - cur.credited_back_usd - cur.written_off_usd
    );
    const credit = Math.min(
      to_nano(usd),
      creditable,
      figure ? to_nano(left[figure]) : Number.POSITIVE_INFINITY
    );
    if (credit <= 0) continue;
    if (figure) left[figure] -= credit;
    cur = (await credit_owed(tx, { ...c, usd: credit, reason, ref })) ?? cur;
  }
  return cur;
}

const to_nano = (usd: number) => Math.round(usd * 1e9) / 1e9;
