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
import {
  donation_donors,
  donation_recipients,
  donations,
} from "../schema/donation";
import { subscriptions } from "../schema/subscription";
import { create_test_db } from "../test-utils/pglite";
import { npo_donations, referrer_donations } from "./dist";
import { user_donations_page } from "./donation";
import { donor_detail, subscription_dists } from "./subscription";

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
    "cancelled_refunded_loss",
  ] as const;
  await db.insert(donations).values(
    statuses.map((status) => ({
      id: `don-${status}`,
      upusd: 1,
      status: status === "cancelled_refunded_loss" ? "cancelled" : status,
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
    cancelled_refunded_loss: "refunded_loss",
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
    "d-cancelled_refunded_loss": ["refunded_loss", "cancelled"],
  });
});

test("a donor's detail carries each dist's donation status", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-DONOR" }))!;
  const statuses = ["settled", "cancelled"] as const;
  await db.insert(donations).values(
    statuses.map((status) => ({
      id: `dd-${status}`,
      upusd: 1,
      status,
      amount_base: 40,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
    }))
  );
  await db.insert(donation_donors).values(
    statuses.map((status) => ({
      donation_id: `dd-${status}`,
      email: "donor@example.com",
    }))
  );
  await db.insert(dists).values(
    statuses.map((status, i) => ({
      id: `dd-d-${status}`,
      donation_id: `dd-${status}`,
      to_id: npo.id,
      status:
        status === "settled" ? ("settled" as const) : ("refunded" as const),
      date_created: `2026-07-0${i + 1}T00:00:00.000Z`,
      amount_denom: "USD",
      net: 40,
    }))
  );

  const detail = await donor_detail(npo.id, "donor@example.com");
  const by_dist = Object.fromEntries(
    detail!.dists.map((x) => [x.id, [x.status, x.donation_status]])
  );
  expect(by_dist).toEqual({
    "dd-d-settled": ["settled", "settled"],
    "dd-d-cancelled": ["refunded", "cancelled"],
  });
});

test("the donor's own list carries the dists' status, so a cancelled duplicate reads apart from a gift cancelled before it settled", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-USER-A" }))!;
  const other = (await seed_npo(db, { registration_number: "EIN-USER-B" }))!;
  const email = "own-list@example.com";
  // never_settled: a cancelled grant or a campaign-closed open payment has no dist
  const dists_of = {
    never_settled: [],
    duplicate: [["refunded", npo.id]],
    cancelled_loss: [["refunded_loss", npo.id]],
    split_partly_refunded: [
      ["refunded", npo.id],
      ["settled", other.id],
    ],
    split_both_refunded: [
      ["refunded", npo.id],
      ["refunded", other.id],
    ],
    split_refunded_and_loss: [
      ["refunded", npo.id],
      ["refunded_loss", other.id],
    ],
  } as const;
  const ids = Object.keys(dists_of) as (keyof typeof dists_of)[];
  await db.insert(donations).values(
    ids.map((id, i) => ({
      id: `ud-${id}`,
      upusd: 1,
      status: "cancelled",
      created_at: `2026-08-0${i + 1}T00:00:00.000Z`,
      amount_base: 40,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
    }))
  );
  await db
    .insert(donation_donors)
    .values(ids.map((id) => ({ donation_id: `ud-${id}`, email })));
  await db.insert(donation_recipients).values(
    ids.map((id) => ({
      donation_id: `ud-${id}`,
      npo_id: npo.id,
      name: "npo",
      type: "npo",
    }))
  );
  await db.insert(dists).values(
    ids.flatMap((id) =>
      dists_of[id].map(([status, to_id]) => ({
        id: `ud-d-${id}-${to_id}`,
        donation_id: `ud-${id}`,
        to_id,
        status,
        date_created: "2026-08-01T00:00:00.000Z",
        amount_denom: "USD",
        net: 40,
      }))
    )
  );

  const { items } = await user_donations_page(email);
  const by_donation = Object.fromEntries(
    items.map((x) => [x.id, [x.status, x.dist_status]])
  );
  expect(by_donation).toEqual({
    "ud-never_settled": ["cancelled", null],
    "ud-duplicate": ["cancelled", "refunded"],
    "ud-cancelled_loss": ["cancelled", "refunded_loss"],
    "ud-split_partly_refunded": ["cancelled", null],
    "ud-split_both_refunded": ["cancelled", "refunded"],
    "ud-split_refunded_and_loss": ["cancelled", null],
  });
});

test("a subscription's dists carry each dist's donation status", async () => {
  const { db } = test_db.current!;
  const npo = (await seed_npo(db, { registration_number: "EIN-SUB" }))!;
  const now = "2026-07-01T00:00:00.000Z";
  await db.insert(subscriptions).values({
    id: "sub-1",
    interval: "month",
    interval_count: 1,
    next_billing: now,
    amount: 40,
    amount_usd: 40,
    currency: "USD",
    product_id: "prod-1",
    to_npo_id: npo.id,
    to_name: "npo",
    platform: "stripe",
    status: "active",
    from_id: "donor@example.com",
    created_at: now,
    updated_at: now,
  });
  const statuses = ["settled", "cancelled"] as const;
  await db.insert(donations).values(
    statuses.map((status) => ({
      id: `sd-${status}`,
      subscription_id: "sub-1",
      upusd: 1,
      status,
      amount_base: 40,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "month",
      source: "bg-marketplace",
      via: "stripe:card",
    }))
  );
  await db.insert(dists).values(
    statuses.map((status, i) => ({
      id: `sd-d-${status}`,
      donation_id: `sd-${status}`,
      to_id: npo.id,
      status:
        status === "settled" ? ("settled" as const) : ("refunded" as const),
      date_created: `2026-07-0${i + 1}T00:00:00.000Z`,
      amount_denom: "USD",
      net: 40,
    }))
  );

  const rows = await subscription_dists(npo.id, ["sub-1"]);
  const by_dist = Object.fromEntries(
    rows.map((x) => [x.id, [x.status, x.donation_status]])
  );
  expect(by_dist).toEqual({
    "sd-d-settled": ["settled", "settled"],
    "sd-d-cancelled": ["refunded", "cancelled"],
  });
});

test("a referrer's earnings carry the donation status, so a cancelled duplicate reads apart from a refund", async () => {
  const { db } = test_db.current!;
  await seed_npo(db, {
    registration_number: "EIN-REFERRER",
    referral_id: "REF-DUP",
  });
  const npo = (await seed_npo(db, {
    registration_number: "EIN-REFERRED",
    referrer_npo: "REF-DUP",
  }))!;
  const kinds = {
    duplicate: ["cancelled", "refunded"],
    refund: ["refunded", "refunded"],
    loss: ["refunded_loss", "refunded_loss"],
  } as const;
  const ids = Object.keys(kinds) as (keyof typeof kinds)[];
  await db.insert(donations).values(
    ids.map((id) => ({
      id: `rf-${id}`,
      upusd: 1,
      status: kinds[id][0],
      amount_base: 40,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
    }))
  );
  await db.insert(dists).values(
    ids.map((id) => ({
      id: `rf-d-${id}`,
      donation_id: `rf-${id}`,
      to_id: npo.id,
      status: kinds[id][1],
      date_created: "2026-08-01T00:00:00.000Z",
      amount_denom: "USD",
      net: 40,
    }))
  );

  const { items } = await referrer_donations("REF-DUP");
  const by_dist = Object.fromEntries(
    items.map((x) => [x.id, [x.status, x.donation_status]])
  );
  expect(by_dist).toEqual({
    "rf-d-duplicate": ["refunded", "cancelled"],
    "rf-d-refund": ["refunded", "refunded"],
    "rf-d-loss": ["refunded_loss", "refunded_loss"],
  });
});
