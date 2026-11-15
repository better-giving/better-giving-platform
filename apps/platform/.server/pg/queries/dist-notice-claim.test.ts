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

import { eq } from "drizzle-orm";
import { country_metrics } from "../schema/country";
import { dists } from "../schema/dist";
import { donations } from "../schema/donation";
import { create_test_db } from "../test-utils/pglite";
import { country_update } from "./country";
import {
  claim_dist_notice,
  count_dist_metric,
  DIST_NOTICE_LEASE_MS,
  mark_dist_hooks_sent,
  mark_dist_notice_sent,
  release_dist_notice,
} from "./dist";

const DIST_ID = "dist-1";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  const { db } = test_db.current!;
  await db.delete(dists);
  await db.delete(country_metrics);
  await db.delete(donations);
  await db.insert(donations).values({
    id: "don-1",
    upusd: 1,
    status: "settled",
    amount_base: 50,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db.insert(dists).values({
    id: DIST_ID,
    donation_id: "don-1",
    status: "settled",
    date_created: new Date().toISOString(),
    amount_denom: "USD",
  });
});

const notice_of = async (id = DIST_ID) => {
  const [row] = await test_db
    .current!.db.select({
      claimed: dists.notice_claimed_at,
      sent: dists.notice_sent_at,
    })
    .from(dists)
    .where(eq(dists.id, id));
  return row!;
};

test("the first claim wins and a redelivery inside the lease finds it busy", async () => {
  expect(await claim_dist_notice(DIST_ID)).toMatchObject({ status: "claimed" });
  expect(await claim_dist_notice(DIST_ID)).toEqual({ status: "busy" });
  expect((await notice_of()).claimed).not.toBeNull();
});

const claim_stamp = async () => {
  const c = await claim_dist_notice(DIST_ID);
  if (c.status !== "claimed")
    throw new Error(`expected a claim, got ${c.status}`);
  return c.stamp;
};

const expire_claim = async () => {
  const { db } = test_db.current!;
  const stale = new Date(Date.now() - DIST_NOTICE_LEASE_MS - 1000);
  await db
    .update(dists)
    .set({ notice_claimed_at: stale.toISOString() })
    .where(eq(dists.id, DIST_ID));
};

test("a holder that releases after a throw lets the redelivery claim", async () => {
  await release_dist_notice(DIST_ID, await claim_stamp());
  expect((await notice_of()).claimed).toBeNull();
  expect(await claim_dist_notice(DIST_ID)).toMatchObject({ status: "claimed" });
});

test("a holder that outlived its lease cannot release the claim taken since", async () => {
  const late = await claim_stamp();
  await expire_claim();
  // stamps are millisecond-truncated `now()`: two claims inside one
  // millisecond would share a stamp, and `late` would release `current`
  await new Promise((r) => setTimeout(r, 2));
  const current = await claim_stamp();
  await release_dist_notice(DIST_ID, late);
  expect((await notice_of()).claimed).not.toBeNull();
  expect(await claim_dist_notice(DIST_ID)).toEqual({ status: "busy" });
  await release_dist_notice(DIST_ID, current);
  expect((await notice_of()).claimed).toBeNull();
});

const finish_all_steps = async () => {
  await mark_dist_notice_sent(DIST_ID);
  await count_dist_metric(DIST_ID, async () => {});
  await mark_dist_hooks_sent(DIST_ID);
};

test("a finished notice is never claimed again, even by a release that comes late", async () => {
  const stamp = await claim_stamp();
  await finish_all_steps();
  await release_dist_notice(DIST_ID, stamp);
  expect((await notice_of()).claimed).not.toBeNull();
  expect(await claim_dist_notice(DIST_ID)).toEqual({ status: "done" });
});

test("a release after the mail but before the metric reopens the notice for the rest", async () => {
  const stamp = await claim_stamp();
  await mark_dist_notice_sent(DIST_ID);
  await release_dist_notice(DIST_ID, stamp);
  expect((await notice_of()).claimed).toBeNull();
  expect(await claim_dist_notice(DIST_ID)).toMatchObject({
    status: "claimed",
    mailed: true,
    counted: false,
    hooked: false,
  });
});

test("a claim whose holder died expires after the lease", async () => {
  await claim_stamp();
  await expire_claim();
  expect(await claim_dist_notice(DIST_ID)).toMatchObject({ status: "claimed" });
});

test("a dist refunded before its notice ran is not claimed", async () => {
  const { db } = test_db.current!;
  await db
    .update(dists)
    .set({ status: "refunded" })
    .where(eq(dists.id, DIST_ID));
  expect(await claim_dist_notice(DIST_ID)).toEqual({ status: "done" });
});

test("a fresh claim reports no step done, and all three stamps end the notice", async () => {
  expect(await claim_dist_notice(DIST_ID)).toMatchObject({
    status: "claimed",
    mailed: false,
    counted: false,
    hooked: false,
  });
  await finish_all_steps();
  expect(await claim_dist_notice(DIST_ID)).toEqual({ status: "done" });
});

const add_usa = (tx: Parameters<typeof country_update>[0]) =>
  country_update(tx, {
    country_key: "usa",
    country_name: "USA",
    inc_amount: 50,
    is_new_week: false,
  });

const usa_total = async () => {
  const [row] = await test_db
    .current!.db.select({ total: country_metrics.total_donations })
    .from(country_metrics)
    .where(eq(country_metrics.country_key, "usa"));
  return row?.total;
};

test("the metric counts once however many holders reach it", async () => {
  expect(await count_dist_metric(DIST_ID, add_usa)).toBe(true);
  expect(await count_dist_metric(DIST_ID, add_usa)).toBe(false);
  expect(await usa_total()).toBe(50);
});

test("a metric write that throws rolls back with its stamp and is retried whole", async () => {
  const boom = new Error("boom");
  await expect(
    count_dist_metric(DIST_ID, async (tx) => {
      await add_usa(tx);
      throw boom;
    })
  ).rejects.toBe(boom);
  expect(await usa_total()).toBeUndefined();
  const [row] = await test_db
    .current!.db.select({ counted: dists.metric_counted_at })
    .from(dists)
    .where(eq(dists.id, DIST_ID));
  expect(row?.counted).toBeNull();

  expect(await count_dist_metric(DIST_ID, add_usa)).toBe(true);
  expect(await usa_total()).toBe(50);
});
