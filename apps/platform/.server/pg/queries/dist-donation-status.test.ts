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
import { dists } from "../schema/dist";
import { donations } from "../schema/donation";
import { create_test_db } from "../test-utils/pglite";
import { npo_donations } from "./dist";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

test("the npo's donations carry each donation's status, so a cancelled duplicate reads apart from a refund", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-CANCEL" }))!;
  const statuses = [
    "settled",
    "refunded",
    "refunded_loss",
    "cancelled",
    "cancelled_loss",
  ] as const;
  await db.insert(donations).values(
    statuses.map((status) => ({
      id: `don-${status}`,
      upusd: 1,
      status: status === "cancelled_loss" ? "cancelled" : status,
      amount_base: 40,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
    }))
  );
  // a reversed duplicate's dist is `refunded`; a cancelled donation whose
  // dist is `refunded_loss` did refund
  const dist_status = {
    settled: "settled",
    refunded: "refunded",
    refunded_loss: "refunded_loss",
    cancelled: "refunded",
    cancelled_loss: "refunded_loss",
  } as const;
  await db.insert(dists).values(
    statuses.map((status, i) => ({
      id: `d-${status}`,
      donation_id: `don-${status}`,
      to_id: npo.id,
      status: dist_status[status],
      date_created: `2026-07-0${i + 1}T00:00:00.000Z`,
      amount_denom: "USD",
      net: 40,
    }))
  );

  const { items } = await npo_donations(npo.id);
  const by_dist = Object.fromEntries(
    items.map((x) => [x.id, [x.status, x.donation_status]])
  );
  expect(by_dist).toEqual({
    "d-settled": ["settled", "settled"],
    "d-refunded": ["refunded", "refunded"],
    "d-refunded_loss": ["refunded_loss", "refunded_loss"],
    "d-cancelled": ["refunded", "cancelled"],
    "d-cancelled_loss": ["refunded_loss", "cancelled"],
  });
});
