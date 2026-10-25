import { dists } from "$/pg/schema/dist";
import { donations } from "$/pg/schema/donation";
import type { TestDb } from "$/pg/test-utils/pglite";

/** one settled gift of `usd` to `npo_id`, which `v_contributions` counts
 * toward the org's raised total and donor count */
export async function seed_contribution(
  db: TestDb["db"],
  npo_id: number,
  usd: number
) {
  const donation_id = crypto.randomUUID();
  await db.insert(donations).values({
    id: donation_id,
    upusd: usd,
    status: "settled",
    amount_base: usd,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "stripe",
    via: "card",
  });
  await db.insert(dists).values({
    id: crypto.randomUUID(),
    donation_id,
    status: "settled",
    date_created: new Date().toISOString(),
    to_id: npo_id,
    amount_denom: "USD",
    amount_usd: usd,
    net: usd,
  });
}
