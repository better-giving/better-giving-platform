import { eq } from "drizzle-orm";
import { user } from "$/pg/schema/auth";
import { bal_txs } from "$/pg/schema/bal-tx";
import { donation_disputes } from "$/pg/schema/dispute";
import { dists } from "$/pg/schema/dist";
import {
  donation_recipients,
  donation_settlements,
  donations,
} from "$/pg/schema/donation";
import { npos } from "$/pg/schema/npo";
import { payouts } from "$/pg/schema/payout";
import { referrer_commissions } from "$/pg/schema/referrer";
import { loss_logs } from "$/pg/schema/revenue";
import { donation_takes } from "$/pg/schema/take";
import type { TestDb } from "$/pg/test-utils/pglite";
import { seed_npo, seed_user } from "./funds";

type Db = TestDb["db"];

export interface IDistSeed {
  /** settled usd: net + card fee + bg's fees */
  net: number;
  fee_processing: number;
  fee_base: number;
  /** the grant run's payout of the dist's cash, or `savings` for a dist
   * credited whole to the npo's savings balance, which has no payout, or
   * `routed` for one settled to the npo's connected account and paid by the
   * stripe transfer `transfer_of` names, which has neither. `returned`: its
   * transfer came back, so the npo's cash holds it again; `void`: voided by
   * ops after it settled, so the cash doesn't */
  payout: "pending" | "settled" | "returned" | "void" | "savings" | "routed";
  /** percent of net credited to savings beside a payout's cash share, which
   * is the rest; 0 when unset */
  savings?: number;
}

/** the stripe transfer that paid the routed dist `i` of `gift` */
export const transfer_of = (gift: { id: string }, i = 0) =>
  `tr_dist-${gift.id}-${i}`;

/** a $100 card gift: $90 net, $3.20 card fee, its grant paid */
export const PAID_GRANT: IDistSeed = {
  net: 90,
  fee_processing: 3.2,
  fee_base: 6.8,
  payout: "settled",
};

/** a $100 card gift routed to its npo's connected account: $90 net, $3.20
 * card fee, paid by a $90 transfer */
export const ROUTED: IDistSeed = { ...PAID_GRANT, payout: "routed" };

/** the owed ledger's rows hold the gifts, so the caller clears them first */
export async function clear_card_gifts(db: Db) {
  await db.delete(bal_txs);
  await db.delete(loss_logs);
  await db.delete(donation_disputes);
  await db.delete(donation_takes);
  await db.delete(payouts);
  await db.delete(referrer_commissions);
  await db.delete(dists);
  await db.delete(donation_settlements);
  await db.delete(donation_recipients);
  await db.delete(donations);
  await db.delete(npos);
  await db.delete(user);
}

let counter = 0;

/** a settled stripe card gift with one cash dist per entry, each to its own
 * npo; `sttl_id` is the payment intent that settled it */
export async function seed_card_gift(db: Db, ...ds: IDistSeed[]) {
  counter++;
  const id = `don-${counter}`;
  const sttl_id = `pi_${counter}`;
  const gross = ds.reduce(
    (s, d) => s + d.net + d.fee_processing + d.fee_base,
    0
  );
  await db.insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: gross,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db.insert(donation_settlements).values({
    donation_id: id,
    sttl_id,
    // on the recovery cutoff, so a refund may still take ungranted funds
    date: "2026-10-23T16:00:00.000Z",
    currency: "USD",
    net: gross - 3.2,
    fee: 3.2,
  });
  const npo_ids: number[] = [];
  for (const [i, d] of ds.entries()) {
    const liq_pct = d.payout === "savings" ? 100 : (d.savings ?? 0);
    const cash_share = (d.net * (100 - liq_pct)) / 100;
    const npo = await seed_npo(db, {
      registration_number: `EIN-CARD-${counter}-${i}`,
      name: `NPO ${counter}-${i}`,
      cash: d.payout === "pending" || d.payout === "returned" ? cash_share : 0,
      liq: d.net - cash_share,
      ...(d.payout === "routed" && {
        stripe_account_id: `acct_${counter}_${i}`,
      }),
    });
    npo_ids.push(npo!.id);
    const dist_id = `dist-${id}-${i}`;
    await db.insert(dists).values({
      id: dist_id,
      donation_id: id,
      status: "settled",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id: npo!.id,
      to_name: npo!.name,
      amount: d.net + d.fee_processing + d.fee_base,
      amount_usd: d.net + d.fee_processing + d.fee_base,
      amount_denom: "USD",
      net: d.net,
      fee_base: d.fee_base,
      fee_fsa: 0,
      fee_processing: d.fee_processing,
      alloc: { liq: liq_pct, lock: 0, cash: 100 - liq_pct },
      ...(d.payout === "routed" && {
        stripe_routed_to: `acct_${counter}_${i}`,
        stripe_transfer_id: transfer_of({ id }, i),
      }),
    });
    if (d.payout === "savings" || d.payout === "routed") continue;
    await db.insert(payouts).values({
      id: `payout-${dist_id}`,
      source_id: dist_id,
      npo_id: npo!.id,
      source: "donation",
      date: "2026-07-01T00:00:00.000Z",
      amount: cash_share,
      type: d.payout,
      ...(d.payout !== "pending" && {
        settled_date: "2026-07-02T00:00:00.000Z",
      }),
    });
  }
  await db.insert(donation_recipients).values({
    donation_id: id,
    npo_id: npo_ids[0],
    name: "recipient",
    type: "npo",
  });
  return { id, sttl_id, npo_ids };
}

/** a `usd` commission on the gift's first dist, paid to the referrer with
 * `code` */
export async function seed_paid_commission(
  db: Db,
  gift: { id: string; npo_ids: number[] },
  code: string,
  usd: number
) {
  const referrer = await seed_user(db, `${code.toLowerCase()}@test.com`);
  await db
    .update(user)
    .set({ referral_code: code })
    .where(eq(user.id, referrer!.id));
  await db.insert(referrer_commissions).values({
    referrer_user: code,
    date: "2026-07-01T00:00:00.000Z",
    donation_id: `dist-${gift.id}-0`,
    npo_id: gift.npo_ids[0]!,
    amount: usd,
    status: "paid",
  });
}

/** the npo's savings and grant cash, in usd */
export async function balance_of(db: Db, npo_id: number) {
  const [row] = await db
    .select({ liq: npos.liq, cash: npos.cash })
    .from(npos)
    .where(eq(npos.id, npo_id));
  return (row?.liq ?? 0) + (row?.cash ?? 0);
}

/** the gift's disputes on record, by provider id */
export function disputes_of(db: Db, donation_id: string) {
  return db
    .select()
    .from(donation_disputes)
    .where(eq(donation_disputes.donation_id, donation_id))
    .orderBy(donation_disputes.id);
}
