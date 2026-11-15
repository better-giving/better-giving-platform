import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
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

import { npos } from "../schema/npo";
import { referrer_payouts } from "../schema/referrer";
import { create_test_db } from "../test-utils/pglite";
import { payout_ltd_get } from "./referrer";

const REF = "REF-NPO-1";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  const { db } = test_db.current!;
  await db.delete(referrer_payouts);
  await db.delete(npos);
  await db.insert(npos).values({
    registration_number: "EIN-REF",
    name: "Referrer NPO",
    endow_designation: "Charity",
    overview_pt: "[]",
    hq_country: "United States",
    active: true,
    referral_id: REF,
  });
});

test("lifetime payouts count only the transfers that went out", async () => {
  await test_db.current!.db.insert(referrer_payouts).values([
    { id: "p-1", referrer_npo: REF, amount: 40, date: "2026-09-01T00:00:00Z" },
    { id: "p-2", referrer_npo: REF, amount: 25, date: "2026-09-08T00:00:00Z" },
    {
      id: "p-err",
      referrer_npo: REF,
      amount: 100,
      date: "2026-09-15T00:00:00Z",
      error: "transfer not funded",
    },
  ]);
  expect(await payout_ltd_get(REF)).toBe(65);
});

test("a referrer whose only attempt failed has paid out nothing", async () => {
  await test_db.current!.db.insert(referrer_payouts).values({
    id: "p-err",
    referrer_npo: REF,
    amount: 100,
    date: "2026-09-15T00:00:00Z",
    error: "transfer not funded",
  });
  expect(await payout_ltd_get(REF)).toBe(0);
});

test("a returned transfer's money came back, so lifetime payouts leave it out", async () => {
  await test_db.current!.db.insert(referrer_payouts).values([
    { id: "p-1", referrer_npo: REF, amount: 40, date: "2026-09-01T00:00:00Z" },
    {
      id: "p-back",
      referrer_npo: REF,
      amount: 25,
      date: "2026-09-08T00:00:00Z",
      status: "returned",
    },
  ]);
  expect(await payout_ltd_get(REF)).toBe(40);
});
