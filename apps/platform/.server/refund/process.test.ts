import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { dist_refund_update, dists_for_refund } from "../pg/queries/dist";
import type { DbOrTx } from "../pg/queries/helpers";
import { owed_for_donation } from "../pg/queries/owed";
import { bal_txs } from "../pg/schema/bal-tx";
import { dists } from "../pg/schema/dist";
import {
  donation_donors,
  donation_recipients,
  donations,
} from "../pg/schema/donation";
import { donation_match_events } from "../pg/schema/match";
import { npos } from "../pg/schema/npo";
import { owed_amounts } from "../pg/schema/owed";
import { payouts } from "../pg/schema/payout";
import { referrer_commissions } from "../pg/schema/referrer";
import { loss_logs } from "../pg/schema/revenue";
import type { TestDb } from "../pg/test-utils/pglite";

// --- mocks ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("../pg/db", () => ({
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

const fiat_alert = vi.hoisted(() => vi.fn());
vi.mock("../kit/slack", () => ({ fiat_monitor: { send_alert: fiat_alert } }));

const report_error = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error }));

// the heads-up's only side effect. mocked at the module rather than at the
// transport, so a test can make the send throw as well as refuse.
const send_email = vi.hoisted(() => vi.fn());
vi.mock("../email", () => ({ send_email }));

// pglite has one connection, so a writer that keeps winning the payout's
// compare-and-set is stood in for at the query: each miss reports the payout
// already moved while the row itself stays pending.
const cas = vi.hoisted(() => ({ misses: 0 }));
vi.mock("../pg/queries/payout", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../pg/queries/payout")>();
  return {
    ...orig,
    payout_move_from_unsent: (
      ...args: Parameters<typeof orig.payout_move_from_unsent>
    ) => {
      if (cas.misses === 0) return orig.payout_move_from_unsent(...args);
      cas.misses--;
      return Promise.resolve(false);
    },
  };
});

// pglite has one connection, so a writer that commits between two dists' runs
// is stood in for at the plan's npo read, which runs outside any transaction
const between_dists = vi.hoisted(() => ({
  once: null as (() => Promise<void>) | null,
}));
vi.mock("../pg/queries/npo", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../pg/queries/npo")>();
  return {
    ...orig,
    npo_get: async (...args: Parameters<typeof orig.npo_get>) => {
      const hook = between_dists.once;
      between_dists.once = null;
      await hook?.();
      return orig.npo_get(...args);
    },
  };
});

// --- imports (after mocks) ---

import { create_test_db } from "../pg/test-utils/pglite";
import { process_refund } from "./process";
import { reverse_unfunded_payout_loss } from "./unfunded";

// --- setup ---

const as_db = (x: unknown) => x as DbOrTx;
const ctx = {
  form_id: null,
  program_id: null,
  alert_from: "test",
  source: "refund",
  source_ref: "re_1",
} as const;
// read through the module's own query, gift by gift
const owed_rows = async () => {
  const db = test_db.current!.db as unknown as DbOrTx;
  const gifts = await test_db
    .current!.db.select({ id: donations.id })
    .from(donations);
  return (
    await Promise.all(gifts.map((g) => owed_for_donation(g.id, db)))
  ).flat();
};
let counter = 0;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  cas.misses = 0;
  between_dists.once = null;
  send_email.mockResolvedValue({ data: { id: "msg-1" }, error: null });
  await test_db.current!.db.delete(bal_txs);
  await test_db.current!.db.delete(loss_logs);
  await test_db.current!.db.delete(owed_amounts);
  await test_db.current!.db.delete(payouts);
  await test_db.current!.db.delete(dists);
  await test_db.current!.db.delete(donation_match_events);
  await test_db.current!.db.delete(donation_donors);
  await test_db.current!.db.delete(donation_recipients);
  await test_db.current!.db.delete(donations);
  await test_db.current!.db.delete(referrer_commissions);
  await test_db.current!.db.delete(npos);
  counter = 0;
});

/** a settled donation, optionally with a match event, and no dists */
async function seed(o?: {
  stamps?: Partial<{ pack_sent_at: string; submitted_at: string }>;
  event?: boolean;
}) {
  counter++;
  const db = test_db.current!.db;
  const [npo] = await db
    .insert(npos)
    .values({
      registration_number: `EIN-REF-${counter}`,
      name: `Test NPO ${counter}`,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();

  const id = `don-${counter}`;
  await db.insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: 250,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
    // paid on the recovery cutoff, so a refund may still take ungranted funds
    created_at: "2026-10-23T16:00:00.000Z",
  });
  await db.insert(donation_recipients).values({
    donation_id: id,
    npo_id: npo!.id,
    name: npo!.name,
    type: "npo",
  });
  await db.insert(donation_donors).values({
    donation_id: id,
    email: "donor@test.com",
    name: "Ada Lovelace",
    company_name: "Acme Inc",
  });

  if (o?.event !== false) {
    await db.insert(donation_match_events).values({
      id: `evt-${counter}`,
      donation_id: id,
      pack_sent_at: "2026-07-01T00:00:00.000Z",
      ...o?.stamps,
    });
  }
  return { id, npo_id: npo!.id, npo_name: npo!.name };
}

const events = () => test_db.current!.db.select().from(donation_match_events);
const dons = () => test_db.current!.db.select().from(donations);

describe("process_refund — concurrent runs", () => {
  test("two runs on the same stale graphs reverse the dist once", async () => {
    const { id, npo_id } = await seed({
      stamps: { submitted_at: "2026-07-02T00:00:00.000Z" },
    });
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ liq: 1000, lock_units: 0, cash: 0 })
      .where(eq(npos.id, npo_id));
    await db.insert(dists).values({
      id: `dist-${id}`,
      donation_id: id,
      status: "settled",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id: npo_id,
      to_name: "npo",
      amount: 100,
      amount_denom: "USD",
      net: 100,
      fee_base: 0,
      fee_fsa: 0,
      fee_processing: 0,
      alloc: { liq: 100, lock: 0, cash: 0 },
    });

    // a redelivery racing the original: both loaded before either committed
    const graphs = await dists_for_refund(id);
    await Promise.all([
      process_refund(id, graphs, ctx),
      process_refund(id, graphs, ctx),
    ]);

    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo!.liq).toBe(900);
    expect(await db.select().from(bal_txs)).toHaveLength(1);
    const [dist] = await db.select().from(dists);
    expect(dist!.status).toBe("refunded");
    expect(dist!.refund_status).toBe("completed");
    expect((await dons())[0]!.status).toBe("refunded");
    expect(send_email).toHaveBeenCalledTimes(1);
  });

  test("a failure write does not land on a dist another run reversed", async () => {
    const { id, npo_id } = await seed({ event: false });
    const db = test_db.current!.db;
    await db.insert(dists).values({
      id: `dist-${id}`,
      donation_id: id,
      status: "refunded",
      refund_status: "completed",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id: npo_id,
      amount_denom: "USD",
    });

    await dist_refund_update(as_db(db), `dist-${id}`, {
      refund_status: "failed",
      refund_error: "boom",
    });

    const [dist] = await db.select().from(dists);
    expect(dist!.refund_status).toBe("completed");
    expect(dist!.refund_error).toBeNull();
  });
});

describe("process_refund — a dist written mid-refund", () => {
  async function seed_dist(
    donation_id: string,
    to_id: number | null,
    amount = 100
  ) {
    await test_db.current!.db.insert(dists).values({
      id: `dist-${donation_id}-${to_id}`,
      donation_id,
      status: "settled",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id,
      to_name: "npo",
      amount,
      amount_denom: "USD",
      net: amount,
      fee_base: 0,
      fee_fsa: 0,
      fee_processing: 0,
      alloc: { liq: 100, lock: 0, cash: 0 },
    });
  }

  test("a dist committed after the snapshot is reversed before the flip", async () => {
    const { id, npo_id } = await seed({ event: false });
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ liq: 1000, lock_units: 0, cash: 0 })
      .where(eq(npos.id, npo_id));
    // the caller's snapshot saw no dists; a stale settle_npo commits one after
    const graphs = await dists_for_refund(id);
    await seed_dist(id, npo_id);

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toEqual([]);
    expect(res.applied).toBe(1);
    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo!.liq).toBe(900);
    const [dist] = await db.select().from(dists);
    expect(dist!.status).toBe("refunded");
    expect(dist!.refund_status).toBe("completed");
    expect((await dons())[0]!.status).toBe("refunded");
  });

  test("a straggler that fails to reverse leaves the donation settled", async () => {
    const { id } = await seed({ event: false });
    const graphs = await dists_for_refund(id);
    // no npo to reverse against: the plan load throws
    await seed_dist(id, null);

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toHaveLength(1);
    expect(report_error).toHaveBeenCalled();
    const [dist] = await test_db.current!.db.select().from(dists);
    expect(dist!.status).toBe("settled");
    expect(dist!.refund_status).toBe("failed");
    expect((await dons())[0]!.status).toBe("settled");
  });
});

describe("process_refund — a payout the grants cron settles mid-refund", () => {
  async function seed_cash_dist(
    donation_id: string,
    npo_id: number,
    gift: { amount: number; amount_usd: number | null; denom: string } = {
      amount: 100,
      amount_usd: 100,
      denom: "USD",
    }
  ) {
    const db = test_db.current!.db;
    await db.update(npos).set({ cash: 100 }).where(eq(npos.id, npo_id));
    await db.insert(dists).values({
      id: `dist-${donation_id}`,
      donation_id,
      status: "settled",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id: npo_id,
      to_name: "npo",
      amount: gift.amount,
      amount_usd: gift.amount_usd,
      amount_denom: gift.denom,
      net: 100,
      fee_base: 0,
      fee_fsa: 0,
      fee_processing: 0,
      alloc: { liq: 0, lock: 0, cash: 100 },
    });
    await db.insert(payouts).values({
      id: `payout-${donation_id}`,
      source_id: `dist-${donation_id}`,
      npo_id,
      source: "donation",
      date: "2026-07-01T00:00:00.000Z",
      amount: 100,
      type: "pending",
    });
  }

  test("a payout settled after the graph was read ends owed by the npo", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_cash_dist(id, npo_id);
    const db = test_db.current!.db;
    const graphs = await dists_for_refund(id);
    // the cron commits its settle after the caller's snapshot, before the CAS
    await db
      .update(payouts)
      .set({ type: "settled", settled_date: "2026-07-02T00:00:00.000Z" })
      .where(eq(payouts.id, `payout-${id}`));

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toEqual([]);
    const [dist] = await db.select().from(dists);
    expect(dist!.status).toBe("refunded");
    expect(dist!.refund_status).toBe("loss");
    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        donation_id: id,
        npo_id,
        source: "refund",
        source_ref: "re_1",
        received_usd: 100,
        outstanding_usd: 100,
      }),
    ]);
    expect(await db.select().from(loss_logs)).toEqual([]);
    // the settled payout's cash already left; nothing to take back
    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo!.cash).toBe(100);
    const [po] = await db.select().from(payouts);
    expect(po!.type).toBe("refunded_loss");
    expect((await dons())[0]!.status).toBe("refunded_loss");
  });

  test("running the same refund twice leaves one owed row with the same figure", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_cash_dist(id, npo_id);
    const db = test_db.current!.db;
    await db
      .update(payouts)
      .set({ type: "settled", settled_date: "2026-07-02T00:00:00.000Z" })
      .where(eq(payouts.id, `payout-${id}`));
    const graphs = await dists_for_refund(id);

    await process_refund(id, graphs, ctx);
    await process_refund(id, graphs, ctx);

    expect(await owed_rows()).toEqual([
      expect.objectContaining({ npo_id, outstanding_usd: 100 }),
    ]);
  });

  test("a payout the cron claimed for a transfer in flight ends owed by the npo", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_cash_dist(id, npo_id);
    const db = test_db.current!.db;
    const graphs = await dists_for_refund(id);
    // the cron commits its claim after the caller's snapshot, before the CAS
    await db
      .update(payouts)
      .set({ type: "processing" })
      .where(eq(payouts.id, `payout-${id}`));

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toEqual([]);
    const [dist] = await db.select().from(dists);
    expect(dist!.refund_status).toBe("loss");
    expect(await owed_rows()).toEqual([
      expect.objectContaining({ npo_id, received_usd: 100 }),
    ]);
    // the cash is on its way to the npo; the settle takes it off the balance
    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo!.cash).toBe(100);
    const [po] = await db.select().from(payouts);
    expect(po!.type).toBe("refunded_loss");
  });

  test("a savings shortfall whose pending payout the cron claims mid-refund re-plans to owing it all", async () => {
    const { id, npo_id } = await seed({ event: false });
    const db = test_db.current!.db;
    await db.update(npos).set({ liq: 10, cash: 40 }).where(eq(npos.id, npo_id));
    await db.insert(dists).values({
      id: `dist-${id}`,
      donation_id: id,
      status: "settled",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id: npo_id,
      to_name: "npo",
      amount: 100,
      amount_usd: 100,
      amount_denom: "USD",
      net: 100,
      fee_base: 0,
      fee_fsa: 0,
      fee_processing: 0,
      alloc: { liq: 60, lock: 0, cash: 40 },
    });
    await db.insert(payouts).values({
      id: `payout-${id}`,
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: "2026-07-01T00:00:00.000Z",
      amount: 40,
      type: "pending",
    });
    // planned against a pending payout: cancel it and take back its cash
    const graphs = await dists_for_refund(id);
    await db
      .update(payouts)
      .set({ type: "processing" })
      .where(eq(payouts.id, `payout-${id}`));

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toEqual([]);
    const [po] = await db.select().from(payouts);
    expect(po!.type).toBe("refunded_loss");
    // the cash is in the transfer, so none of it comes back
    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo).toMatchObject({ liq: 10, cash: 40 });
    const [owed] = await owed_rows();
    expect(owed).toMatchObject({ received_usd: 100, outstanding_usd: 100 });
  });

  /** the npo's cash, its payout's type, the dist, the donation and the owed
   * rows: everything the refund of the gift can move */
  const books = async () => {
    const db = test_db.current!.db;
    const [npo] = await db.select({ cash: npos.cash }).from(npos);
    const [po] = await db.select({ type: payouts.type }).from(payouts);
    const [dist] = await db
      .select({ refund_status: dists.refund_status })
      .from(dists);
    return {
      cash: npo!.cash,
      payout: po!.type,
      dist: dist!.refund_status,
      donation: (await dons())[0]!.status,
      owed: (await owed_rows()).map((o) => o.outstanding_usd),
    };
  };

  test("a payout whose transfer comes back after the graph was read is cancelled and its cash taken back", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_cash_dist(id, npo_id);
    const db = test_db.current!.db;
    // settled: the run's claim took the cash off the balance
    await db
      .update(payouts)
      .set({ type: "settled", settled_date: "2026-07-02T00:00:00.000Z" })
      .where(eq(payouts.id, `payout-${id}`));
    await db.update(npos).set({ cash: 0 }).where(eq(npos.id, npo_id));
    const graphs = await dists_for_refund(id);
    // the return commits after the snapshot: payout back, cash credited
    await db
      .update(payouts)
      .set({ type: "returned" })
      .where(eq(payouts.id, `payout-${id}`));
    await db.update(npos).set({ cash: 100 }).where(eq(npos.id, npo_id));

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toEqual([]);
    expect(await books()).toEqual({
      cash: 0,
      payout: "refunded",
      dist: "completed",
      donation: "refunded",
      owed: [],
    });
  });

  test("a returned payout re-sent after the graph was read is still cancelled", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_cash_dist(id, npo_id);
    const db = test_db.current!.db;
    await db
      .update(payouts)
      .set({ type: "returned" })
      .where(eq(payouts.id, `payout-${id}`));
    const graphs = await dists_for_refund(id);
    // `resend_returned` commits after the snapshot
    await db
      .update(payouts)
      .set({ type: "pending" })
      .where(eq(payouts.id, `payout-${id}`));

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toEqual([]);
    expect(await books()).toEqual({
      cash: 0,
      payout: "refunded",
      dist: "completed",
      donation: "refunded",
      owed: [],
    });
  });

  test("a returned payout re-sent and claimed after the graph was read ends owed by the npo", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_cash_dist(id, npo_id);
    const db = test_db.current!.db;
    await db
      .update(payouts)
      .set({ type: "returned" })
      .where(eq(payouts.id, `payout-${id}`));
    const graphs = await dists_for_refund(id);
    await db
      .update(payouts)
      .set({ type: "processing" })
      .where(eq(payouts.id, `payout-${id}`));

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toEqual([]);
    // the cash is in the transfer; the settle takes it off the balance
    expect(await books()).toEqual({
      cash: 100,
      payout: "refunded_loss",
      dist: "loss",
      donation: "refunded_loss",
      owed: [100],
    });
  });

  test("a payout that is stale on the re-plan too leaves the dist failed", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_cash_dist(id, npo_id);
    const db = test_db.current!.db;
    const graphs = await dists_for_refund(id);
    cas.misses = 2;

    const res = await process_refund(id, graphs, ctx);

    // both attempts ran: the plan and the one re-plan
    expect(cas.misses).toBe(0);
    expect(res.failures).toEqual([
      `dist dist-${id}: payout:payout-${id} is no longer pending or returned`,
    ]);
    const [dist] = await db.select().from(dists);
    expect(dist!.status).toBe("settled");
    expect(dist!.refund_status).toBe("failed");
    expect(await owed_rows()).toHaveLength(0);
    const [po] = await db.select().from(payouts);
    expect(po!.type).toBe("pending");
    expect((await dons())[0]!.status).toBe("settled");
  });
});

describe("process_refund — a loss reversed before the flip", () => {
  async function seed_cash_dist(
    donation_id: string,
    npo_id: number,
    n: number,
    payout_type: "pending" | "processing"
  ) {
    const db = test_db.current!.db;
    await db.insert(dists).values({
      id: `dist-${n}`,
      donation_id,
      status: "settled",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id: npo_id,
      to_name: "npo",
      amount: 100,
      amount_denom: "USD",
      net: 100,
      fee_base: 0,
      fee_fsa: 0,
      fee_processing: 0,
      alloc: { liq: 0, lock: 0, cash: 100 },
    });
    await db.insert(payouts).values({
      id: `payout-${n}`,
      source_id: `dist-${n}`,
      npo_id,
      source: "donation",
      date: "2026-07-01T00:00:00.000Z",
      amount: 100,
      type: payout_type,
    });
  }

  test("a loss the grants cron reverses while a sibling dist is still refunding ends the donation refunded", async () => {
    const { id, npo_id } = await seed();
    const db = test_db.current!.db;
    await db.update(npos).set({ cash: 100 }).where(eq(npos.id, npo_id));
    const [other] = await db
      .insert(npos)
      .values({
        registration_number: "EIN-REF-OTHER",
        name: "Other NPO",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
        cash: 100,
      })
      .returning();
    // dist-1's payout is in flight, so its refund is a loss
    await seed_cash_dist(id, npo_id, 1, "processing");
    await seed_cash_dist(id, other!.id, 2, "pending");
    const graphs = (await dists_for_refund(id)).sort((a, b) =>
      a.dist.id.localeCompare(b.dist.id)
    );
    // its transfer goes unfunded once dist-1 is refunded, before dist-2 is
    let reversed: unknown;
    between_dists.once = async () => {
      between_dists.once = async () => {
        reversed = await db.transaction((tx) =>
          reverse_unfunded_payout_loss(as_db(tx), "payout-1")
        );
      };
    };

    const res = await process_refund(id, graphs, ctx);

    expect(reversed).toEqual({ status: "reversed" });
    expect(res.failures).toEqual([]);
    const refund_status = await db
      .select({ id: dists.id, refund_status: dists.refund_status })
      .from(dists)
      .orderBy(dists.id);
    expect(refund_status).toEqual([
      { id: "dist-1", refund_status: "completed" },
      { id: "dist-2", refund_status: "completed" },
    ]);
    expect((await dons())[0]!.status).toBe("refunded");
    expect((await events())[0]!.void_reason).toBe("refunded");
  });
});

describe("process_refund — a commission the commissions cron claims mid-refund", () => {
  async function seed_referred_dist(donation_id: string, npo_id: number) {
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ liq: 100, referral_id: "NPO-REF" })
      .where(eq(npos.id, npo_id));
    await db.insert(dists).values({
      id: `dist-${donation_id}`,
      donation_id,
      status: "settled",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id: npo_id,
      to_name: "npo",
      amount: 100,
      amount_denom: "USD",
      net: 100,
      fee_base: 0,
      fee_fsa: 0,
      fee_processing: 0,
      alloc: { liq: 100, lock: 0, cash: 0 },
    });
    await db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-07-01T00:00:00.000Z",
      donation_id: `dist-${donation_id}`,
      npo_id,
      amount: 5,
      status: "pending",
    });
  }

  test("a commission claimed for a Wise transfer goes refunded_loss and is owed by its referrer, alerted with the transfer's ref", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_referred_dist(id, npo_id);
    const db = test_db.current!.db;
    const graphs = await dists_for_refund(id);
    // the cron commits its claim after the caller's snapshot
    await db
      .update(referrer_commissions)
      .set({ status: "processing", ref: "ref-1" })
      .where(eq(referrer_commissions.donation_id, `dist-${id}`));

    const res = await process_refund(id, graphs, ctx);

    expect(res.failures).toEqual([]);
    const [comm] = await db.select().from(referrer_commissions);
    expect(comm!.status).toBe("refunded_loss");
    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        donation_id: id,
        npo_id: null,
        referrer_npo: "NPO-REF",
        received_usd: 5,
        outstanding_usd: 5,
      }),
    ]);
    // the npo's side reverses in full
    const [dist] = await db.select().from(dists);
    expect(dist!.refund_status).toBe("completed");
    expect((await dons())[0]!.status).toBe("refunded");
    expect(res.owed_msgs).toEqual([
      `$5.00 commission dist-${id} recorded as owed by referrer NPO-REF, to recover from its next commission; the gift's row for that referrer totals $5.00. claimed by the Wise transfer with customerTransactionId ref-1, so owed only if that transfer pays: if it goes unfunded, the commission run credits it back when it catches that, otherwise credit it on Amounts owed (/platform/owed)`,
    ]);
  });

  test("a redelivered refund leaves one referrer row with the same amount", async () => {
    const { id, npo_id } = await seed({ event: false });
    await seed_referred_dist(id, npo_id);
    const db = test_db.current!.db;
    await db
      .update(referrer_commissions)
      .set({ status: "paid", ref: "ref-1" })
      .where(eq(referrer_commissions.donation_id, `dist-${id}`));
    const graphs = await dists_for_refund(id);

    await process_refund(id, graphs, ctx);
    await process_refund(id, graphs, { ...ctx, source_ref: "re_2" });

    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        referrer_npo: "NPO-REF",
        source_ref: "re_1",
        received_usd: 5,
        outstanding_usd: 5,
      }),
    ]);
  });
});
