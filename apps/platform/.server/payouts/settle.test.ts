import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { TestDb } from "../pg/test-utils/pglite";
import type { Pay } from "./settle";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const report_error = vi.hoisted(() => vi.fn());
const send_alert = vi.hoisted(() => vi.fn());

/** makes the next `payouts_move` out of this status throw, as a dropped socket would */
const fail_move = vi.hoisted(() => ({ from: null as string | null }));
const deductions = vi.hoisted(() => ({ on: false }));
/** npo row and owed-row locks, in the order they are taken: pglite runs one
 * connection, so two transactions can't race here, only show their lock order */
const locks = vi.hoisted(() => [] as ("npo" | "owed")[]);

vi.mock("#/errors/report", () => ({ report_error }));
vi.mock("../pg/queries/npo", async (io) => {
  const actual = await io<typeof import("../pg/queries/npo")>();
  return {
    ...actual,
    npo_get_locked: (...args: Parameters<typeof actual.npo_get_locked>) => {
      locks.push("npo");
      return actual.npo_get_locked(...args);
    },
  };
});
vi.mock("../pg/queries/owed", async (io) => {
  const actual = await io<typeof import("../pg/queries/owed")>();
  return {
    ...actual,
    unrecover_owed: (...args: Parameters<typeof actual.unrecover_owed>) => {
      locks.push("owed");
      return actual.unrecover_owed(...args);
    },
  };
});
vi.mock("../pg/queries/payout", async (io) => {
  const actual = await io<typeof import("../pg/queries/payout")>();
  return {
    ...actual,
    payouts_move: (...args: Parameters<typeof actual.payouts_move>) => {
      if (args[2] === fail_move.from) {
        fail_move.from = null;
        return Promise.reject(new Error("Connection terminated unexpectedly"));
      }
      return actual.payouts_move(...args);
    },
  };
});
vi.mock("../env", () => ({
  stage: "test",
  get owed_deductions() {
    return deductions.on;
  },
}));
// before every gift here, so a row a run may net once its notice is sent
vi.mock("@/terms", async (io) => ({
  ...(await io<typeof import("@/terms")>()),
  TERMS_RECOVERY_FROM: "2026-01-01",
  TERMS_POSTED: "",
}));
vi.mock("../kit/slack", () => ({
  aws_monitor: { send_alert },
  fiat_monitor: { send_alert: vi.fn() },
}));
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

const { settle_npo_payouts } = await import("./settle");
const { NotFundedError, PayRefused } = await import("./transfer");
const { processing_payouts } = await import("../pg/queries/payout");
const { dists_for_refund } = await import("../pg/queries/dist");
const { process_refund } = await import("../refund/process");
const { dists } = await import("../pg/schema/dist");
const { bal_txs } = await import("../pg/schema/bal-tx");
const { donations } = await import("../pg/schema/donation");
const { loss_logs, rev_logs } = await import("../pg/schema/revenue");
const { owed_amounts, owed_entries, owed_notices } = await import(
  "../pg/schema/owed"
);
const { create_test_db } = await import("../pg/test-utils/pglite");
const { owed_for_donation } = await import("../pg/queries/owed");
const { npos } = await import("../pg/schema/npo");
const { payouts, settlements } = await import("../pg/schema/payout");

const db = () => test_db.current!.db;

const TRANSFER_ID = 9001;
const RECIPIENT = "777";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  report_error.mockReset();
  send_alert.mockReset();
  fail_move.from = null;
  deductions.on = false;
  locks.length = 0;
  await db().delete(bal_txs);
  await db().delete(loss_logs);
  await db().delete(owed_amounts);
  await db().delete(rev_logs);
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(settlements);
  await db().delete(npos);
});

async function seed_npo(o: {
  cash: number;
  liq?: number;
  lock_units?: number;
  payout_minimum?: number;
}) {
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-SETTLE",
      name: "Settle Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash: o.cash,
      liq: o.liq,
      lock_units: o.lock_units,
      payout_minimum: o.payout_minimum,
    })
    .returning();
  return {
    id: npo!.id,
    name: npo!.name,
    payout_minimum: o.payout_minimum ?? 50,
  };
}

async function seed_payout(npo_id: number, id: string, amount: number) {
  await db()
    .insert(payouts)
    .values({
      id,
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: "2026-09-01T00:00:00.000Z",
      amount,
      type: "pending",
    });
}

/** a settled donation whose one dist owes its cash share through payout `id` */
async function seed_donation_payout(
  npo_id: number,
  id: string,
  amount: number,
  alloc = { liq: 0, lock: 0, cash: 100 }
) {
  const don = `don-${id}`;
  const dist = `dist-${id}`;
  await db().insert(donations).values({
    id: don,
    upusd: 1,
    status: "settled",
    amount_base: amount,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
    created_at: "2026-10-23T16:00:00.000Z",
  });
  await db().insert(dists).values({
    id: dist,
    donation_id: don,
    status: "settled",
    date_created: "2026-09-01T00:00:00.000Z",
    to_id: npo_id,
    to_name: "npo",
    amount,
    amount_denom: "USD",
    net: amount,
    fee_base: 0,
    fee_fsa: 0,
    fee_processing: 0,
    alloc,
  });
  await db()
    .insert(rev_logs)
    .values({
      id: `rev-${id}`,
      date: "2026-09-01T00:00:00.000Z",
      donation_id: dist,
      npo_id,
      type: "base-fee",
      gross: 1,
      commission: 0,
      revenue: 1,
      status: "final",
    });
  await seed_payout(npo_id, id, (amount * alloc.cash) / 100);
  return { don };
}

/** the donor's refund, landing while the payout's transfer is in flight */
const refund_in_flight = async (donation_id: string) =>
  process_refund(donation_id, await dists_for_refund(donation_id), {
    form_id: null,
    program_id: null,
    alert_from: "test",
    source: "refund",
    source_ref: "re_1",
  });

const owed_rows = async () =>
  (
    await Promise.all(
      (
        await db().select({ id: donations.id }).from(donations)
      ).map((g) => owed_for_donation(g.id, db() as never))
    )
  ).flat();

/** what the npo owes on each refunded gift, and how much of it is outstanding */
const owed = async () =>
  (await owed_rows()).map((o) => ({
    donation_id: o.donation_id,
    credited_back_usd: o.credited_back_usd,
    outstanding_usd: o.outstanding_usd,
  }));

/** each entry against what is owed, as why and against what */
const credits = async () =>
  (await db().select().from(owed_entries)).map((e) => ({
    kind: e.kind,
    reason: e.reason,
    ref: e.ref,
    usd: e.usd,
  }));

const payout_types = async () =>
  Object.fromEntries(
    (
      await db().select({ id: payouts.id, type: payouts.type }).from(payouts)
    ).map((r) => [r.id, r.type])
  );

const npo_cash = async (id: number) =>
  (await db().select({ cash: npos.cash }).from(npos).where(eq(npos.id, id)))[0]
    ?.cash;

describe("settle_npo_payouts", () => {
  test("claims, pays the pending total, then settles every payout", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const seen_at_pay: Record<string, string>[] = [];
    const pay = vi.fn<Pay>(async () => {
      seen_at_pay.push(await payout_types());
      return TRANSFER_ID;
    });

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(pay).toHaveBeenCalledOnce();
    expect(pay).toHaveBeenCalledWith(expect.any(String), 100);
    expect(seen_at_pay).toEqual([{ "p-1": "processing", "p-2": "processing" }]);
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "settled",
    });
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt).toMatchObject({
      id: String(TRANSFER_ID),
      other_id: pay.mock.calls[0]![0],
      amount: 100,
    });
    expect([...(stlmt?.sources ?? [])].sort()).toEqual([
      "dist-p-1",
      "dist-p-2",
    ]);
    expect(await npo_cash(npo.id)).toBe(400);
    expect(res).toMatchObject({
      status: "settled",
      total: 100,
      transfer_id: String(TRANSFER_ID),
    });
    expect(report_error).not.toHaveBeenCalled();
  });

  test("pays, records and debits the pending total rounded to cents, a half cent down", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60.004);
    await seed_payout(npo.id, "p-2", 40.001);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(pay).toHaveBeenCalledWith(expect.any(String), 100);
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt?.amount).toBe(100);
    expect(await npo_cash(npo.id)).toBe(400);
    expect(res).toMatchObject({ status: "settled", total: 100 });
  });

  test("a float-drifted pending total is paid as the cents it adds up to", async () => {
    const npo = await seed_npo({ cash: 500, payout_minimum: 0 });
    await seed_payout(npo.id, "p-1", 0.1);
    await seed_payout(npo.id, "p-2", 0.2);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    await settle_npo_payouts(npo, ["p-1", "p-2"], { ref_key: RECIPIENT, pay });

    expect(pay).toHaveBeenCalledWith(expect.any(String), 0.3);
    expect(await npo_cash(npo.id)).toBe(499.7);
  });

  test("pays nothing when none of the payouts is still pending", async () => {
    const npo = await seed_npo({ cash: 500, payout_minimum: 0 });
    await seed_payout(npo.id, "p-1", 60);
    await db()
      .update(payouts)
      .set({ type: "refunded" })
      .where(eq(payouts.id, "p-1"));
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1", "missing"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toEqual({ status: "none_pending" });
    expect(pay).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "refunded" });
    expect(await db().select().from(settlements)).toEqual([]);
    expect(await npo_cash(npo.id)).toBe(500);
  });

  test.each([false, true])(
    "an npo held on a returned transfer is not claimed or paid, whatever eligibility read before (deductions on: %s)",
    async (on) => {
      deductions.on = on;
      const npo = await seed_npo({ cash: 500, payout_minimum: 0 });
      await seed_payout(npo.id, "p-1", 60);
      // the return committed after the cron's eligibility read, before this claim
      await db().insert(settlements).values({
        id: "sttl-returned",
        other_id: "ref-returned",
        npo_id: npo.id,
        date: "2026-10-01T00:00:00.000Z",
        amount: 100,
        status: "returned",
      });
      const pay = vi.fn<Pay>(async () => TRANSFER_ID);

      const res = await settle_npo_payouts(npo, ["p-1"], {
        ref_key: RECIPIENT,
        pay,
      });

      expect(res).toMatchObject({ status: "held" });
      expect(pay).not.toHaveBeenCalled();
      expect(await payout_types()).toEqual({ "p-1": "pending" });
      expect(await npo_cash(npo.id)).toBe(500);
    }
  );

  test("claims and pays nothing when the pending total is under the npo's minimum", async () => {
    const npo = await seed_npo({ cash: 500, payout_minimum: 80 });
    await seed_payout(npo.id, "p-1", 30);
    await seed_payout(npo.id, "p-2", 40);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toEqual({ status: "under_minimum", total: 70, minimum: 80 });
    expect(pay).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({
      "p-1": "pending",
      "p-2": "pending",
    });
    expect(await npo_cash(npo.id)).toBe(500);
  });

  test("a transfer that failed before funding was requested puts the payouts back to pending", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const quote_failed = new Error("wise quote 503");
    const pay = vi.fn<Pay>(async () => {
      throw new NotFundedError(quote_failed);
    });

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toMatchObject({ status: "released" });
    expect(await payout_types()).toEqual({
      "p-1": "pending",
      "p-2": "pending",
    });
    expect(await db().select().from(settlements)).toEqual([]);
    expect(await npo_cash(npo.id)).toBe(500);
    expect(report_error).toHaveBeenCalledWith(
      quote_failed,
      expect.objectContaining({ npo_id: npo.id, ref: pay.mock.calls[0]![0] })
    );
  });

  test("a payout refused before funding, as to our own account, settles nothing, goes back to pending and alerts ops", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 72.82);
    const refused = new PayRefused(
      "recipient 881063184 is one of Better Giving's own Wise accounts"
    );
    const pay = vi.fn<Pay>(async () => {
      throw new NotFundedError(refused);
    });

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: "881063184",
      pay,
    });

    expect(res).toMatchObject({ status: "released" });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await db().select().from(settlements)).toEqual([]);
    expect(await npo_cash(npo.id)).toBe(500);
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.type).toBe("ERROR");
    expect(alert.title).toBe(`payout refused for npo:${npo.id}`);
    expect(alert.body).toContain("one of Better Giving's own Wise accounts");
    expect(alert.fields).toEqual(
      expect.arrayContaining([
        { name: "npo", value: `${npo.id}: ${npo.name}` },
        { name: "recipient", value: "881063184" },
      ])
    );
  });

  test("a refused payout whose alert fails to send is still released", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    send_alert.mockRejectedValue(new Error("slack down"));
    const pay = vi.fn<Pay>(async () => {
      throw new NotFundedError(new PayRefused("quote debits 97.07"));
    });

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toMatchObject({ status: "released" });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
  });

  test("a claim stores its transfer ref on every claimed payout, where processing_payouts reads it", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const pay = vi.fn<Pay>(async () => {
      throw new Error("fetch failed");
    });

    await settle_npo_payouts(npo, ["p-1", "p-2"], { ref_key: RECIPIENT, pay });
    const ref = pay.mock.calls[0]![0];

    const stuck = await processing_payouts();
    expect(stuck.map((p) => [p.id, p.ref])).toEqual([
      ["p-1", ref],
      ["p-2", ref],
    ]);
  });

  test("a claim's ref leaves the rows with it, released or settled", async () => {
    const npo = await seed_npo({ cash: 500, payout_minimum: 0 });
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const unfunded = vi.fn<Pay>(async () => {
      throw new NotFundedError(new Error("wise 503"));
    });

    await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay: unfunded,
    });
    await settle_npo_payouts(npo, ["p-2"], {
      ref_key: RECIPIENT,
      pay: async () => TRANSFER_ID,
    });

    const rows = await db()
      .select({ id: payouts.id, type: payouts.type, message: payouts.message })
      .from(payouts)
      .orderBy(payouts.id);
    expect(rows).toEqual([
      { id: "p-1", type: "pending", message: null },
      { id: "p-2", type: "settled", message: null },
    ]);
  });

  test("a transfer that failed once funding was requested leaves the payouts processing and alerts", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const socket_dropped = new Error("fetch failed");
    const pay = vi.fn<Pay>(async () => {
      throw socket_dropped;
    });

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });
    const ref = pay.mock.calls[0]![0];

    expect(res).toEqual({ status: "fund_unknown", ref });
    expect(await payout_types()).toEqual({
      "p-1": "processing",
      "p-2": "processing",
    });
    expect(await db().select().from(settlements)).toEqual([]);
    expect(await npo_cash(npo.id)).toBe(500);
    expect(report_error).toHaveBeenCalledWith(
      socket_dropped,
      expect.objectContaining({ npo_id: npo.id, ref })
    );
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.type).toBe("ERROR");
    expect(alert.title).toMatch(/funding status unknown/);
    expect(alert.body).toContain(ref);
  });

  test("a paid transfer the settle fails to record leaves the payouts processing and alerts with its transfer id", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    // a settlement already under the transfer id: the settle's insert collides
    await db()
      .insert(settlements)
      .values({
        id: String(TRANSFER_ID),
        npo_id: npo.id,
        date: "2026-08-01T00:00:00.000Z",
        amount: 1,
        status: "",
      });
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });
    const ref = pay.mock.calls[0]![0];

    expect(res).toEqual({
      status: "unrecorded",
      ref,
      transfer_id: String(TRANSFER_ID),
    });
    expect(await payout_types()).toEqual({ "p-1": "processing" });
    expect(await npo_cash(npo.id)).toBe(500);
    expect(report_error).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ref, transfer_id: String(TRANSFER_ID) })
    );
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.type).toBe("ERROR");
    expect(alert.title).toMatch(/funded, not recorded/);
    expect(alert.body).toContain(ref);
    expect(alert.body).toContain(String(TRANSFER_ID));
  });

  test("a set released after an unfunded transfer is claimed again under a new ref, and paid under it", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const pay = vi
      .fn<Pay>()
      .mockRejectedValueOnce(new NotFundedError(new Error("wise 503")))
      .mockResolvedValueOnce(TRANSFER_ID);

    await settle_npo_payouts(npo, ["p-2", "p-1"], { ref_key: RECIPIENT, pay });
    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    const [first, again] = pay.mock.calls.map(([ref]) => ref);
    expect(again).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(again).not.toBe(first);
    expect(res).toMatchObject({ status: "settled", ref: again });
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "settled",
    });
  });

  test("a payout refunded while its transfer was in flight stays refunded_loss, owed by the npo, and is still settled for", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    const { don } = await seed_donation_payout(npo.id, "p-2", 40);
    const pay = vi.fn<Pay>(async () => {
      await refund_in_flight(don);
      return TRANSFER_ID;
    });

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toMatchObject({ status: "settled", total: 100 });
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "refunded_loss",
    });
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt?.amount).toBe(100);
    expect(await npo_cash(npo.id)).toBe(400);
    expect(await owed()).toEqual([
      { donation_id: don, credited_back_usd: 0, outstanding_usd: 40 },
    ]);
    expect(await db().select().from(loss_logs)).toEqual([]);
    const [d] = await db().select().from(dists);
    expect(d?.refund_status).toBe("loss");
    const [dn] = await db()
      .select()
      .from(donations)
      .where(eq(donations.id, don));
    expect(dn?.status).toBe("refunded_loss");
    const refs = await db().select({ message: payouts.message }).from(payouts);
    expect(refs).toEqual([{ message: null }, { message: null }]);
    expect(send_alert).not.toHaveBeenCalled();
  });

  // the units it would have redeemed were priced at refund time, which nothing
  // records, so the invested share stays owed
  test("an unfunded payout refunded in flight on a partly invested dist is cancelled and its cash credited, with no alert", async () => {
    const npo = await seed_npo({ cash: 500, lock_units: 1000 });
    await seed_payout(npo.id, "p-1", 60);
    const { don } = await seed_donation_payout(npo.id, "p-2", 100, {
      liq: 0,
      lock: 60,
      cash: 40,
    });
    const pay = vi.fn<Pay>(async () => {
      await refund_in_flight(don);
      throw new NotFundedError(new Error("wise 503"));
    });

    await settle_npo_payouts(npo, ["p-1", "p-2"], { ref_key: RECIPIENT, pay });

    expect(await payout_types()).toEqual({
      "p-1": "pending",
      "p-2": "refunded",
    });
    expect(await npo_cash(npo.id)).toBe(460);
    expect(await owed()).toEqual([
      { donation_id: don, credited_back_usd: 40, outstanding_usd: 60 },
    ]);
    expect(await credits()).toEqual([
      { kind: "credit", reason: "payout_cancelled", ref: "p-2", usd: 40 },
    ]);
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("a payout loss-refunded in flight whose transfer then went unfunded is refunded as if it had been pending", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    const { don } = await seed_donation_payout(npo.id, "p-2", 40);
    const pay = vi.fn<Pay>(async () => {
      await refund_in_flight(don);
      throw new NotFundedError(new Error("wise 503"));
    });

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toMatchObject({ status: "released" });
    expect(await payout_types()).toEqual({
      "p-1": "pending",
      "p-2": "refunded",
    });
    expect(await npo_cash(npo.id)).toBe(460);
    expect(await owed()).toEqual([
      { donation_id: don, credited_back_usd: 40, outstanding_usd: 0 },
    ]);
    expect(await credits()).toEqual([
      { kind: "credit", reason: "transfer_unfunded", ref: "p-2", usd: 40 },
    ]);
    const [d] = await db().select().from(dists);
    expect([d?.status, d?.refund_status]).toEqual(["refunded", "completed"]);
    const [rl] = await db().select().from(rev_logs);
    expect(rl?.status).toBe("refunded");
    const [dn] = await db()
      .select()
      .from(donations)
      .where(eq(donations.id, don));
    expect(dn?.status).toBe("refunded");
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("an unfunded loss refund on a dist with a savings share takes that share from savings too", async () => {
    const npo = await seed_npo({ cash: 500, liq: 200 });
    const { don } = await seed_donation_payout(npo.id, "p-1", 100, {
      liq: 30,
      lock: 0,
      cash: 70,
    });
    const pay = vi.fn<Pay>(async () => {
      await refund_in_flight(don);
      throw new NotFundedError(new Error("wise 503"));
    });

    await settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay });

    expect(await payout_types()).toEqual({ "p-1": "refunded" });
    const [n] = await db()
      .select({ liq: npos.liq, cash: npos.cash })
      .from(npos)
      .where(eq(npos.id, npo.id));
    expect(n).toEqual({ liq: 170, cash: 430 });
    const txs = await db().select().from(bal_txs);
    expect(
      txs.map((t) => [t.account, t.amount, t.bal_begin, t.bal_end])
    ).toEqual([["liq", 30, 200, 170]]);
    expect(await owed()).toEqual([
      { donation_id: don, credited_back_usd: 100, outstanding_usd: 0 },
    ]);
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("an unfunded payout whose refund was short on savings is cancelled and leaves the shortfall owed, with no alert", async () => {
    const npo = await seed_npo({ cash: 500, liq: 0 });
    const { don } = await seed_donation_payout(npo.id, "p-1", 100, {
      liq: 30,
      lock: 0,
      cash: 70,
    });
    const pay = vi.fn<Pay>(async () => {
      await refund_in_flight(don);
      throw new NotFundedError(new Error("wise 503"));
    });

    await settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay });

    expect(await payout_types()).toEqual({ "p-1": "refunded" });
    expect(await npo_cash(npo.id)).toBe(430);
    expect(await owed()).toEqual([
      { donation_id: don, credited_back_usd: 70, outstanding_usd: 30 },
    ]);
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("an unfunded payout whose owed refund can't be redone tells ops to debit its cash share and credit the owed row", async () => {
    const npo = await seed_npo({ cash: 500 });
    const { don } = await seed_donation_payout(npo.id, "p-1", 100);
    const pay = vi.fn<Pay>(async () => {
      await refund_in_flight(don);
      fail_move.from = "refunded_loss";
      throw new NotFundedError(new Error("wise 503"));
    });

    await settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay });

    expect(await payout_types()).toEqual({ "p-1": "refunded_loss" });
    expect(await owed()).toEqual([
      { donation_id: don, credited_back_usd: 0, outstanding_usd: 100 },
    ]);
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.body).toMatch(
      /debit the npo's cash by each one's cash share, then credit that amount on the gift's owed row/
    );
    expect(alert.body).not.toMatch(/loss log/);
    expect(alert.fields).toContainEqual({
      name: "not_reversed",
      value: expect.stringMatching(/^p-1: .*Connection terminated/),
    });
  });

  test("an unfunded payout refunded before the owed ledger tells ops to reverse its loss log", async () => {
    const npo = await seed_npo({ cash: 500 });
    const { don } = await seed_donation_payout(npo.id, "p-1", 100);
    const pay = vi.fn<Pay>(async () => {
      await refund_in_flight(don);
      // a refund recorded before the ledger wrote a loss log and no owed row
      await db().delete(owed_amounts);
      throw new NotFundedError(new Error("wise 503"));
    });

    await settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay });

    expect(await payout_types()).toEqual({ "p-1": "refunded_loss" });
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.body).toMatch(
      /their loss log records a loss that did not happen: debit the cash or reverse the loss log/
    );
    expect(alert.body).not.toMatch(/owed row/);
    expect(alert.fields).toContainEqual({
      name: "not_reversed",
      value: expect.stringMatching(/^p-1: .*has no amount owed/),
    });
  });

  test("a release that fails after an unfunded transfer alerts that the payouts are safe to reset", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const quote_failed = new Error("wise quote 503");
    const pay = vi.fn<Pay>(async () => {
      fail_move.from = "processing";
      throw new NotFundedError(quote_failed);
    });

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });
    const ref = pay.mock.calls[0]![0];

    expect(res).toEqual({ status: "unreleased", ref });
    expect(await payout_types()).toEqual({
      "p-1": "processing",
      "p-2": "processing",
    });
    expect(report_error).toHaveBeenCalledWith(
      quote_failed,
      expect.objectContaining({ ref, payout_ids: ["p-1", "p-2"] })
    );
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.type).toBe("ERROR");
    expect(alert.title).toMatch(/not funded/);
    expect(alert.body).toMatch(/safe to reset to pending/);
    expect(alert.body).toContain(ref);
    expect(alert.body).toContain("wise quote 503");
    expect(alert.fields).toContainEqual({
      name: "payout_ids",
      value: "p-1, p-2",
    });
  });

  test("a claimed payout that left processing by any path but a loss refund is named in an alert", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const pay = vi.fn<Pay>(async () => {
      await db()
        .update(payouts)
        .set({ type: "cancelled" })
        .where(eq(payouts.id, "p-2"));
      return TRANSFER_ID;
    });

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toMatchObject({ status: "settled", total: 100 });
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "cancelled",
    });
    expect(await npo_cash(npo.id)).toBe(400);
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.type).toBe("ERROR");
    expect(alert.body).toContain(String(TRANSFER_ID));
    expect(alert.fields).toContainEqual({ name: "unsettled", value: "p-2" });
  });
});

/** a gift refunded after its grant went out, the npo owing `usd` on it */
async function seed_owed(
  npo_id: number,
  donation_id: string,
  usd: number,
  created_at = "2026-08-01T00:00:00.000Z"
) {
  await db().insert(donations).values({
    id: donation_id,
    created_at,
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
  const [owed] = await db()
    .insert(owed_amounts)
    .values({
      donation_id,
      npo_id,
      source: "refund",
      source_ref: `re_${donation_id}`,
      recorded_at: "2026-09-15T00:00:00.000Z",
      received_usd: usd,
    })
    .returning({ id: owed_amounts.id });
  // the party was told of it, so a run may net it
  await db().insert(owed_notices).values({
    owed_id: owed!.id,
    kind: "recorded",
    created_at: "2026-09-15T00:00:00.000Z",
    sent_at: "2026-09-15T00:00:00.000Z",
  });
}

describe("settle_npo_payouts: owed deductions", () => {
  const RUN_AT = "2026-10-06T09:00:00.000Z";
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("switched off, an npo owing $93.20 is paid its $500 pending and nothing is recovered", async () => {
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(pay).toHaveBeenCalledWith(expect.any(String), 500);
    expect(res).toMatchObject({ status: "settled", total: 500 });
    expect(await npo_cash(npo.id)).toBe(0);
    expect(await owed()).toEqual([
      { donation_id: "don-owed", credited_back_usd: 0, outstanding_usd: 93.2 },
    ]);
    expect(await credits()).toEqual([]);
  });

  test("switched on, what the npo owes as a referrer is never netted from its grants", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await db()
      .update(npos)
      .set({ referral_id: "NPO-SETTLE" })
      .where(eq(npos.id, npo.id));
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    await db()
      .update(owed_amounts)
      .set({ npo_id: null, referrer_npo: "NPO-SETTLE" })
      .where(eq(owed_amounts.donation_id, "don-owed"));
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    await settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay });

    expect(pay).toHaveBeenCalledWith(expect.any(String), 500);
    expect(await owed()).toEqual([
      { donation_id: "don-owed", credited_back_usd: 0, outstanding_usd: 93.2 },
    ]);
  });

  test("switched on, a funded transfer the settle fails to record alerts with the gross to debit and the net to settle", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    await db()
      .insert(settlements)
      .values({
        id: String(TRANSFER_ID),
        npo_id: npo.id,
        date: "2026-08-01T00:00:00.000Z",
        amount: 1,
        status: "",
      });

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay: async () => TRANSFER_ID,
    });

    expect(res).toMatchObject({ status: "unrecorded" });
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toMatch(/funded, not recorded/);
    expect(alert.fields).toContainEqual({ name: "amount", value: "406.8" });
    expect(alert.fields).toContainEqual({ name: "gross", value: "500" });
    expect(alert.body).toMatch(
      /settlement amount is the net, 406.8; debit the npo's cash by the gross, 500/
    );
  });

  test("switched on, the same npo is paid $406.80 and its row shows $93.20 recovered on the run's date, $0 outstanding", async () => {
    deductions.on = true;
    vi.setSystemTime(RUN_AT);
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    const [ref] = pay.mock.calls[0]!;
    expect(pay).toHaveBeenCalledWith(ref, 406.8);
    expect(res).toMatchObject({ status: "settled", total: 406.8 });
    expect(await payout_types()).toEqual({ "p-1": "settled" });
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt).toMatchObject({ other_id: ref, amount: 406.8 });
    // the payouts leave the npo's cash whole: part paid, part recovered
    expect(await npo_cash(npo.id)).toBe(0);
    const [row] = await owed_rows();
    expect(row).toMatchObject({
      recovered_usd: 93.2,
      recovered_at: RUN_AT,
      outstanding_usd: 0,
    });
    expect(await credits()).toEqual([
      { kind: "recover", reason: "grant_run", ref, usd: 93.2 },
    ]);
  });
  test("switched on, $80 pending against $93.20 owed settles the payouts with no transfer, $80 recovered, $13.20 still owed for the next run", async () => {
    deductions.on = true;
    vi.setSystemTime(RUN_AT);
    const npo = await seed_npo({ cash: 80 });
    await seed_payout(npo.id, "p-1", 50);
    await seed_payout(npo.id, "p-2", 30);
    await seed_owed(npo.id, "don-owed", 93.2);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1", "p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(pay).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "recovered", total: 80 });
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "settled",
    });
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt).toMatchObject({
      npo_id: npo.id,
      date: RUN_AT,
      amount: 0,
      other_id: null,
    });
    const settled_ids = await db()
      .select({ id: payouts.settled_id, date: payouts.settled_date })
      .from(payouts);
    expect(settled_ids).toEqual([
      { id: stlmt!.id, date: RUN_AT },
      { id: stlmt!.id, date: RUN_AT },
    ]);
    expect(await npo_cash(npo.id)).toBe(0);
    const [row] = await owed_rows();
    expect(row).toMatchObject({ recovered_usd: 80, outstanding_usd: 13.2 });
    expect(await credits()).toEqual([
      { kind: "recover", reason: "grant_run", ref: stlmt!.id, usd: 80 },
    ]);
  });

  test("switched on, the next run recovers what the last left owed", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 180 });
    await seed_payout(npo.id, "p-1", 80);
    await seed_owed(npo.id, "don-owed", 93.2);
    await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay: vi.fn<Pay>(),
    });
    await seed_payout(npo.id, "p-2", 100);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-2"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(pay).toHaveBeenCalledWith(expect.any(String), 86.8);
    expect(res).toMatchObject({ status: "settled", total: 86.8 });
    expect(await owed()).toEqual([
      { donation_id: "don-owed", credited_back_usd: 0, outstanding_usd: 0 },
    ]);
    expect(await npo_cash(npo.id)).toBe(0);
  });
  test("switched on, $150 pending against $93.20 owed with a $100 minimum claims and recovers nothing", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 150, payout_minimum: 100 });
    await seed_payout(npo.id, "p-1", 150);
    await seed_owed(npo.id, "don-owed", 93.2);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toEqual({ status: "under_minimum", total: 56.8, minimum: 100 });
    expect(pay).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await owed()).toEqual([
      { donation_id: "don-owed", credited_back_usd: 0, outstanding_usd: 93.2 },
    ]);
    expect(await credits()).toEqual([]);
    expect(await npo_cash(npo.id)).toBe(150);
  });
  test("switched on, an npo due $50 back from a credit is sent its pending total + $50 and the row's due-back clears", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    // an earlier run recovered it all, then $50 of it was credited back
    await db().update(owed_amounts).set({
      recovered_usd: 93.2,
      recovered_at: "2026-09-20T00:00:00.000Z",
      credited_back_usd: 50,
      credited_back_at: "2026-09-25T00:00:00.000Z",
    });
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    const [ref] = pay.mock.calls[0]!;
    expect(pay).toHaveBeenCalledWith(ref, 550);
    expect(res).toMatchObject({ status: "settled", total: 550 });
    expect(await owed()).toEqual([
      { donation_id: "don-owed", credited_back_usd: 50, outstanding_usd: 0 },
    ]);
    expect(await credits()).toEqual([
      { kind: "repay", reason: "grant_run", ref, usd: 50 },
    ]);
    expect(await npo_cash(npo.id)).toBe(0);
  });
  test("switched on, a transfer that failed before funding gives back what the run recovered, and the payouts go back to pending", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    const pay = vi.fn<Pay>(async () => {
      throw new NotFundedError(new Error("insufficient balance"));
    });

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    const [ref] = pay.mock.calls[0]!;
    expect(res).toEqual({ status: "released", ref });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await owed()).toEqual([
      { donation_id: "don-owed", credited_back_usd: 0, outstanding_usd: 93.2 },
    ]);
    expect(await credits()).toEqual([
      { kind: "recover", reason: "grant_run", ref, usd: 93.2 },
      {
        kind: "repay",
        reason: "transfer_unfunded",
        ref: `unfunded:${ref}`,
        usd: 93.2,
      },
    ]);
    expect(await npo_cash(npo.id)).toBe(500);
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("switched on, an unfunded run's release locks the npo before the owed rows it gives back, as a refund does", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    const pay = vi.fn<Pay>(async () => {
      locks.length = 0;
      throw new NotFundedError(new Error("insufficient balance"));
    });

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res.status).toBe("released");
    expect(locks).toEqual(["npo", "owed"]);
  });

  test("switched on, an unfunded run whose deductions can't be undone stays claimed, and tells ops to undo them in the reset", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    const pay = vi.fn<Pay>(async () => {
      // while in flight: the gift is credited back in full and a later run
      // pays that due-back out, leaving nothing recovered to undo
      await db().update(owed_amounts).set({
        credited_back_usd: 93.2,
        credited_back_at: "2026-10-06T10:00:00.000Z",
        recovered_usd: 0,
      });
      throw new NotFundedError(new Error("insufficient balance"));
    });

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    const [ref] = pay.mock.calls[0]!;
    expect(res).toEqual({ status: "unreleased", ref });
    expect(await payout_types()).toEqual({ "p-1": "processing" });
    expect((await credits()).map((c) => c.kind)).toEqual(["recover"]);
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.type).toBe("ERROR");
    expect(alert.title).toBe(`not funded, release failed for npo:${npo.id}`);
    expect(alert.body).toContain(
      `unrecover_owed({ npo_id: ${npo.id}, ref: "${ref}" })`
    );
    expect(alert.body).toMatch(
      /reset to pending only with this run.s deductions taken back/
    );
  });

  // pglite runs one connection, so a refund can't commit mid-claim here. the
  // claim reads, nets and claims in one tx with the owed rows locked, so a
  // refund lands before it (netted now, the first test above) or after it:
  test("switched on, a refund recorded once the claim committed is left whole for the next run", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    const pay = vi.fn<Pay>(async () => {
      await seed_owed(npo.id, "don-later", 40);
      return TRANSFER_ID;
    });

    const res = await settle_npo_payouts(npo, ["p-1"], {
      ref_key: RECIPIENT,
      pay,
    });

    expect(res).toMatchObject({ status: "settled", total: 406.8 });
    expect(
      Object.fromEntries(
        (await owed()).map((o) => [o.donation_id, o.outstanding_usd])
      )
    ).toEqual({ "don-owed": 0, "don-later": 40 });
    expect((await credits()).map((c) => c.usd)).toEqual([93.2]);
  });

  test("switched on, a claim that fails after netting recovers nothing", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    fail_move.from = "pending";
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    await expect(
      settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay })
    ).rejects.toThrow(/Connection terminated/);

    expect(pay).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await owed()).toEqual([
      { donation_id: "don-owed", credited_back_usd: 0, outstanding_usd: 93.2 },
    ]);
    expect(await credits()).toEqual([]);
  });

  test("switched on, an npo with no wise recipient whose owed covers its pending total is settled with no transfer", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 80 });
    await seed_payout(npo.id, "p-1", 80);
    await seed_owed(npo.id, "don-owed", 93.2);

    const res = await settle_npo_payouts(npo, ["p-1"], null);

    expect(res).toMatchObject({ status: "recovered", total: 80 });
    expect(await payout_types()).toEqual({ "p-1": "settled" });
  });

  test("switched on, an npo with no wise recipient owed a transfer claims and recovers nothing", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);

    const res = await settle_npo_payouts(npo, ["p-1"], null);

    expect(res).toEqual({ status: "no_recipient", total: 406.8 });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await credits()).toEqual([]);
  });

  test("switched on, a sub-cent amount owed is recovered to the cent the transfer withholds, the rest left owed", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2051);
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    await settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay });

    expect(pay).toHaveBeenCalledWith(expect.any(String), 406.8);
    const [row] = await owed_rows();
    expect(row).toMatchObject({ recovered_usd: 93.2 });
    expect(row?.outstanding_usd).toBeCloseTo(0.0051, 10);
  });

  test("switched on, a row partly credited back is recovered only for what it still owes", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    await db().update(owed_amounts).set({
      credited_back_usd: 50,
      credited_back_at: "2026-09-25T00:00:00.000Z",
    });
    const pay = vi.fn<Pay>(async () => TRANSFER_ID);

    await settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay });

    expect(pay).toHaveBeenCalledWith(expect.any(String), 456.8);
    const [row] = await owed_rows();
    expect(row).toMatchObject({ recovered_usd: 43.2, outstanding_usd: 0 });
  });

  test("switched on, a payout fully recovered settles with no transfer, and the next run pays what is left after the rest owed", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 580 });
    await seed_owed(npo.id, "don-owed", 93.2);
    await seed_payout(npo.id, "p-1", 80);
    const first = vi.fn<Pay>();
    await settle_npo_payouts(npo, ["p-1"], { ref_key: RECIPIENT, pay: first });
    await seed_payout(npo.id, "p-2", 300);
    await seed_payout(npo.id, "p-3", 200);
    const second = vi.fn<Pay>(async () => TRANSFER_ID);

    await settle_npo_payouts(npo, ["p-2", "p-3"], {
      ref_key: RECIPIENT,
      pay: second,
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(expect.any(String), 486.8);
    expect(
      (await db().select({ usd: settlements.amount }).from(settlements))
        .map((r) => r.usd)
        .sort((a, b) => a - b)
    ).toEqual([0, 486.8]);
    expect(await owed()).toEqual([
      { donation_id: "don-owed", credited_back_usd: 0, outstanding_usd: 0 },
    ]);
  });
});
