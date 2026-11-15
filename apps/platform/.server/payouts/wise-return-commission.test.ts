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
import type { TestDb } from "../pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const report_error = vi.hoisted(() => vi.fn());
const send_alert = vi.hoisted(() => vi.fn());
const deductions = vi.hoisted(() => ({ on: false }));
const locks = vi.hoisted(() => [] as string[]);

vi.mock("#/errors/report", () => ({ report_error }));
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
vi.mock("./owed-run", async (io) => {
  const real = await io<typeof import("./owed-run")>();
  return {
    ...real,
    lock_run: async (...args: Parameters<typeof real.lock_run>) => {
      locks.push(args[1]);
      return real.lock_run(...args);
    },
  };
});
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

const { settle_referrer_commissions } = await import("./settle-commissions");
const {
  poll_commission_returns,
  resend_all_returned_commissions,
  resend_returned_commissions,
  return_commission_payout,
} = await import("./wise-return-commission");
const { poll_wise_returns } = await import("./wise-return");
const { apply_refund_plan } = await import("../refund/apply");
const { calc_refund_plan } = await import("../refund/plan");
const { owed_for_donation } = await import("../pg/queries/owed");
const { payout_ltd_get, pending_earnings } = await import(
  "../pg/queries/referrer"
);
const { donations } = await import("../pg/schema/donation");
const { dists } = await import("../pg/schema/dist");
const { bal_txs } = await import("../pg/schema/bal-tx");
const { npos } = await import("../pg/schema/npo");
const { owed_amounts, owed_entries, owed_notices } = await import(
  "../pg/schema/owed"
);
const { referrer_commissions, referrer_payouts } = await import(
  "../pg/schema/referrer"
);
const { create_test_db } = await import("../pg/test-utils/pglite");

const db = () => test_db.current!.db;

const REFERRER = "NPO-REF";
const PAY_ID = 42;
let npo_id: number;
let next_transfer = 9000;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  report_error.mockReset();
  send_alert.mockReset();
  locks.length = 0;
  deductions.on = false;
  await db().delete(referrer_payouts);
  await db().delete(referrer_commissions);
  await db().delete(owed_amounts);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(bal_txs);
  await db().delete(npos);
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-COMMISSION-RETURN",
      name: "Commission Return NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      referral_id: REFERRER,
    })
    .returning();
  npo_id = npo!.id;
});

async function seed(donation_id: string, amount: number) {
  await db().insert(referrer_commissions).values({
    referrer_npo: REFERRER,
    date: "2026-09-01T00:00:00.000Z",
    donation_id,
    npo_id,
    amount,
    status: "pending",
  });
}

async function seed_owed(donation_id: string, usd: number) {
  await db().insert(donations).values({
    id: donation_id,
    created_at: "2026-08-01T00:00:00.000Z",
    upusd: 1,
    status: "refunded",
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
      referrer_npo: REFERRER,
      source: "refund",
      source_ref: `re_${donation_id}`,
      recorded_at: "2026-09-15T00:00:00.000Z",
      received_usd: usd,
    })
    .returning({ id: owed_amounts.id });
  await db().insert(owed_notices).values({
    owed_id: owed!.id,
    kind: "recorded",
    created_at: "2026-09-15T00:00:00.000Z",
    sent_at: "2026-09-15T00:00:00.000Z",
  });
}

/** a commission run that pays the referrer through wise, to `pay_id` */
async function sent(pay_id = PAY_ID) {
  const transfer_id = ++next_transfer;
  const res = await settle_referrer_commissions(
    { id: REFERRER, pay_min: 0 },
    { pay_id, pay: async () => transfer_id }
  );
  expect(res.status).toBe("paid");
  if (res.status !== "paid") throw new Error("not paid");
  return { ref: res.ref, transfer_id };
}

const statuses = async () =>
  Object.fromEntries(
    (await db().select().from(referrer_commissions)).map((r) => [
      r.donation_id,
      r.status,
    ])
  );

const payout = async (ref: string) =>
  (
    await db()
      .select()
      .from(referrer_payouts)
      .where(eq(referrer_payouts.id, ref))
  )[0];

const entries = async () =>
  (await db().select().from(owed_entries))
    .map((e) => ({ kind: e.kind, reason: e.reason, ref: e.ref, usd: e.usd }))
    .sort((a, b) => a.ref.localeCompare(b.ref) || a.kind.localeCompare(b.kind));

describe("return_commission_payout", () => {
  test("a plain run's commissions go returned, the referrer is owed them again, the payout stops counting, and ops is told once", async () => {
    await seed("d-1", 60);
    await seed("d-2", 40);
    const { ref } = await sent();
    expect(await payout_ltd_get(REFERRER)).toBe(100);
    expect(await pending_earnings(REFERRER)).toBe(0);

    const res = await return_commission_payout(ref);

    expect(res).toMatchObject({
      status: "returned",
      returned: ["d-1", "d-2"],
    });
    expect(await statuses()).toEqual({ "d-1": "returned", "d-2": "returned" });
    expect((await payout(ref))?.status).toBe("returned");
    expect(await payout_ltd_get(REFERRER)).toBe(0);
    expect(await pending_earnings(REFERRER)).toBe(100);
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe(`Commission transfer returned for ${REFERRER}`);
    expect(alert.type).toBe("ERROR");
    expect(alert.fields).toEqual(
      expect.arrayContaining([
        { name: "payout", value: ref },
        { name: "amount", value: "100" },
        { name: "donation_ids", value: "d-1, d-2" },
      ])
    );
    expect(locks).toContain(`commission_run:${REFERRER}`);
  });

  test("a commission whose gift was refunded after it was paid is not payable again: it is cancelled and what the referrer owes for it is credited back", async () => {
    await seed("d-1", 60);
    await seed("d-2", 40);
    const { ref } = await sent();
    // the donor's refund came after the pay-out: the commission stays paid and
    // the referrer owes it
    await db().insert(donations).values({
      id: "don-1",
      created_at: "2026-08-01T00:00:00.000Z",
      upusd: 1,
      status: "refunded",
      amount_base: 60,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
    });
    await db().insert(dists).values({
      id: "d-1",
      donation_id: "don-1",
      status: "refunded",
      refund_status: "completed",
      date_created: "2026-08-01T00:00:00.000Z",
      to_id: npo_id,
      amount_denom: "USD",
      net: 60,
    });
    const [owed] = await db()
      .insert(owed_amounts)
      .values({
        donation_id: "don-1",
        referrer_npo: REFERRER,
        source: "refund",
        source_ref: "re_don-1",
        recorded_at: "2026-09-15T00:00:00.000Z",
        received_usd: 60,
      })
      .returning({ id: owed_amounts.id });
    await db().insert(owed_notices).values({
      owed_id: owed!.id,
      kind: "recorded",
      created_at: "2026-09-15T00:00:00.000Z",
      sent_at: "2026-09-15T00:00:00.000Z",
    });
    const [before] = await owed_for_donation("don-1", db() as never);
    expect(before?.outstanding_usd).toBe(60);

    const res = await return_commission_payout(ref);

    expect(res).toMatchObject({
      status: "returned",
      returned: ["d-2"],
      loss_credited: ["d-1"],
    });
    // d-2 is owed to the referrer again; d-1 can never be paid again
    expect(await statuses()).toEqual({
      "d-1": "refunded_loss",
      "d-2": "returned",
    });
    const [after] = await owed_for_donation("don-1", db() as never);
    expect(after?.outstanding_usd).toBe(0);
    expect(await pending_earnings(REFERRER)).toBe(40);
    // a new account re-sends only what is still owed
    expect(await resend_returned_commissions(REFERRER, { pay_id: 99 })).toEqual(
      {
        status: "resent",
        ids: ["d-2"],
      }
    );
    expect(await statuses()).toEqual({
      "d-1": "refunded_loss",
      "d-2": "pending",
    });
  });

  test("a second detection of the same return changes nothing and tells no one", async () => {
    await seed("d-1", 60);
    const { ref } = await sent();
    await return_commission_payout(ref);
    send_alert.mockClear();

    expect(await return_commission_payout(ref)).toEqual({
      status: "already_returned",
    });
    expect(await statuses()).toEqual({ "d-1": "returned" });
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("a run that withheld what the referrer owed returns the gross, and the referrer owes it again", async () => {
    deductions.on = true;
    await seed("d-1", 200);
    await seed_owed("don-owed", 9);
    const { ref } = await sent();
    expect((await payout(ref))?.amount).toBe(191);
    const [before] = await owed_for_donation("don-owed", db() as never);
    expect(before?.outstanding_usd).toBe(0);

    const res = await return_commission_payout(ref);

    expect(res).toMatchObject({ status: "returned", returned: ["d-1"] });
    const [row] = await owed_for_donation("don-owed", db() as never);
    expect(row?.outstanding_usd).toBe(9);
    expect(await entries()).toEqual([
      { kind: "recover", reason: "commission_run", ref, usd: 9 },
      {
        kind: "repay",
        reason: "transfer_unfunded",
        ref: `unfunded:${ref}`,
        usd: 9,
      },
    ]);
    expect(await pending_earnings(REFERRER)).toBe(200);
  });

  test("commissions that do not add up to what the ledger says was sent change nothing and tell ops both figures", async () => {
    await seed("d-1", 60);
    const { ref } = await sent();
    await db()
      .update(referrer_commissions)
      .set({ amount: 61 })
      .where(eq(referrer_commissions.donation_id, "d-1"));

    expect(await return_commission_payout(ref)).toEqual({
      status: "gross_mismatch",
      recomputed: 61,
      ledger: 60,
    });
    expect(await statuses()).toEqual({ "d-1": "paid" });
    expect((await payout(ref))?.status).toBe("");
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe(
      `Commission transfer returned, run does not add up: ${REFERRER}`
    );
  });

  test("a payout that does not exist is not found", async () => {
    expect(await return_commission_payout("nope")).toEqual({
      status: "not_found",
    });
  });
});

describe("poll_commission_returns", () => {
  test("money back takes the run back once, however many polls see it", async () => {
    await seed("d-1", 60);
    const { ref, transfer_id } = await sent();
    const lookup = vi.fn(async (_: number) => ({
      status: "funds_refunded",
      recipient: String(PAY_ID),
    }));

    await poll_commission_returns(lookup);
    await poll_commission_returns(lookup);

    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith(transfer_id);
    expect(await statuses()).toEqual({ "d-1": "returned" });
    expect((await payout(ref))?.status).toBe("returned");
    expect(send_alert).toHaveBeenCalledOnce();
  });

  test("the claim stores the recipient on its payout", async () => {
    await seed("d-1", 60);
    const { ref } = await sent(77);

    expect((await payout(ref))?.recipient_id).toBe("77");
  });

  test.each([["bounced_back"], ["cancelled"]])(
    "%s only stores the state and alerts, taking nothing back",
    async (state) => {
      await seed("d-1", 60);
      const { ref } = await sent();

      await poll_commission_returns(async () => state);

      expect(await statuses()).toEqual({ "d-1": "paid" });
      expect((await payout(ref))?.status).toBe(state);
      expect(send_alert).toHaveBeenCalledOnce();
      expect(send_alert.mock.calls[0]![0].body).toMatch(
        /Change nothing by hand/
      );
      // a later funds_refunded still takes it back
      send_alert.mockClear();
      await poll_commission_returns(async () => "funds_refunded");
      expect(await statuses()).toEqual({ "d-1": "returned" });
    }
  );

  test("an ordinary state is stored without an alert", async () => {
    await seed("d-1", 60);
    const { ref } = await sent();

    await poll_commission_returns(async () => "outgoing_payment_sent");

    expect((await payout(ref))?.status).toBe("outgoing_payment_sent");
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("asks wise only of real transfers from the last 90 days whose state is not final", async () => {
    const row = (
      id: string,
      o: Partial<typeof referrer_payouts.$inferInsert>
    ) =>
      db()
        .insert(referrer_payouts)
        .values({
          id,
          referrer_npo: REFERRER,
          date: new Date().toISOString(),
          amount: 50,
          transfer_id: Number(id),
          ...o,
        });
    await row("1001", {});
    await row("1002", { status: "returned" });
    await row("1003", { status: "charged_back" });
    await row("1004", { error: "Failed to process commission" });
    await row("1005", { transfer_id: null });
    await row("1006", { amount: 0 });
    await row("1007", { date: "2020-01-01T00:00:00.000Z" });
    await row("1008", { status: "cancelled" });
    const lookup = vi.fn(async (_: number) => ({
      status: "processing",
      recipient: "5",
    }));

    await poll_commission_returns(lookup);

    expect(lookup.mock.calls.map(([id]) => id).sort()).toEqual([
      1001, 1002, 1008,
    ]);
  });

  test("a returned run recorded without its recipient has it read off the transfer", async () => {
    await seed("d-1", 60);
    const { ref } = await sent();
    await return_commission_payout(ref);
    await db()
      .update(referrer_payouts)
      .set({ recipient_id: null })
      .where(eq(referrer_payouts.id, ref));

    await poll_commission_returns(async () => ({
      status: "funds_refunded",
      recipient: "31",
    }));

    expect((await payout(ref))?.recipient_id).toBe("31");
  });

  test("a returned run older than the poll window still has its recipient read off the transfer", async () => {
    await seed("d-1", 60);
    const { ref } = await sent();
    await return_commission_payout(ref);
    await db()
      .update(referrer_payouts)
      .set({ recipient_id: null, date: "2025-01-01T00:00:00.000Z" })
      .where(eq(referrer_payouts.id, ref));

    await poll_commission_returns(async () => ({
      status: "funds_refunded",
      recipient: "31",
    }));

    expect((await payout(ref))?.recipient_id).toBe("31");
  });

  test("a lookup that fails is reported and the rest are still polled", async () => {
    await seed("d-1", 60);
    await sent();
    await seed("d-2", 70);
    const second = await sent();
    const lookup = vi.fn(async (id: number) => {
      if (id !== second.transfer_id) throw "wise 503";
      return "processing";
    });

    await poll_commission_returns(lookup);

    expect(report_error).toHaveBeenCalledOnce();
    expect((await payout(second.ref))?.status).toBe("processing");
  });

  test("the grants returns poll polls commission transfers too", async () => {
    await seed("d-1", 60);
    await sent();

    await poll_wise_returns(async () => "funds_refunded");

    expect(await statuses()).toEqual({ "d-1": "returned" });
  });
});

describe("resend_returned_commissions", () => {
  async function returned_run() {
    await seed("d-1", 60);
    await seed("d-2", 40);
    const { ref } = await sent(PAY_ID);
    await return_commission_payout(ref);
    send_alert.mockClear();
    locks.length = 0;
    return ref;
  }

  test("the same payout account keeps them returned", async () => {
    await returned_run();

    expect(
      await resend_returned_commissions(REFERRER, { pay_id: PAY_ID })
    ).toEqual({
      status: "held",
      reason: "the payout account is the one the transfer bounced from",
    });
    expect(await statuses()).toEqual({ "d-1": "returned", "d-2": "returned" });
  });

  test("no payout account keeps them returned", async () => {
    await returned_run();

    expect(await resend_returned_commissions(REFERRER, undefined)).toEqual({
      status: "held",
      reason: "no payout account",
    });
  });

  test("a returned run whose recipient is not on record keeps them returned", async () => {
    const ref = await returned_run();
    await db()
      .update(referrer_payouts)
      .set({ recipient_id: null })
      .where(eq(referrer_payouts.id, ref));

    expect(
      await resend_returned_commissions(REFERRER, { pay_id: 99 })
    ).toMatchObject({
      status: "held",
    });
  });

  test("a different payout account puts them back to pending, once, under the run lock", async () => {
    await returned_run();

    expect(await resend_returned_commissions(REFERRER, { pay_id: 99 })).toEqual(
      {
        status: "resent",
        ids: ["d-1", "d-2"],
      }
    );
    expect(await statuses()).toEqual({ "d-1": "pending", "d-2": "pending" });
    expect(
      (await db().select().from(referrer_commissions)).map((c) => c.ref)
    ).toEqual([null, null]);
    expect(locks).toEqual([`commission_run:${REFERRER}`]);
    expect(await resend_returned_commissions(REFERRER, { pay_id: 99 })).toEqual(
      {
        status: "none",
      }
    );
  });

  // the referrer never had the money, so the refund owes them nothing and the
  // run that follows the new account must not pay it
  test("a commission refunded while returned is not re-sent, paid, owed or counted", async () => {
    await returned_run();
    const plan = calc_refund_plan(
      {
        dist: {
          id: "d-1",
          donation_id: "don-1",
          to_id: npo_id,
          to_name: "Commission Return NPO",
          alloc: { liq: 0, lock: 0, cash: 0 },
          net: 0,
          amount: 60,
          amount_usd: 60,
          fee_base: 0,
          fee_fsa: 0,
          fee_processing: 0,
        },
        payout: null,
        commission: {
          donation_id: "d-1",
          amount: 60,
          status: "returned",
          referrer: { referrer_npo: REFERRER },
        },
        rev_log_ids: [],
        bal: { liq: 0, lock_units: 0, cash: 0 },
        nav: null,
        sub_id: null,
      },
      {
        now: "2026-09-20T00:00:00.000Z",
        nav_date: "2026-09-20T00:00:00.001Z",
        form_id: null,
        program_id: null,
      }
    );
    const refund = await db().transaction((tx) =>
      apply_refund_plan(tx as any, plan, {
        source: "refund",
        source_ref: "re_d-1",
      })
    );
    expect(refund.owed).toEqual([]);

    expect(await resend_returned_commissions(REFERRER, { pay_id: 99 })).toEqual(
      {
        status: "resent",
        ids: ["d-2"],
      }
    );
    expect(await statuses()).toEqual({ "d-1": "refunded", "d-2": "pending" });
    expect(await pending_earnings(REFERRER)).toBe(40);
    const run = await settle_referrer_commissions(
      { id: REFERRER, pay_min: 0 },
      { pay_id: 99, pay: async () => ++next_transfer }
    );
    if (run.status !== "paid") throw new Error(`run ${run.status}`);
    expect((await payout(run.ref))?.amount).toBe(40);
    expect(await statuses()).toEqual({ "d-1": "refunded", "d-2": "paid" });
    expect(await owed_for_donation("don-1", db() as any)).toEqual([]);
  });

  test("a nonprofit referrer's account approved before the bounce stays held, one approved after it is re-sent", async () => {
    const ref = await returned_run();
    const [row] = await db()
      .select()
      .from(referrer_payouts)
      .where(eq(referrer_payouts.id, ref));
    const bounced_at = row!.date;
    const before = new Date(Date.parse(bounced_at) - 1000).toISOString();
    const after = new Date(Date.parse(bounced_at) + 1000).toISOString();

    expect(
      await resend_returned_commissions(REFERRER, { pay_id: 99, since: before })
    ).toEqual({
      status: "held",
      reason: "the payout account predates the returned transfer",
    });
    expect(await statuses()).toEqual({ "d-1": "returned", "d-2": "returned" });

    // the account that bounced, approved again after it: still the same recipient
    expect(
      await resend_returned_commissions(REFERRER, {
        pay_id: PAY_ID,
        since: after,
      })
    ).toMatchObject({ status: "held" });

    expect(
      await resend_returned_commissions(REFERRER, { pay_id: 99, since: after })
    ).toEqual({ status: "resent", ids: ["d-1", "d-2"] });
  });

  test("the commissions run holds a nonprofit referrer's account approved before the bounce", async () => {
    await seed("d-1", 60);
    const first = await sent(PAY_ID);
    await return_commission_payout(first.ref);
    const [row] = await db()
      .select()
      .from(referrer_payouts)
      .where(eq(referrer_payouts.id, first.ref));
    await seed("d-2", 70);

    const held = await settle_referrer_commissions(
      { id: REFERRER, pay_min: 0 },
      {
        pay_id: 99,
        since: new Date(Date.parse(row!.date) - 1000).toISOString(),
        pay: async () => ++next_transfer,
      }
    );

    expect(held).toEqual({ status: "held" });
    expect(await statuses()).toEqual({ "d-1": "returned", "d-2": "pending" });
  });

  test("a referrer with nothing returned has nothing to re-send", async () => {
    await seed("d-1", 60);

    expect(await resend_returned_commissions(REFERRER, { pay_id: 99 })).toEqual(
      {
        status: "none",
      }
    );
  });

  test("the sweep re-sends for each referrer on a new account, and tells ops", async () => {
    await returned_run();

    await resend_all_returned_commissions(async () => ({ pay_id: 99 }));

    expect(await statuses()).toEqual({ "d-1": "pending", "d-2": "pending" });
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe(`Returned commissions re-sent for ${REFERRER}`);
    expect(alert.type).toBe("NOTICE");
  });
});

describe("a referrer on a bounced account", () => {
  const never_pays = vi.fn(async () => 1);

  test.each([[false], [true]])(
    "the claim reads the hold under the referrer's run lock, the one a return takes (deductions on: %s)",
    async (on) => {
      deductions.on = on;
      await seed("d-1", 60);
      locks.length = 0;

      await settle_referrer_commissions(
        { id: REFERRER, pay_min: 0 },
        { pay_id: PAY_ID, pay: async () => ++next_transfer }
      );

      expect(locks[0]).toBe(`commission_run:${REFERRER}`);
    }
  );

  beforeEach(() => never_pays.mockClear());

  test("commissions earned after a return are not paid to the bounced account, and are paid once it changes", async () => {
    await seed("d-1", 60);
    const { ref } = await sent(PAY_ID);
    await return_commission_payout(ref);
    await seed("d-2", 70);
    send_alert.mockClear();

    const held = await settle_referrer_commissions(
      { id: REFERRER, pay_min: 0 },
      { pay_id: PAY_ID, pay: never_pays }
    );

    expect(held).toEqual({ status: "held" });
    expect(never_pays).not.toHaveBeenCalled();
    expect(await statuses()).toEqual({ "d-1": "returned", "d-2": "pending" });
    expect(send_alert).not.toHaveBeenCalled();
    expect(report_error).not.toHaveBeenCalled();

    const paid = await settle_referrer_commissions(
      { id: REFERRER, pay_min: 0 },
      { pay_id: 99, pay: async () => ++next_transfer }
    );
    expect(paid.status).toBe("paid");
    expect(await statuses()).toEqual({ "d-1": "returned", "d-2": "paid" });
  });

  test("bounced on A, then on B: B stays held, and switching back to A is a different account than the latest bounce, so it is re-sent", async () => {
    await seed("d-1", 60);
    const first = await sent(PAY_ID);
    await return_commission_payout(first.ref);
    await seed("d-2", 40);
    const second = await sent(77);
    await return_commission_payout(second.ref);
    await db()
      .update(referrer_payouts)
      .set({ date: "2026-10-01T00:00:00.000Z" })
      .where(eq(referrer_payouts.id, first.ref));
    await db()
      .update(referrer_payouts)
      .set({ date: "2026-10-10T00:00:00.000Z" })
      .where(eq(referrer_payouts.id, second.ref));
    expect(await statuses()).toEqual({ "d-1": "returned", "d-2": "returned" });

    expect(
      await resend_returned_commissions(REFERRER, { pay_id: 77 })
    ).toMatchObject({
      status: "held",
    });
    expect(await statuses()).toEqual({ "d-1": "returned", "d-2": "returned" });

    expect(
      await resend_returned_commissions(REFERRER, { pay_id: PAY_ID })
    ).toEqual({
      status: "resent",
      ids: ["d-1", "d-2"],
    });
  });

  test("bounced on A, then a different account B is the one paid: not held, and what bounced on A is paid to B", async () => {
    await seed("d-1", 60);
    await return_commission_payout((await sent(PAY_ID)).ref);

    expect(await resend_returned_commissions(REFERRER, { pay_id: 99 })).toEqual(
      {
        status: "resent",
        ids: ["d-1"],
      }
    );
    const paid = await settle_referrer_commissions(
      { id: REFERRER, pay_min: 0 },
      { pay_id: 99, pay: async () => ++next_transfer }
    );
    expect(paid.status).toBe("paid");
  });
});
