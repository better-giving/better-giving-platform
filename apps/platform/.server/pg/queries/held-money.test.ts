import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { dists } from "../schema/dist";
import { donations } from "../schema/donation";
import { npos } from "../schema/npo";
import { payouts, settlements } from "../schema/payout";
import { create_test_db, type TestDb } from "../test-utils/pglite";
import { held_money } from "./held-money";
import type { DbOrTx } from "./helpers";

let test_db: TestDb;
let npo_id: number;
const pg = () => test_db.db as unknown as DbOrTx;

beforeAll(async () => {
  test_db = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db?.client.close();
});

beforeEach(async () => {
  const db = test_db.db;
  await db.delete(payouts);
  await db.delete(settlements);
  await db.delete(dists);
  await db.delete(donations);
  await db.delete(npos);
  npo_id = await seed_npo("EIN-HELD");
});

async function seed_npo(registration_number: string) {
  const [npo] = await test_db.db
    .insert(npos)
    .values({
      registration_number,
      name: registration_number,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  return npo!.id;
}

type Status = "pending" | "processing" | "settled";
let counter = 0;

/** a payout for a settled gift paid `via`, dist and all */
async function seed_gift_payout(
  via: string,
  amount: number,
  date: string,
  o: { type?: Status; npo?: number } = {}
) {
  const id = `don-${++counter}`;
  const to_id = o.npo ?? npo_id;
  await test_db.db.insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: amount,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via,
  });
  await test_db.db.insert(dists).values({
    id: `dist-${id}`,
    donation_id: id,
    status: "settled",
    date_created: date,
    to_id,
    amount_denom: "USD",
    net: amount,
  });
  await seed_payout("donation", `dist-${id}`, amount, date, o.type, to_id);
}

async function seed_payout(
  source: "donation" | "liq" | "lock",
  source_id: string,
  amount: number,
  date: string,
  type: Status = "pending",
  to_id = npo_id
) {
  if (type === "settled") {
    await test_db.db.insert(settlements).values({
      id: `sttl-${source_id}`,
      npo_id: to_id,
      date,
      amount,
      status: "",
    });
  }
  await test_db.db.insert(payouts).values({
    id: `payout-${source_id}`,
    source_id,
    npo_id: to_id,
    source,
    date,
    amount,
    type,
    ...(type === "settled" && {
      settled_date: date,
      settled_id: `sttl-${source_id}`,
    }),
  });
}

describe("held_money", () => {
  test("each rail's pending payouts sum to their own row", async () => {
    await seed_gift_payout("paypal", 10.1, "2026-10-01T00:00:00.000Z");
    await seed_gift_payout("paypal", 20.2, "2026-10-02T00:00:00.000Z");
    await seed_gift_payout("chariot", 50, "2026-10-03T00:00:00.000Z");
    await seed_gift_payout("crypto:btc", 7.25, "2026-10-04T00:00:00.000Z");
    await seed_gift_payout("stocks", 300, "2026-10-05T00:00:00.000Z");
    await seed_gift_payout("cheque", 40, "2026-10-06T00:00:00.000Z");
    await seed_gift_payout("stripe:card", 12.5, "2026-10-07T00:00:00.000Z");

    const held = await held_money(pg(), npo_id);
    expect(held.by_rail).toEqual([
      { rail: "stripe", amount: 12.5 },
      { rail: "paypal", amount: 30.3 },
      { rail: "daf", amount: 50 },
      { rail: "crypto", amount: 7.25 },
      { rail: "stock_cheque", amount: 340 },
    ]);
    expect(held.total).toBe(440.05);
  });

  test("a payout claimed or paid is not held", async () => {
    const date = "2026-10-01T00:00:00.000Z";
    await seed_gift_payout("paypal", 10, date, { type: "processing" });
    await seed_gift_payout("paypal", 20, date, { type: "settled" });
    await seed_gift_payout("paypal", 5, date);

    const held = await held_money(pg(), npo_id);
    expect(held.total).toBe(5);
    expect(held.items).toEqual([{ rail: "paypal", date, amount: 5 }]);
  });

  test("another npo's pending payouts are not counted", async () => {
    const other = await seed_npo("EIN-OTHER");
    await seed_gift_payout("paypal", 99, "2026-10-01T00:00:00.000Z", {
      npo: other,
    });

    expect((await held_money(pg(), npo_id)).total).toBe(0);
  });

  test("items run newest first", async () => {
    await seed_gift_payout("paypal", 1, "2026-10-01T00:00:00.000Z");
    await seed_gift_payout("crypto:eth", 3, "2026-10-03T00:00:00.000Z");
    await seed_gift_payout("chariot", 2, "2026-10-02T00:00:00.000Z");

    const { items } = await held_money(pg(), npo_id);
    expect(items.map((i) => i.amount)).toEqual([3, 2, 1]);
  });

  test("savings and approved investments withdrawals count as withdrawals", async () => {
    await seed_payout("liq", "bal-tx-liq", 25, "2026-10-01T00:00:00.000Z");
    await seed_payout("lock", "bal-tx-lock", 75, "2026-10-02T00:00:00.000Z");

    const held = await held_money(pg(), npo_id);
    expect(held.by_rail).toEqual([{ rail: "withdrawal", amount: 100 }]);
    expect(held.items.map((i) => i.rail)).toEqual(["withdrawal", "withdrawal"]);
  });

  test("pooled stripe gifts are counted under stripe", async () => {
    await seed_gift_payout("stripe:card", 60, "2026-10-01T00:00:00.000Z");
    await seed_gift_payout(
      "stripe:us_bank_account",
      15,
      "2026-10-02T00:00:00.000Z"
    );

    const held = await held_money(pg(), npo_id);
    expect(held.by_rail).toEqual([{ rail: "stripe", amount: 75 }]);
    expect(held.items.map((i) => i.rail)).toEqual(["stripe", "stripe"]);
  });

  test("nothing pending holds nothing", async () => {
    expect(await held_money(pg(), npo_id)).toEqual({
      total: 0,
      by_rail: [],
      items: [],
    });
  });
});
