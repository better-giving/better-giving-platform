import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("../db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));

import { eq } from "drizzle-orm";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { seed_owed } from "#/__tests__/fixtures/owed";
import { dists } from "../schema/dist";
import { donations } from "../schema/donation";
import { owed_amounts } from "../schema/owed";
import { create_test_db } from "../test-utils/pglite";
import { npo_donation_get } from "./dist";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

test("a dist reads owed back only when its gift has an owed row for its npo", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-OWED" }))!;
  const other = (await seed_npo(db, { registration_number: "EIN-OTHER" }))!;
  await seed_owed(db, npo.id, 40);
  const [owed_gift] = await db.select({ id: donations.id }).from(donations);
  await db.insert(donations).values({
    id: "don-clean",
    upusd: 1,
    status: "settled",
    amount_base: 40,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db.insert(donations).values({
    id: "don-fee",
    upusd: 1,
    status: "refunded_loss",
    amount_base: 40,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db.insert(owed_amounts).values({
    donation_id: "don-fee",
    npo_id: npo.id,
    source: "dispute",
    source_ref: "dp_1",
    recorded_at: "2026-09-15T00:00:00.000Z",
    received_usd: 0,
    fee_dispute_usd: 15,
  });
  const base = {
    status: "refunded" as const,
    date_created: "2026-07-01T00:00:00.000Z",
    amount_denom: "USD",
    net: 40,
  };
  await db.insert(dists).values([
    { ...base, id: "d-owed", donation_id: owed_gift!.id, to_id: npo.id },
    { ...base, id: "d-clean", donation_id: "don-clean", to_id: npo.id },
    { ...base, id: "d-fee", donation_id: "don-fee", to_id: npo.id },
    { ...base, id: "d-other", donation_id: owed_gift!.id, to_id: other.id },
  ]);

  expect((await npo_donation_get("d-owed"))?.owed_back).toBe(true);
  expect((await npo_donation_get("d-clean"))?.owed_back).toBe(false);
  expect((await npo_donation_get("d-other"))?.owed_back).toBe(false);
  // a dispute fee alone is not money the npo kept
  expect((await npo_donation_get("d-fee"))?.owed_back).toBe(false);
});

test("a dist whose owed row is settled stays owed back but is no longer open", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-SETTLED" }))!;
  const admin = (await seed_user(db, "settled@example.com"))!;
  await seed_owed(db, npo.id, 40);
  await seed_owed(db, npo.id, 40);
  await seed_owed(db, npo.id, 40);
  const rows = await db
    .select({ id: owed_amounts.id, donation_id: owed_amounts.donation_id })
    .from(owed_amounts)
    .where(eq(owed_amounts.npo_id, npo.id))
    .orderBy(owed_amounts.id);
  const [open, recovered, written_off] = rows;
  const at = "2026-10-01T00:00:00.000Z";
  await db
    .update(owed_amounts)
    .set({ recovered_usd: 40, recovered_at: at })
    .where(eq(owed_amounts.id, recovered!.id));
  await db
    .update(owed_amounts)
    .set({
      written_off_usd: 40,
      written_off_at: at,
      write_off_reason: "uncollectable",
      written_off_by: admin.id,
    })
    .where(eq(owed_amounts.id, written_off!.id));
  await db.insert(dists).values(
    [open!, recovered!, written_off!].map((o, i) => ({
      id: `d-settle-${i}`,
      donation_id: o.donation_id,
      to_id: npo.id,
      status: "refunded" as const,
      date_created: "2026-07-01T00:00:00.000Z",
      amount_denom: "USD",
      net: 40,
    }))
  );

  const read = async (id: string) => {
    const d = await npo_donation_get(id);
    return [d?.owed_back, d?.owed_open];
  };
  expect(await read("d-settle-0")).toEqual([true, true]);
  expect(await read("d-settle-1")).toEqual([true, false]);
  expect(await read("d-settle-2")).toEqual([true, false]);
});

// one owed row per gift per party, so a gift's settled and open rows belong
// to different parties
const settle_at = "2026-10-01T00:00:00.000Z";

async function owed_dist(
  npo_id: number,
  id: string,
  usd: number,
  settled: Partial<typeof owed_amounts.$inferInsert> = {}
) {
  const { db } = test_db.current!;
  const donation_id = `don-${id}`;
  await db.insert(donations).values({
    id: donation_id,
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
  await db.insert(dists).values({
    id,
    donation_id,
    to_id: npo_id,
    status: "refunded",
    date_created: "2026-07-01T00:00:00.000Z",
    amount_denom: "USD",
    net: usd,
  });
  await owe_on(donation_id, npo_id, usd, settled);
  return donation_id;
}

async function owe_on(
  donation_id: string,
  npo_id: number,
  usd: number,
  settled: Partial<typeof owed_amounts.$inferInsert> = {}
) {
  await test_db.current!.db.insert(owed_amounts).values({
    donation_id,
    npo_id,
    source: "refund",
    source_ref: `re_${donation_id}_${npo_id}`,
    recorded_at: "2026-09-15T00:00:00.000Z",
    received_usd: usd,
    ...settled,
  });
}

const owed_state = async (id: string) => {
  const d = await npo_donation_get(id);
  return [d?.owed_back, d?.owed_open];
};

test("a row credited back is owed back but no longer open", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-CRED" }))!;
  await owed_dist(npo.id, "d-cred", 40, {
    credited_back_usd: 40,
    credited_back_at: settle_at,
  });
  expect(await owed_state("d-cred")).toEqual([true, false]);
});

test("a row settled in part stays open, and a residue under a cent reads settled", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-PART" }))!;
  await owed_dist(npo.id, "d-part", 40, {
    recovered_usd: 10,
    recovered_at: settle_at,
  });
  await owed_dist(npo.id, "d-cent", 40, {
    recovered_usd: 39.99,
    recovered_at: settle_at,
  });
  await owed_dist(npo.id, "d-dust", 40, {
    recovered_usd: 39.995,
    recovered_at: settle_at,
  });
  expect(await owed_state("d-part")).toEqual([true, true]);
  // exactly a cent outstanding is still owed
  expect(await owed_state("d-cent")).toEqual([true, true]);
  expect(await owed_state("d-dust")).toEqual([true, false]);
});

test("another party's open row on the gift does not hold this npo's settled row open", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-MINE" }))!;
  const other = (await seed_npo(db, { registration_number: "EIN-THEIRS" }))!;
  const gift = await owed_dist(npo.id, "d-mine", 40, {
    recovered_usd: 40,
    recovered_at: settle_at,
  });
  await owe_on(gift, other.id, 40);
  expect(await owed_state("d-mine")).toEqual([true, false]);

  // the same gift with this npo's own row open reads open
  const gift2 = await owed_dist(npo.id, "d-mine-open", 40);
  await owe_on(gift2, other.id, 40, {
    recovered_usd: 40,
    recovered_at: settle_at,
  });
  expect(await owed_state("d-mine-open")).toEqual([true, true]);
});
