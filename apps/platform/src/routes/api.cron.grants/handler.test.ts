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
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const wise_pay_mock = vi.hoisted(() => vi.fn());
const report_error_mock = vi.hoisted(() => vi.fn());
const send_alert = vi.hoisted(() => vi.fn());
const settle_spy = vi.hoisted(() => vi.fn());
const deductions = vi.hoisted(() => ({ on: false }));
/** runs right after the cron's pending snapshot — a write that commits
 * between the snapshot and the settle */
const after_snapshot = vi.hoisted(() => ({
  current: null as null | (() => Promise<void>),
}));

vi.mock("#/errors/report", () => ({ report_error: report_error_mock }));
vi.mock("$/env", () => ({
  stage: "test",
  wise: { profile_id: "1" },
  get owed_deductions() {
    return deductions.on;
  },
}));
// before every gift here, so a row a run may net once its notice is sent
const terms = vi.hoisted(() => ({ effective: "2026-01-01" }));
vi.mock("@/terms", async (io) => ({
  ...(await io<typeof import("@/terms")>()),
  get TERMS_RECOVERY_FROM() {
    return terms.effective;
  },
  TERMS_POSTED: "",
}));
vi.mock("$/kit/slack", () => ({ aws_monitor: { send_alert } }));
// wise at its http boundary; `wise_pay` runs for real over it unless a test
// replaces `wise_pay_mock`'s implementation
const wise = vi.hoisted(() => ({
  v2_account: vi.fn(async () => ({ currency: "USD" })),
  // fee-free balance option: the transfer sends the whole quoted amount
  quote: vi.fn(async (_: string, q: { sourceAmount: number }) => ({
    id: `q-${q.sourceAmount}`,
    sourceAmount: q.sourceAmount,
    sourceCurrency: "USD",
    payOut: "BANK_TRANSFER",
    paymentOptions: [
      {
        disabled: false,
        payIn: "BALANCE",
        payOut: "BANK_TRANSFER",
        sourceAmount: q.sourceAmount,
        fee: { total: 0 },
      },
    ],
  })),
  // none of ours: no recipient here is one of our own balances
  account_details: vi.fn(async () => []),
  transfer: vi.fn(
    async (t: { customerTransactionId: string; quoteUuid: string }) => ({
      id: 9001,
      status: "incoming_payment_waiting",
      sourceValue: Number(t.quoteUuid.slice(2)),
    })
  ),
  fund_transfer: vi.fn(async () => ({ status: "COMPLETED" })),
}));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("$/payouts/wise-pay", () => ({ wise_pay: wise_pay_mock }));
vi.mock("$/payouts/settle", async (io) => {
  const actual = await io<typeof import("$/payouts/settle")>();
  settle_spy.mockImplementation(actual.settle_npo_payouts);
  return { ...actual, settle_npo_payouts: settle_spy };
});
vi.mock("$/pg/queries/payout", async (io) => {
  const actual = await io<typeof import("$/pg/queries/payout")>();
  return {
    ...actual,
    pending_payouts: async () => {
      const snapshot = await actual.pending_payouts();
      await after_snapshot.current?.();
      return snapshot;
    },
  };
});
vi.mock("$/pg/db", () => ({
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

const { index } = await import("./handler");
const { NotFundedError } = await import("$/payouts/transfer");
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { banking_apps } = await import("$/pg/schema/banking");
const { donations } = await import("$/pg/schema/donation");
const { owed_amounts, owed_notices } = await import("$/pg/schema/owed");
const { owed_for_donation } = await import("$/pg/queries/owed");
const { npos } = await import("$/pg/schema/npo");
const { payouts, settlements } = await import("$/pg/schema/payout");

const db = () => test_db.current!.db;

const WISE_RECIPIENT = 777;
const TRANSFER_ID = 9001;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  after_snapshot.current = null;
  const { wise_pay } =
    await vi.importActual<typeof import("$/payouts/wise-pay")>(
      "$/payouts/wise-pay"
    );
  wise_pay_mock.mockReset().mockImplementation(wise_pay);
  wise.quote.mockClear();
  wise.transfer.mockClear();
  report_error_mock.mockReset();
  send_alert.mockReset();
  settle_spy.mockClear();
  deductions.on = false;
  terms.effective = "2026-01-01";
  await db().delete(owed_amounts);
  await db().delete(donations);
  await db().delete(payouts);
  await db().delete(settlements);
  await db().delete(banking_apps);
  await db().delete(npos);
});

async function seed_npo(o: {
  cash: number;
  payout_minimum?: number;
  recipient?: boolean;
  /** the bank's status; an old approval left it "approved", no default flag */
  bank_status?: "default" | "approved";
}) {
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-GRANTS",
      name: "Grants Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash: o.cash,
      payout_minimum: o.payout_minimum,
    })
    .returning();
  if (o.recipient !== false) {
    await db()
      .insert(banking_apps)
      .values({
        id: String(WISE_RECIPIENT),
        npo_id: npo!.id,
        status: o.bank_status ?? "default",
      });
  }
  return npo!.id;
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

/** left `processing` by a run that died; no `ref` is a claim from before refs were stored */
async function seed_claimed(
  npo_id: number,
  id: string,
  amount: number,
  ref?: string
) {
  await seed_payout(npo_id, id, amount);
  await db()
    .update(payouts)
    .set({ type: "processing", message: ref ?? null })
    .where(eq(payouts.id, id));
}

/** a gift refunded after its grant went out, the npo owing `usd` on it */
async function seed_owed(npo_id: number, donation_id: string, usd: number) {
  await db().insert(donations).values({
    id: donation_id,
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

const outstanding = async () =>
  (await owed_for_donation("don-owed")).map((o) => o.outstanding_usd);

async function mark_refunded(id: string) {
  await db()
    .update(payouts)
    .set({ type: "refunded" })
    .where(eq(payouts.id, id));
}

const payout_types = async () =>
  Object.fromEntries(
    (
      await db().select({ id: payouts.id, type: payouts.type }).from(payouts)
    ).map((r) => [r.id, r.type])
  );

const npo_cash = async (id: number) =>
  (await db().select({ cash: npos.cash }).from(npos).where(eq(npos.id, id)))[0]
    ?.cash;

describe("grants cron execute", () => {
  test("pays the npo its full pending total and settles every payout", async () => {
    const npo_id = await seed_npo({ cash: 500 });
    await seed_payout(npo_id, "p-1", 60);
    await seed_payout(npo_id, "p-2", 40);

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(settle_spy).toHaveBeenCalledOnce();
    expect(settle_spy.mock.calls[0]![0]).toMatchObject({ id: npo_id });
    expect([...settle_spy.mock.calls[0]![1]].sort()).toEqual(["p-1", "p-2"]);
    expect(wise_pay_mock).toHaveBeenCalledOnce();
    expect(wise_pay_mock).toHaveBeenCalledWith(
      WISE_RECIPIENT,
      100,
      expect.any(String)
    );
    const ref = wise_pay_mock.mock.calls[0]![2];
    expect(send_alert).toHaveBeenCalledOnce();
    expect(send_alert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "NOTICE",
        title: expect.stringMatching(/^Grant paid for npo:/),
        fields: [
          { name: "amount", value: "100" },
          { name: "transfer_id", value: String(TRANSFER_ID) },
          { name: "ref_id", value: ref },
        ],
      })
    );
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "settled",
    });
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt).toMatchObject({ id: String(TRANSFER_ID), amount: 100 });
    expect([...(stlmt?.sources ?? [])].sort()).toEqual([
      "dist-p-1",
      "dist-p-2",
    ]);
    expect(await npo_cash(npo_id)).toBe(400);
  });

  test("a payout refunded after the snapshot is left out of the transfer and the settlement", async () => {
    const npo_id = await seed_npo({ cash: 500 });
    await seed_payout(npo_id, "p-1", 60);
    await seed_payout(npo_id, "p-2", 40);
    after_snapshot.current = () => mark_refunded("p-2");

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(wise_pay_mock).toHaveBeenCalledWith(
      WISE_RECIPIENT,
      60,
      expect.any(String)
    );
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "refunded",
    });
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt).toMatchObject({ amount: 60, sources: ["dist-p-1"] });
    expect(await npo_cash(npo_id)).toBe(440);
  });

  test("no transfer when every snapshot payout was refunded meanwhile", async () => {
    // the column has no db check, so a zero minimum is storable and only the
    // nothing-pending guard stops a zero wise transfer
    const npo_id = await seed_npo({ cash: 500, payout_minimum: 0 });
    await seed_payout(npo_id, "p-1", 60);
    await seed_payout(npo_id, "p-2", 40);
    after_snapshot.current = async () => {
      await mark_refunded("p-1");
      await mark_refunded("p-2");
    };

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(wise_pay_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({
      "p-1": "refunded",
      "p-2": "refunded",
    });
    expect(await db().select().from(settlements)).toEqual([]);
    expect(await npo_cash(npo_id)).toBe(500);
  });

  test("payouts a past run claimed and never settled raise one alert naming each claim's wise ref, and the run still pays", async () => {
    const npo_id = await seed_npo({ cash: 500 });
    await seed_claimed(npo_id, "stuck-1", 70, "ref-a");
    await seed_claimed(npo_id, "stuck-2", 30, "ref-a");
    await seed_claimed(npo_id, "stuck-3", 20);
    await seed_payout(npo_id, "p-1", 60);

    await index();

    const errors = send_alert.mock.calls
      .map(([a]) => a)
      .filter((a) => a.type === "ERROR");
    expect(errors).toHaveLength(1);
    expect(errors[0].title).toMatch(/claimed but not settled/);
    expect(errors[0].body).toContain(
      `npo:${npo_id} ref ref-a: stuck-1, stuck-2`
    );
    expect(errors[0].body).toContain(`npo:${npo_id} ref unknown: stuck-3`);
    // a claim that netted has its deductions booked under its ref
    expect(errors[0].body).toContain(
      `unrecover_owed({ npo_id: ${npo_id}, ref: "ref-a" })`
    );
    expect(wise_pay_mock).toHaveBeenCalledWith(
      WISE_RECIPIENT,
      60,
      expect.any(String)
    );
    expect(await payout_types()).toEqual({
      "stuck-1": "processing",
      "stuck-2": "processing",
      "stuck-3": "processing",
      "p-1": "settled",
    });
  });

  test("an unsettled-claims alert that fails to send is reported and the run still pays", async () => {
    const npo_id = await seed_npo({ cash: 500 });
    await seed_claimed(npo_id, "stuck-1", 70, "ref-a");
    await seed_payout(npo_id, "p-1", 60);
    const slack_down = new Error("slack 502");
    send_alert.mockImplementation(async (a) => {
      if (a.type === "ERROR") throw slack_down;
    });

    const res = await index();

    expect(res.statusCode).toBe(200);
    expect(report_error_mock).toHaveBeenCalledWith(slack_down);
    expect(await payout_types()).toMatchObject({ "p-1": "settled" });
  });

  test("a snapshot under the npo's minimum claims nothing", async () => {
    const npo_id = await seed_npo({ cash: 500, payout_minimum: 80 });
    await seed_payout(npo_id, "p-1", 30);
    await seed_payout(npo_id, "p-2", 40);

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(settle_spy).not.toHaveBeenCalled();
    expect(wise_pay_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({
      "p-1": "pending",
      "p-2": "pending",
    });
  });

  test("a pending total of 49.996 meets a 50 minimum and is paid as 50", async () => {
    const npo_id = await seed_npo({ cash: 500, payout_minimum: 50 });
    await seed_payout(npo_id, "p-1", 24.998);
    await seed_payout(npo_id, "p-2", 24.998);

    await index();

    expect(wise_pay_mock).toHaveBeenCalledWith(
      WISE_RECIPIENT,
      50,
      expect.any(String)
    );
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "settled",
    });
  });

  test("a transfer that fails before funding sends no paid notice and leaves the payouts pending", async () => {
    const npo_id = await seed_npo({ cash: 500 });
    await seed_payout(npo_id, "p-1", 60);
    wise_pay_mock.mockRejectedValue(new NotFundedError(new Error("quote 503")));

    await index();

    expect(wise_pay_mock).toHaveBeenCalledOnce();
    expect(send_alert).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await npo_cash(npo_id)).toBe(500);
  });

  test("no transfer when the still-pending total falls under the payout minimum", async () => {
    const npo_id = await seed_npo({ cash: 500, payout_minimum: 50 });
    await seed_payout(npo_id, "p-1", 30);
    await seed_payout(npo_id, "p-2", 40);
    after_snapshot.current = () => mark_refunded("p-2");

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(wise_pay_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({
      "p-1": "pending",
      "p-2": "refunded",
    });
    expect(await db().select().from(settlements)).toEqual([]);
    expect(await npo_cash(npo_id)).toBe(500);
  });

  test("switched on, pays the npo its pending total less what it owes", async () => {
    deductions.on = true;
    const npo_id = await seed_npo({ cash: 500 });
    await seed_payout(npo_id, "p-1", 500);
    await seed_owed(npo_id, "don-owed", 93.2);

    await index();

    expect(wise.quote.mock.calls.map(([, q]) => q.sourceAmount)).toEqual([
      406.8,
    ]);
    expect(wise.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ targetAccount: String(WISE_RECIPIENT) })
    );
    expect(await outstanding()).toEqual([0]);
  });

  test("switched on, an npo under its minimum that owes at least its pending total is settled with no transfer, and ops told", async () => {
    deductions.on = true;
    const npo_id = await seed_npo({ cash: 80, payout_minimum: 100 });
    await seed_payout(npo_id, "p-1", 80);
    await seed_owed(npo_id, "don-owed", 93.2);

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(wise_pay_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "settled" });
    expect(await outstanding()).toEqual([13.2]);
    const [stlmt] = await db().select().from(settlements);
    expect(send_alert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "NOTICE",
        title: expect.stringMatching(/^Grant recovered as owed for npo:/),
        fields: [
          { name: "amount", value: "80" },
          { name: "ref_id", value: stlmt!.id },
        ],
      })
    );
  });

  test("switched on, an npo with no wise recipient that owes at least its pending total is settled with no transfer", async () => {
    deductions.on = true;
    const npo_id = await seed_npo({ cash: 80, recipient: false });
    await seed_payout(npo_id, "p-1", 80);
    await seed_owed(npo_id, "don-owed", 93.2);

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "settled" });
  });

  test("switched on with no terms effective date, a snapshot under the minimum claims nothing, as if switched off", async () => {
    deductions.on = true;
    terms.effective = "soon";
    send_alert.mockResolvedValue(undefined);
    const npo_id = await seed_npo({ cash: 500, payout_minimum: 80 });
    await seed_payout(npo_id, "p-1", 30);
    await seed_owed(npo_id, "don-owed", 50);

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await outstanding()).toEqual([50]);
  });

  test("switched on, an npo with no wise recipient owed a transfer is left pending", async () => {
    deductions.on = true;
    const npo_id = await seed_npo({ cash: 500, recipient: false });
    await seed_payout(npo_id, "p-1", 500);
    await seed_owed(npo_id, "don-owed", 93.2);

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(wise_pay_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await outstanding()).toEqual([93.2]);
  });

  test.each([
    ["off", false],
    ["on", true],
  ])(
    "switched %s, an npo with no bank is held until it adds one, then the next run pays what was held",
    async (_, on) => {
      deductions.on = on;
      const npo_id = await seed_npo({ cash: 100, recipient: false });
      await seed_payout(npo_id, "p-1", 60);
      await seed_payout(npo_id, "p-2", 40);

      await index();

      expect(report_error_mock).not.toHaveBeenCalled();
      expect(wise.transfer).not.toHaveBeenCalled();
      expect(await payout_types()).toEqual({
        "p-1": "pending",
        "p-2": "pending",
      });
      expect(await npo_cash(npo_id)).toBe(100);

      await db()
        .insert(banking_apps)
        .values({ id: String(WISE_RECIPIENT), npo_id, status: "default" });
      await index();

      expect(report_error_mock).not.toHaveBeenCalled();
      expect(wise_pay_mock).toHaveBeenCalledOnce();
      expect(wise_pay_mock).toHaveBeenCalledWith(
        WISE_RECIPIENT,
        100,
        expect.any(String)
      );
      expect(await payout_types()).toEqual({
        "p-1": "settled",
        "p-2": "settled",
      });
      expect(await npo_cash(npo_id)).toBe(0);
    }
  );

  test("an approved bank with no default flag is still paid", async () => {
    const npo_id = await seed_npo({ cash: 100, bank_status: "approved" });
    await seed_payout(npo_id, "p-1", 100);

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(wise_pay_mock).toHaveBeenCalledOnce();
    expect(wise_pay_mock).toHaveBeenCalledWith(
      WISE_RECIPIENT,
      100,
      expect.any(String)
    );
    expect(await payout_types()).toEqual({ "p-1": "settled" });
  });

  test("two approved banks and no default: no bank is guessed, the payout stays pending", async () => {
    const npo_id = await seed_npo({ cash: 100, bank_status: "approved" });
    await seed_payout(npo_id, "p-1", 100);
    await db()
      .insert(banking_apps)
      .values({
        id: String(WISE_RECIPIENT - 1),
        npo_id,
        status: "approved",
        updated_at: "2030-01-01T00:00:00Z",
      });

    await index();

    expect(report_error_mock).not.toHaveBeenCalled();
    expect(wise_pay_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await npo_cash(npo_id)).toBe(100);
  });

  /** a run whose transfer came back: its payout `returned`, its settlement too */
  async function seed_returned(npo_id: number, id: string, amount: number) {
    await db()
      .insert(settlements)
      .values({
        id: `sttl-${id}`,
        other_id: `ref-${id}`,
        npo_id,
        date: "2026-09-02T00:00:00.000Z",
        amount,
        sources: [`dist-${id}`],
        status: "returned",
      });
    await seed_payout(npo_id, id, amount);
    await db()
      .update(payouts)
      .set({
        type: "returned",
        settled_id: `sttl-${id}`,
        settled_date: "2026-09-02T00:00:00.000Z",
      })
      .where(eq(payouts.id, id));
  }

  const old_account = () =>
    db()
      .update(banking_apps)
      .set({ updated_at: "2026-06-01T00:00:00.000Z" })
      .where(eq(banking_apps.id, String(WISE_RECIPIENT)));

  test.each([false, true])(
    "an npo with a returned payout is sent nothing, and ops is told once (netting %s)",
    async (nets) => {
      deductions.on = nets;
      const npo_id = await seed_npo({ cash: 300 });
      await old_account();
      await seed_returned(npo_id, "p-back", 100);
      await seed_payout(npo_id, "p-new", 200);

      await index();
      await index();

      expect(wise_pay_mock).not.toHaveBeenCalled();
      expect(await payout_types()).toEqual({
        "p-back": "returned",
        "p-new": "pending",
      });
      expect(await npo_cash(npo_id)).toBe(300);
      const held = send_alert.mock.calls
        .map(([a]) => a)
        .filter((a) => a.title.startsWith("Grants held"));
      expect(held).toEqual([
        expect.objectContaining({
          type: "ERROR",
          title: `Grants held for npo:${npo_id}: Grants Test NPO`,
          fields: expect.arrayContaining([
            { name: "returned", value: "1 payout(s), 100" },
            { name: "pending", value: "200" },
          ]),
        }),
      ]);
      const [s] = await db().select().from(settlements);
      expect(s?.hold_alerted_at).not.toBeNull();
    }
  );

  test("a hold alert that fails to send is tried again on the next run", async () => {
    const npo_id = await seed_npo({ cash: 300 });
    await old_account();
    await seed_returned(npo_id, "p-back", 100);
    await seed_payout(npo_id, "p-new", 200);
    send_alert.mockRejectedValueOnce(new Error("slack down"));

    await index();
    const [s] = await db().select().from(settlements);
    expect(s?.hold_alerted_at).toBeNull();
    await index();

    expect(
      send_alert.mock.calls.filter(([a]) => a.title.startsWith("Grants held"))
    ).toHaveLength(2);
  });

  test("an npo whose returned payouts were all refunded stays held: its account is still the one that bounced", async () => {
    const npo_id = await seed_npo({ cash: 200 });
    await old_account();
    await seed_returned(npo_id, "p-back", 100);
    await mark_refunded("p-back");
    await seed_payout(npo_id, "p-new", 200);

    await index();

    expect(wise_pay_mock).not.toHaveBeenCalled();
    expect(await payout_types()).toEqual({
      "p-back": "refunded",
      "p-new": "pending",
    });
    const held = send_alert.mock.calls
      .map(([a]) => a)
      .filter((a) => a.title.startsWith("Grants held"));
    expect(held).toEqual([
      expect.objectContaining({
        fields: expect.arrayContaining([
          { name: "returned", value: "none left" },
          { name: "pending", value: "200" },
        ]),
      }),
    ]);
  });

  test("a new account made default releases the hold: the next run pays the returned payouts with the new ones", async () => {
    const { bapp_set_default } = await import("$/pg/queries/banking");
    const { resend_returned } = await import("$/payouts/resend-returned");
    const npo_id = await seed_npo({ cash: 300 });
    await old_account();
    await seed_returned(npo_id, "p-back", 100);
    await seed_payout(npo_id, "p-new", 200);
    await index();
    expect(wise_pay_mock).not.toHaveBeenCalled();

    await db()
      .insert(banking_apps)
      .values({ id: "778", npo_id, status: "approved" });
    await bapp_set_default("778", npo_id);
    await resend_returned(npo_id);
    // the hold is under test, not the wise chain
    wise_pay_mock.mockResolvedValue(TRANSFER_ID);
    await index();

    expect(wise_pay_mock).toHaveBeenCalledOnce();
    expect(wise_pay_mock).toHaveBeenCalledWith(778, 300, expect.any(String));
    expect(await payout_types()).toEqual({
      "p-back": "settled",
      "p-new": "settled",
    });
    expect(await npo_cash(npo_id)).toBe(0);
  });
});
