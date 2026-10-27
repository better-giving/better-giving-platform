import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

// the queries read the module-level handle rather than taking one, so the
// pglite db is swapped in behind it.
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

import { types } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { dists } from "../schema/dist";
import { donations } from "../schema/donation";
import { npos } from "../schema/npo";
import { create_test_db } from "../test-utils/pglite";
import { npo_get, npo_search } from "./npo";

let npo_id: number;

beforeAll(async () => {
  test_db.current = await create_test_db();
  // neon hands int8 over as text (pg-types' default); pglite parses it to a
  // number, which would hide a bigint site that skips its decoder
  test_db.current.client.parsers[types.INT8] = (v: string) => v;
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  const { db } = test_db.current!;
  await db.delete(dists);
  await db.delete(donations);
  await db.delete(npos);
  const [npo] = await db
    .insert(npos)
    .values({
      registration_number: "EIN-CONTRIB",
      name: "Contrib NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      active: true,
    })
    .returning();
  npo_id = npo!.id;
});

/** one settled dist to the npo per usd amount */
async function seed_settled(amounts: number[]) {
  const { db } = test_db.current!;
  for (const amount_usd of amounts) {
    const donation_id = crypto.randomUUID();
    await db.insert(donations).values({
      id: donation_id,
      upusd: amount_usd,
      status: "settled",
      amount_base: amount_usd,
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
      amount_usd,
    });
  }
}

test("npo_get reads settled contributions as numbers", async () => {
  await seed_settled([4.53, 10.25]);
  const npo = await npo_get(npo_id);
  expect(npo).toMatchObject({
    contributions_total: 14.78,
    contributions_count: 2,
  });
});

test("npo_get reads zero contributions as numbers when none settled", async () => {
  const npo = await npo_get(npo_id);
  expect(npo).toMatchObject({ contributions_total: 0, contributions_count: 0 });
});

test("npo_search items read settled contributions as numbers", async () => {
  await seed_settled([4.53, 10.25]);
  const page = await npo_search({});
  expect(page.items).toMatchObject([
    { id: npo_id, contributions_total: 14.78, contributions_count: 2 },
  ]);
});

test("npo_search items carry the npo's logo and banner", async () => {
  const { db } = test_db.current!;
  await db
    .update(npos)
    .set({
      logo: "https://x.test/logo.png",
      image: "https://x.test/banner.png",
    })
    .where(eq(npos.id, npo_id));
  const page = await npo_search({});
  expect(page.items).toMatchObject([
    {
      id: npo_id,
      logo: "https://x.test/logo.png",
      image: "https://x.test/banner.png",
    },
  ]);
});
