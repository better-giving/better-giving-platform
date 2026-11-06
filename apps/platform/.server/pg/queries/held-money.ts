import { and, desc, eq, gt, sql } from "drizzle-orm";
import { snap } from "@/helpers/decimal";
import type { HeldRail, IHeldMoney } from "@/payouts";
import { payout_cents } from "../../payouts/amount";
import { dists } from "../schema/dist";
import { donations } from "../schema/donation";
import { payouts } from "../schema/payout";
import type { DbOrTx } from "./helpers";

/** display order of `by_rail` */
const RAILS: HeldRail[] = [
  "stripe",
  "paypal",
  "daf",
  "crypto",
  "stock_cheque",
  "withdrawal",
];

/**
 * the rail of a pending payout, from its source and, for a donation, the gift's
 * `via` (the values `via_name` in `@/donations/helpers` names). a stripe
 * payout is a pooled gift: a routed one books none. null for a donation payout
 * whose dist is gone, so its rail is unknown.
 */
const rail = sql<HeldRail | null>`case
  when ${payouts.source} in ('liq', 'lock') then 'withdrawal'
  when ${donations.via} is null then null
  when ${donations.via} like 'stripe%' then 'stripe'
  when ${donations.via} like 'paypal%' or ${donations.via} = 'venmo' then 'paypal'
  when ${donations.via} like 'chariot%' or ${donations.via} = 'daf' then 'daf'
  when ${donations.via} like 'crypto%' then 'crypto'
  else 'stock_cheque'
end`;

/**
 * what `npo_id` is owed by its pending payouts, in usd, by the rail each came
 * in on. a pending payout waits for a bank payout, so for an npo without a
 * bank this is the money it holds. routed stripe gifts book no payout and
 * never appear.
 */
export async function held_money(
  pg: DbOrTx,
  npo_id: number
): Promise<IHeldMoney> {
  const rows = await pg
    .select({ rail, date: payouts.date, amount: payouts.amount })
    .from(payouts)
    .leftJoin(
      dists,
      and(eq(payouts.source, "donation"), eq(dists.id, payouts.source_id))
    )
    .leftJoin(donations, eq(donations.id, dists.donation_id))
    .where(and(eq(payouts.npo_id, npo_id), eq(payouts.type, "pending")))
    .orderBy(desc(payouts.date), desc(payouts.id));

  const held = rows.flatMap((r) => (r.rail ? [{ ...r, rail: r.rail }] : []));
  const total_cents = payout_cents(held.map((r) => r.amount));

  const rails = RAILS.flatMap((rail) => {
    const of_rail = held.filter((r) => r.rail === rail);
    return of_rail.length ? [{ rail, items: of_rail }] : [];
  });
  const rail_cents = apportion_cents(
    rails.map((r) => r.items.map((i) => i.amount).reduce((a, b) => a + b, 0)),
    total_cents
  );

  const item_cents = new Map<(typeof held)[number], number>();
  rails.forEach(({ items }, i) => {
    const cents = apportion_cents(
      items.map((x) => x.amount),
      rail_cents[i]
    );
    items.forEach((x, j) => {
      item_cents.set(x, cents[j]);
    });
  });

  return {
    total: total_cents / 100,
    by_rail: rails.map(({ rail }, i) => ({
      rail,
      amount: rail_cents[i] / 100,
    })),
    items: held.map((x) => ({
      rail: x.rail,
      date: x.date,
      amount: (item_cents.get(x) ?? 0) / 100,
    })),
  };
}

/** whether `held_money` holds anything, off one row rather than every
 * pending payout: a load-more needs only this */
export async function has_held_money(
  pg: DbOrTx,
  npo_id: number
): Promise<boolean> {
  const [row] = await pg
    .select({ id: payouts.id })
    .from(payouts)
    .leftJoin(
      dists,
      and(eq(payouts.source, "donation"), eq(dists.id, payouts.source_id))
    )
    .leftJoin(donations, eq(donations.id, dists.donation_id))
    .where(
      and(
        eq(payouts.npo_id, npo_id),
        eq(payouts.type, "pending"),
        gt(payouts.amount, 0),
        sql`${rail} is not null`
      )
    )
    .limit(1);
  return !!row;
}

/**
 * splits `total_cents` over `amounts` (usd) by largest remainder: each takes
 * its whole cents, and the cents left over go one each to the largest
 * fractions, the earlier on a tie. `total_cents` is at least the floors' sum
 * and at most one cent more per fractional amount, as `payout_cents` of their
 * sum always is.
 */
function apportion_cents(amounts: number[], total_cents: number): number[] {
  const scaled = amounts.map((a) => snap(a * 100));
  const cents = scaled.map(Math.floor);
  let left = total_cents - cents.reduce((a, b) => a + b, 0);
  const by_fraction = scaled
    .map((s, i) => ({ i, fraction: snap(s - cents[i]) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (const { i } of by_fraction) {
    if (left <= 0) break;
    cents[i]++;
    left--;
  }
  return cents;
}
