import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { DbOrTx } from "../pg/queries/helpers";
import { owed_for_donation } from "../pg/queries/owed";
import { donations } from "../pg/schema/donation";
import { npos } from "../pg/schema/npo";
import { owed_amounts } from "../pg/schema/owed";
import { payouts, settlements } from "../pg/schema/payout";
import { referrer_commissions } from "../pg/schema/referrer";
import { loss_logs } from "../pg/schema/revenue";
import { create_test_db, type TestDb } from "../pg/test-utils/pglite";
import { apply_refund_plan, StalePayoutError } from "./apply";
import { calc_refund_plan } from "./plan";

// pglite's drizzle handle differs from neon's only in the result-type HKT,
// which these queries do not read.
const as_db = (x: unknown) => x as DbOrTx;

const PAYOUT_ID = "payout-1";
const SRC = { source: "refund", source_ref: "re_1" } as const;

let test_db: TestDb;

beforeAll(async () => {
  test_db = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db?.client.close();
});

beforeEach(async () => {
  const db = test_db.db;
  await db.delete(owed_amounts);
  await db.delete(donations);
  await db.delete(loss_logs);
  await db.delete(payouts);
  await db.delete(settlements);
  await db.delete(referrer_commissions);
  await db.delete(npos);
});

async function seed_payout(type: "pending" | "settled") {
  const db = test_db.db;
  const [npo] = await db
    .insert(npos)
    .values({
      registration_number: "EIN-APPLY",
      name: "Apply Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash: 100,
    })
    .returning();
  if (type === "settled") {
    await db.insert(settlements).values({
      id: "sttl-1",
      npo_id: npo!.id,
      date: "2026-09-02T00:00:00.000Z",
      amount: 100,
      status: "",
    });
  }
  await db.insert(payouts).values({
    id: PAYOUT_ID,
    source_id: "dist-1",
    npo_id: npo!.id,
    source: "donation",
    date: "2026-09-01T00:00:00.000Z",
    amount: 100,
    type,
    ...(type === "settled" && {
      settled_date: "2026-09-02T00:00:00.000Z",
      settled_id: "sttl-1",
    }),
  });
  return npo!.id;
}

// every plan is drawn by the planner, so the effects and their order are the
// ones a refund runs
function plan_for(
  npo_id: number,
  o: {
    payout?: "pending" | "settled" | null;
    commission?: {
      status: "pending" | "processing" | "paid" | "returned";
    } | null;
    alloc?: { liq: number; lock: number; cash: number };
    amount?: number;
    fees?: { base: number; fsa: number; processing: number };
    bal?: { liq: number; lock_units: number; cash: number };
  } = {}
) {
  const alloc = o.alloc ?? { liq: 0, lock: 0, cash: 100 };
  const fees = o.fees ?? { base: 0, fsa: 0, processing: 0 };
  const amount = o.amount ?? 100;
  return calc_refund_plan(
    {
      dist: {
        id: "dist-1",
        donation_id: "don-1",
        to_id: npo_id,
        to_name: "Apply Test NPO",
        alloc,
        net: 100,
        amount,
        amount_usd: amount,
        fee_base: fees.base,
        fee_fsa: fees.fsa,
        fee_processing: fees.processing,
      },
      payout:
        o.payout === null
          ? null
          : { id: PAYOUT_ID, type: o.payout ?? "pending" },
      commission: o.commission
        ? {
            donation_id: "dist-1",
            amount: 5,
            status: o.commission.status,
            referrer: { referrer_npo: "NPO-REF" },
          }
        : null,
      rev_log_ids: [],
      bal: o.bal ?? { liq: 0, lock_units: 0, cash: 100 },
      nav: null,
      sub_id: null,
    },
    {
      now: "2026-09-03T00:00:00.000Z",
      nav_date: "2026-09-03T00:00:00.001Z",
      form_id: null,
      program_id: null,
    }
  );
}

async function npo_cash(npo_id: number) {
  const [row] = await test_db.db
    .select({ cash: npos.cash })
    .from(npos)
    .where(eq(npos.id, npo_id));
  return row?.cash;
}

async function payout_type() {
  const [row] = await test_db.db
    .select({ type: payouts.type })
    .from(payouts)
    .where(eq(payouts.id, PAYOUT_ID));
  return row?.type;
}

describe("apply_refund_plan payout_status", () => {
  test("throws when the payout it planned to cancel was settled meanwhile", async () => {
    const npo_id = await seed_payout("settled");

    await expect(
      apply_refund_plan(
        as_db(test_db.db),
        plan_for(npo_id, { payout: "pending" }),
        SRC
      )
    ).rejects.toThrow(StalePayoutError);
    expect(await payout_type()).toBe("settled");
  });

  test("a pending payout is marked refunded", async () => {
    const npo_id = await seed_payout("pending");

    await apply_refund_plan(
      as_db(test_db.db),
      plan_for(npo_id, { payout: "pending" }),
      SRC
    );

    expect(await payout_type()).toBe("refunded");
  });

  // the loss plan is what a re-run produces once the cron has settled the payout
  test("a loss refund marks an already-settled payout refunded_loss", async () => {
    const npo_id = await seed_payout("settled");
    await seed_donation();

    await apply_refund_plan(
      as_db(test_db.db),
      plan_for(npo_id, { payout: "settled" }),
      SRC
    );

    expect(await payout_type()).toBe("refunded_loss");
  });
});

// the grants cron holds the payout rows and then updates the npos row; a refund
// taking them in the other order deadlocks it after wise has paid
describe("apply_refund_plan lock order", () => {
  test("a stale payout throws before the npo balance is written", async () => {
    const npo_id = await seed_payout("settled");

    await expect(
      apply_refund_plan(
        as_db(test_db.db),
        plan_for(npo_id, { payout: "pending" }),
        SRC
      )
    ).rejects.toThrow(StalePayoutError);
    expect(await npo_cash(npo_id)).toBe(100);
  });

  test("a pending payout's cash comes off the npo balance", async () => {
    const npo_id = await seed_payout("pending");

    await apply_refund_plan(
      as_db(test_db.db),
      plan_for(npo_id, { payout: "pending" }),
      SRC
    );

    expect(await npo_cash(npo_id)).toBe(0);
    expect(await payout_type()).toBe("refunded");
  });
});

describe("apply_refund_plan commission_status", () => {
  async function seed_commission(
    status: "pending" | "processing" | "paid" | "returned"
  ) {
    const [npo] = await test_db.db
      .insert(npos)
      .values({
        registration_number: "EIN-COMM",
        name: "Commission NPO",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
        referral_id: "NPO-REF",
        cash: 100,
      })
      .returning();
    await seed_donation();
    await test_db.db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-09-01T00:00:00.000Z",
      donation_id: "dist-1",
      npo_id: npo!.id,
      amount: 5,
      status,
      ref: status === "pending" ? null : "ref-1",
    });
    return npo!.id;
  }

  const plan_reversing_commission = (npo_id: number) =>
    plan_for(npo_id, {
      payout: null,
      commission: { status: "paid" },
    });

  const referrer_row = expect.objectContaining({
    donation_id: "don-1",
    npo_id: null,
    referrer_npo: "NPO-REF",
    source: "refund",
    source_ref: "re_1",
    received_usd: 5,
    outstanding_usd: 5,
  });

  async function commission_status() {
    const [row] = await test_db.db
      .select({ status: referrer_commissions.status })
      .from(referrer_commissions)
      .where(eq(referrer_commissions.donation_id, "dist-1"));
    return row?.status;
  }

  test("a pending commission is marked refunded, owed by nobody", async () => {
    const npo_id = await seed_commission("pending");

    const res = await apply_refund_plan(
      as_db(test_db.db),
      plan_reversing_commission(npo_id),
      SRC
    );

    expect(await commission_status()).toBe("refunded");
    expect(res.commission_in_flight).toBeUndefined();
    expect(res.owed).toEqual([]);
    expect(await owed_for_donation("don-1", as_db(test_db.db))).toEqual([]);
  });

  // its wise transfer may already be paying the referrer
  test("a processing commission is marked refunded_loss, reported, and owed by its referrer", async () => {
    const npo_id = await seed_commission("processing");

    const res = await apply_refund_plan(
      as_db(test_db.db),
      plan_reversing_commission(npo_id),
      SRC
    );

    expect(await commission_status()).toBe("refunded_loss");
    expect(res.commission_in_flight).toEqual({
      donation_id: "dist-1",
      amount: 5,
      ref: "ref-1",
    });
    expect(res.owed).toEqual([referrer_row]);
  });

  // paid after the plan was drawn: the referrer has the money, so it stays paid
  test("a paid commission is left paid and owed by its referrer", async () => {
    const npo_id = await seed_commission("paid");

    const res = await apply_refund_plan(
      as_db(test_db.db),
      plan_reversing_commission(npo_id),
      SRC
    );

    expect(await commission_status()).toBe("paid");
    expect(res.owed).toEqual([referrer_row]);
    expect(await owed_for_donation("don-1", as_db(test_db.db))).toEqual([
      referrer_row,
    ]);
  });

  // its transfer came back, so the referrer never had the money; a ref left on
  // it would read as a transfer that paid it
  test("a returned commission is marked refunded, its ref cleared, owed by nobody", async () => {
    const npo_id = await seed_commission("returned");

    const res = await apply_refund_plan(
      as_db(test_db.db),
      plan_for(npo_id, { payout: null, commission: { status: "returned" } }),
      SRC
    );

    const [row] = await test_db.db
      .select({
        status: referrer_commissions.status,
        ref: referrer_commissions.ref,
      })
      .from(referrer_commissions);
    expect(row).toEqual({ status: "refunded", ref: null });
    expect(res.commission_in_flight).toBeUndefined();
    expect(res.owed).toEqual([]);
    expect(await owed_for_donation("don-1", as_db(test_db.db))).toEqual([]);
  });
});

async function seed_donation() {
  await test_db.db.insert(donations).values({
    id: "don-1",
    upusd: 1,
    status: "settled",
    amount_base: 100,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
}

describe("apply_refund_plan owed", () => {
  // the referrer's paid commission is its own row, never the npo's
  test("records what the npo owes and what the referrer owes, one row each, no loss", async () => {
    const npo_id = await seed_payout("settled");
    await seed_donation();
    await test_db.db
      .update(npos)
      .set({ referral_id: "NPO-REF" })
      .where(eq(npos.id, npo_id));
    await test_db.db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-09-01T00:00:00.000Z",
      donation_id: "dist-1",
      npo_id,
      amount: 5,
      status: "paid",
      ref: "ref-1",
    });
    const plan = plan_for(npo_id, {
      payout: "settled",
      commission: { status: "paid" },
    });

    const res = await apply_refund_plan(as_db(test_db.db), plan, SRC);

    const owed = await owed_for_donation("don-1", as_db(test_db.db));
    const npo_row = expect.objectContaining({
      npo_id,
      source: "refund",
      source_ref: "re_1",
      recorded_at: "2026-09-03T00:00:00.000Z",
      received_usd: 100,
      fee_processing_usd: 0,
      outstanding_usd: 100,
    });
    const referrer_row = expect.objectContaining({
      npo_id: null,
      referrer_npo: "NPO-REF",
      source: "refund",
      source_ref: "re_1",
      recorded_at: "2026-09-03T00:00:00.000Z",
      received_usd: 5,
      outstanding_usd: 5,
    });
    expect(owed).toHaveLength(2);
    expect(owed).toEqual(expect.arrayContaining([npo_row, referrer_row]));
    expect(res.owed).toEqual([referrer_row, npo_row]);
    expect(await test_db.db.select().from(loss_logs)).toEqual([]);
  });
});

// a savings shortfall is owed; the cash share still sits in a pending payout
describe("apply_refund_plan savings shortfall beside a cash payout", () => {
  const plan_liq_short = (npo_id: number, payout: "pending" | "settled") =>
    plan_for(npo_id, {
      payout,
      alloc: { liq: 50, lock: 0, cash: 50 },
      amount: 110,
      fees: { base: 5, fsa: 3, processing: 2 },
      bal: { liq: 10, lock_units: 0, cash: 100 },
    });

  test("a pending payout is cancelled, its cash comes off the npo, and the unreversed share is owed", async () => {
    const npo_id = await seed_payout("pending");
    await seed_donation();

    await apply_refund_plan(
      as_db(test_db.db),
      plan_liq_short(npo_id, "pending"),
      SRC
    );

    expect(await payout_type()).toBe("refunded");
    expect(await npo_cash(npo_id)).toBe(50);
    const owed = await owed_for_donation("don-1", as_db(test_db.db));
    expect(owed).toEqual([
      expect.objectContaining({
        npo_id,
        received_usd: 50,
        fee_processing_usd: 2,
        outstanding_usd: 52,
      }),
    ]);
    expect(await test_db.db.select().from(loss_logs)).toEqual([]);
  });

  test("a payout already sent is marked refunded_loss, its cash stays, and the whole share is owed", async () => {
    const npo_id = await seed_payout("settled");
    await seed_donation();

    await apply_refund_plan(
      as_db(test_db.db),
      plan_liq_short(npo_id, "settled"),
      SRC
    );

    expect(await payout_type()).toBe("refunded_loss");
    expect(await npo_cash(npo_id)).toBe(100);
    const [owed] = await owed_for_donation("don-1", as_db(test_db.db));
    expect(owed).toMatchObject({ received_usd: 100, outstanding_usd: 102 });
  });

  test("a returned commission on a loss is refunded_loss with no ref, and only the npo owes", async () => {
    const npo_id = await seed_payout("settled");
    await seed_donation();
    await test_db.db
      .update(npos)
      .set({ referral_id: "NPO-REF" })
      .where(eq(npos.id, npo_id));
    await test_db.db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-09-01T00:00:00.000Z",
      donation_id: "dist-1",
      npo_id,
      amount: 5,
      status: "returned",
      ref: "ref-1",
    });
    const plan = plan_for(npo_id, {
      payout: "settled",
      alloc: { liq: 50, lock: 0, cash: 50 },
      amount: 110,
      fees: { base: 5, fsa: 3, processing: 2 },
      bal: { liq: 10, lock_units: 0, cash: 100 },
      commission: { status: "returned" },
    });

    await apply_refund_plan(as_db(test_db.db), plan, SRC);

    const [row] = await test_db.db
      .select({
        status: referrer_commissions.status,
        ref: referrer_commissions.ref,
      })
      .from(referrer_commissions);
    expect(row).toEqual({ status: "refunded_loss", ref: null });
    const owed = await owed_for_donation("don-1", as_db(test_db.db));
    expect(owed).toEqual([expect.objectContaining({ npo_id })]);
  });
});
