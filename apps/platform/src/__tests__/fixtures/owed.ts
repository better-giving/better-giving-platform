import { dists } from "$/pg/schema/dist";
import { donations } from "$/pg/schema/donation";
import { owed_amounts, owed_notices } from "$/pg/schema/owed";
import { payouts } from "$/pg/schema/payout";
import type { Db } from "./funds";

let n = 0;

/** a pending PayPal payout of `amount`, held for want of a bank */
export async function seed_held(db: Db, npo_id: number, amount: number) {
  const id = `held-${++n}`;
  await db.insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: amount,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "paypal",
  });
  await db.insert(dists).values({
    id: `dist-${id}`,
    donation_id: id,
    status: "settled",
    date_created: "2026-10-01T00:00:00.000Z",
    to_id: npo_id,
    amount_denom: "USD",
    net: amount,
  });
  await db.insert(payouts).values({
    id: `payout-${id}`,
    source_id: `dist-${id}`,
    npo_id,
    source: "donation",
    date: "2026-10-01T00:00:00.000Z",
    amount,
    type: "pending",
  });
}

/** a gift refunded after its grant went out, the npo owing `usd` on it, with
 * the notice already sent so a run may net it */
export async function seed_owed(db: Db, npo_id: number, usd: number) {
  const id = `owed-${++n}`;
  await db.insert(donations).values({
    id,
    created_at: "2026-08-01T00:00:00.000Z",
    upusd: 1,
    status: "refunded_loss",
    amount_base: usd,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  const [owed] = await db
    .insert(owed_amounts)
    .values({
      donation_id: id,
      npo_id,
      source: "refund",
      source_ref: `re_${id}`,
      recorded_at: "2026-09-15T00:00:00.000Z",
      received_usd: usd,
    })
    .returning({ id: owed_amounts.id });
  await db.insert(owed_notices).values({
    owed_id: owed!.id,
    kind: "recorded",
    created_at: "2026-09-15T00:00:00.000Z",
    sent_at: "2026-09-15T00:00:00.000Z",
  });
}
