import { and, desc, eq, sql } from "drizzle-orm";
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

  const items: IHeldMoney["items"] = [];
  const amounts = new Map<HeldRail, number[]>();
  for (const r of rows) {
    if (!r.rail) continue;
    items.push({
      rail: r.rail,
      date: r.date,
      amount: payout_cents([r.amount]) / 100,
    });
    const rail_amounts = amounts.get(r.rail) ?? [];
    rail_amounts.push(r.amount);
    amounts.set(r.rail, rail_amounts);
  }

  const by_rail = RAILS.flatMap((rail) => {
    const cents = payout_cents(amounts.get(rail) ?? []);
    return cents > 0 ? [{ rail, cents }] : [];
  });
  const total_cents = by_rail.reduce((s, r) => s + r.cents, 0);

  return {
    total: total_cents / 100,
    by_rail: by_rail.map(({ rail, cents }) => ({ rail, amount: cents / 100 })),
    items,
  };
}
