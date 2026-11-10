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

import { seed_npo } from "#/__tests__/fixtures/funds";
import { seed_owed } from "#/__tests__/fixtures/owed";
import { dists } from "../schema/dist";
import { donations } from "../schema/donation";
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
  const base = {
    status: "refunded" as const,
    date_created: "2026-07-01T00:00:00.000Z",
    amount_denom: "USD",
    net: 40,
  };
  await db.insert(dists).values([
    { ...base, id: "d-owed", donation_id: owed_gift!.id, to_id: npo.id },
    { ...base, id: "d-clean", donation_id: "don-clean", to_id: npo.id },
    { ...base, id: "d-other", donation_id: owed_gift!.id, to_id: other.id },
  ]);

  expect((await npo_donation_get("d-owed"))?.owed_back).toBe(true);
  expect((await npo_donation_get("d-clean"))?.owed_back).toBe(false);
  expect((await npo_donation_get("d-other"))?.owed_back).toBe(false);
});
