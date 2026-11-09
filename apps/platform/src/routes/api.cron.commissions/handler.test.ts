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
const send_alert = vi.hoisted(() => vi.fn());
/** `real`: the referrer as stored, looked up as the cron does */
const referrer = vi.hoisted(() => ({
  pay_id: 42 as number | undefined,
  pay_min: 50,
  real: false,
}));
const deductions = vi.hoisted(() => ({ on: false }));

/**
 * wise at its http boundary: `customerTransactionId` is the idempotency key,
 * so a reused ref answers with the original transfer, funded or not
 */
const wise = vi.hoisted(() => {
  const by_ref = new Map<string, { id: number; status: string }>();
  const by_id = new Map<number, { id: number; status: string }>();
  return {
    by_ref,
    by_id,
    v2_account: vi.fn(async () => ({ currency: "USD" })),
    quote: vi.fn(async (_: string, q: { sourceAmount: number }) => ({
      id: `q-${q.sourceAmount}`,
    })),
    transfer: vi.fn(
      async (t: { customerTransactionId: string; targetAccount: string }) => {
        const seen = by_ref.get(t.customerTransactionId);
        if (seen) return { ...seen };
        const created = {
          id: 9000 + by_ref.size,
          status: "incoming_payment_waiting",
        };
        by_ref.set(t.customerTransactionId, created);
        by_id.set(created.id, created);
        return { ...created };
      }
    ),
    fund_transfer: vi.fn(),
  };
});
/** funding as wise does it: the transfer moves on to processing */
const fund_ok = async (id: number) => {
  wise.by_id.get(id)!.status = "processing";
  return { status: "COMPLETED" as const };
};

vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));
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
vi.mock("$/kit/slack", () => ({
  aws_monitor: { send_alert },
  fiat_monitor: { send_alert: vi.fn() },
}));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("./helpers", async (orig) => {
  const real = await orig<typeof import("./helpers")>();
  return {
    get_referrer: async (id: string) =>
      referrer.real
        ? real.get_referrer(id)
        : {
            id,
            name: "Ref",
            email: "ref@example.com",
            pay_id: referrer.pay_id,
            pay_min: referrer.pay_min,
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
const { report_error } = await import("#/errors/report");
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { npos } = await import("$/pg/schema/npo");
const { banking_apps } = await import("$/pg/schema/banking");
const { referrer_commissions, referrer_payouts } = await import(
  "$/pg/schema/referrer"
);
const { donations } = await import("$/pg/schema/donation");
const { dists } = await import("$/pg/schema/dist");
const { owed_amounts, owed_entries, owed_notices } = await import(
  "$/pg/schema/owed"
);
const { bal_txs } = await import("$/pg/schema/bal-tx");
const { user } = await import("$/pg/schema/auth");
const { dists_for_refund } = await import("$/pg/queries/dist");
const { process_refund } = await import("$/refund/process");
const { owed_for_donation } = await import("$/pg/queries/owed");

const db = () => test_db.current!.db;

/** failures injected in the database itself, so they hold wherever the code
 * under test moves its writes: a credit-back is an entry under reason
 * `transfer_unfunded`, and a release moves a claimed commission back to pending */
const fail_credit = () =>
  test_db.current!.client.exec(`
    create or replace function fail_credit() returns trigger as $$
    begin raise exception 'credit failed'; end $$ language plpgsql;
    create trigger fail_credit before insert on owed_entries
      for each row when (new.reason = 'transfer_unfunded')
      execute function fail_credit();`);
const fail_release = () =>
  test_db.current!.client.exec(`
    create or replace function fail_release() returns trigger as $$
    begin raise exception 'release failed'; end $$ language plpgsql;
    create trigger fail_release before update on referrer_commissions
      for each row when (new.status = 'pending' and old.status = 'processing')
      execute function fail_release();`);
const heal_db = async () => {
  const c = test_db.current!.client;
  await c.exec("drop trigger if exists fail_credit on owed_entries");
  await c.exec("drop trigger if exists fail_release on referrer_commissions");
};
const REFERRER = "NPO-REF";
let npo_id: number;
/** the gifts `seed_owed` made rows for, which `owed_rows` reads back */
let seeded_owed: string[] = [];

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  send_alert.mockReset();
  await heal_db();
  seeded_owed = [];
  deductions.on = false;
  terms.effective = "2026-01-01";
  referrer.pay_id = 42;
  referrer.pay_min = 50;
  referrer.real = false;
  wise.by_ref.clear();
  wise.by_id.clear();
  wise.quote.mockClear();
  wise.transfer.mockClear();
  wise.fund_transfer.mockReset().mockImplementation(fund_ok);
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
      registration_number: "EIN-COMMISSION",
      name: "Commission Test NPO",
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

const statuses = async () =>
  Object.fromEntries(
    (
      await db()
        .select({
          id: referrer_commissions.donation_id,
          status: referrer_commissions.status,
        })
        .from(referrer_commissions)
    ).map((r) => [r.id, r.status])
  );

const quoted = () => wise.quote.mock.calls.map(([, q]) => q.sourceAmount);
const refs = () =>
  wise.transfer.mock.calls.map(([t]) => t.customerTransactionId);
const alert_titles = () => send_alert.mock.calls.map(([a]) => a.title);

describe("commissions cron", () => {
  test("pays the pending total in cents, half down, and marks every commission paid", async () => {
    await seed("d-1", 10.005);
    await seed("d-2", 40);

    await index();

    expect(quoted()).toEqual([50]);
    expect(await statuses()).toEqual({ "d-1": "paid", "d-2": "paid" });
    const [payout] = await db().select().from(referrer_payouts);
    expect(payout).toMatchObject({
      id: refs()[0],
      amount: 50,
      transfer_id: 9000,
      error: null,
    });
  });

  test("a retry over a grown set after an unknown funding outcome pays only the new commission", async () => {
    await seed("d-1", 25);
    await seed("d-2", 30);
    wise.fund_transfer.mockRejectedValueOnce("fetch failed");
    await index();
    expect(alert_titles()).toContain(
      `commission funding status unknown for ${REFERRER}`
    );

    await seed("d-3", 60);
    await index();

    expect(quoted()).toEqual([55, 60]);
    expect(await statuses()).toEqual({
      "d-1": "processing",
      "d-2": "processing",
      "d-3": "paid",
    });
    const [first, second] = refs();
    expect(second).not.toBe(first);
    const stuck = send_alert.mock.calls.find(
      ([a]) => a.title === "commissions claimed but not paid"
    );
    expect(stuck?.[0].body).toContain(`${REFERRER} ref ${first}: d-1, d-2`);
  });

  test.each([
    ["off", false],
    ["on", true],
  ])(
    "a retry after a run that died between its claim and its transfer pays nothing again, deductions %s",
    async (_, on) => {
      deductions.on = on;
      await seed("d-1", 25);
      await seed("d-2", 30);
      let reached!: () => void;
      const at_wise = new Promise<void>((r) => {
        reached = r;
      });
      // the first run dies here: claimed, and wise never asked
      wise.v2_account.mockImplementationOnce(() => {
        reached();
        return new Promise(() => {});
      });
      void index();
      await at_wise;

      await index();

      expect(wise.transfer).not.toHaveBeenCalled();
      expect(await statuses()).toEqual({
        "d-1": "processing",
        "d-2": "processing",
      });
      expect(await db().select().from(referrer_payouts)).toEqual([]);
      expect(alert_titles()).toContain("commissions claimed but not paid");
    }
  );

  test.each([
    ["the same", 42],
    ["a changed", 43],
  ])(
    "a set released after an unfunded transfer wise then cancelled is claimed again under a new ref and paid to %s recipient",
    async (_, pay_id) => {
      await seed("d-1", 25);
      await seed("d-2", 30);
      wise.fund_transfer.mockImplementationOnce(async (id: number) => {
        // wise cancels the transfer it was refused funding for
        wise.by_id.get(id)!.status = "cancelled";
        return { status: "REJECTED", errorCode: "balance.insufficient" };
      });
      await index();
      expect(await statuses()).toEqual({ "d-1": "pending", "d-2": "pending" });

      referrer.pay_id = pay_id;
      await index();

      const [first, second] = refs();
      expect(second).not.toBe(first);
      expect(wise.transfer.mock.calls[1]![0].targetAccount).toBe(
        String(pay_id)
      );
      expect(await statuses()).toEqual({ "d-1": "paid", "d-2": "paid" });
      const [payout] = await db()
        .select()
        .from(referrer_payouts)
        .where(eq(referrer_payouts.id, second!));
      expect(payout).toMatchObject({ amount: 55, transfer_id: 9001 });
    }
  );

  /** a gift whose one dist, to the referred npo, carries the commission */
  async function seed_gift(dist_id: string, amount: number) {
    await db().update(npos).set({ liq: 100 }).where(eq(npos.id, npo_id));
    await db()
      .insert(donations)
      .values({
        id: `don-${dist_id}`,
        upusd: 1,
        status: "settled",
        amount_base: 100,
        amount_tip: 0,
        amount_fee_allowance: 0,
        currency: "USD",
        frequency: "one-time",
        source: "bg-marketplace",
        via: "stripe:card",
        created_at: "2026-10-23T16:00:00.000Z",
      });
    await db()
      .insert(dists)
      .values({
        id: dist_id,
        donation_id: `don-${dist_id}`,
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
    await seed(dist_id, amount);
  }

  /** the gift is refunded while the transfer holding its commission is in flight */
  const refund_in_flight = async (dist_id: string) => {
    const don = `don-${dist_id}`;
    await process_refund(don, await dists_for_refund(don), {
      form_id: null,
      program_id: null,
      alert_from: "test",
      source: "refund",
      source_ref: "re_1",
    });
  };

  const owed = () => owed_for_donation("don-d-1");

  test("a commission refunded while its transfer went unfunded is credited back, leaving its referrer owing nothing", async () => {
    await seed_gift("d-1", 25);
    await seed("d-2", 30);
    wise.fund_transfer.mockImplementationOnce(async () => {
      await refund_in_flight("d-1");
      return { status: "REJECTED", errorCode: "balance.insufficient" };
    });

    await index();

    expect(await statuses()).toEqual({
      "d-1": "refunded_loss",
      "d-2": "pending",
    });
    expect(await owed()).toEqual([
      expect.objectContaining({
        donation_id: "don-d-1",
        referrer_npo: REFERRER,
        received_usd: 25,
        credited_back_usd: 25,
        outstanding_usd: 0,
      }),
    ]);
    const [a] = send_alert.mock.calls.find(([a]) =>
      a.title.startsWith("commission refunded in flight, not funded")
    )!;
    expect(a.body).toContain(refs()[0]);
    expect(a.body).not.toContain("loss");
    // the sibling sum keeps counting a credited commission only while it stays refunded_loss
    expect(a.body).not.toMatch(/set each to refunded/);
    expect(a.fields).toContainEqual({ name: "not_released", value: "d-1" });
  });

  const alert_titled = (prefix: string) =>
    send_alert.mock.calls.find(([a]) => a.title.startsWith(prefix))?.[0];

  // released and uncredited would leave nothing processing for the stuck-claim alert to find
  test("a credit that fails rolls the release back with it, leaving the claim processing", async () => {
    await seed_gift("d-1", 25);
    await seed("d-2", 30);
    await fail_credit();
    wise.fund_transfer.mockImplementationOnce(async () => {
      await refund_in_flight("d-1");
      return { status: "REJECTED", errorCode: "balance.insufficient" };
    });

    await index();

    expect(await statuses()).toEqual({
      "d-1": "refunded_loss",
      "d-2": "processing",
    });
    expect(await owed()).toEqual([
      expect.objectContaining({ credited_back_usd: 0, outstanding_usd: 25 }),
    ]);
    const a = alert_titled("commission not funded, release failed");
    expect(a.body).toContain("/platform/owed");
  });

  test("a release that fails still credits what the referrer owes for commissions refunded in flight", async () => {
    await seed_gift("d-1", 25);
    await seed("d-2", 30);
    await fail_release();
    wise.fund_transfer.mockImplementationOnce(async () => {
      await refund_in_flight("d-1");
      return { status: "REJECTED", errorCode: "balance.insufficient" };
    });

    await index();

    expect(await statuses()).toEqual({
      "d-1": "refunded_loss",
      "d-2": "processing",
    });
    expect(await owed()).toEqual([
      expect.objectContaining({ credited_back_usd: 25, outstanding_usd: 0 }),
    ]);
    const a = alert_titled("commission not funded, release failed");
    expect(a.body).toContain("credited back");
  });

  test("a transfer whose funding is unknown lists each commission refunded in flight and its owed row, to credit by hand once unfunded", async () => {
    await seed_gift("d-1", 25);
    await seed("d-2", 30);
    wise.fund_transfer.mockImplementationOnce(async () => {
      await refund_in_flight("d-1");
      throw new Error("timeout");
    });

    await index();

    expect(await owed()).toEqual([
      expect.objectContaining({ credited_back_usd: 0, outstanding_usd: 25 }),
    ]);
    const a = alert_titled("commission funding status unknown");
    expect(a.body).toContain(
      `commission d-1 ($25.00, gift don-d-1, customerTransactionId ${refs()[0]}): referrer ${REFERRER}'s row on the gift has $25.00 outstanding`
    );
    expect(a.body).toContain("/platform/owed");
  });

  test("a stuck claim's alert lists the commissions refunded under its ref and their owed rows", async () => {
    await seed_gift("d-1", 25);
    await seed("d-2", 30);
    wise.fund_transfer.mockImplementationOnce(async () => {
      await refund_in_flight("d-1");
      throw new Error("timeout");
    });
    await index();
    send_alert.mockReset();

    await index();

    const a = alert_titled("commissions claimed but not paid");
    expect(a.body).toContain(`d-2`);
    expect(a.body).toContain(
      `commission d-1 ($25.00, gift don-d-1, customerTransactionId ${refs()[0]}): referrer ${REFERRER}'s row on the gift has $25.00 outstanding`
    );
    expect(a.body).toContain("/platform/owed");
  });

  test("a commission refunded while its transfer was in flight, which then paid, stays owed by its referrer", async () => {
    await seed_gift("d-1", 25);
    await seed("d-2", 30);
    wise.fund_transfer.mockImplementationOnce(async (...args) => {
      await refund_in_flight("d-1");
      return fund_ok(...(args as [number]));
    });

    await index();

    expect(await statuses()).toEqual({ "d-1": "refunded_loss", "d-2": "paid" });
    expect(await owed()).toEqual([
      expect.objectContaining({
        referrer_npo: REFERRER,
        received_usd: 25,
        credited_back_usd: 0,
        outstanding_usd: 25,
      }),
    ]);
    const [a] = send_alert.mock.calls.find(([a]) =>
      a.title.startsWith("commission paid but refunded in flight")
    )!;
    expect(a.body).toContain("recorded as owed by the referrer");
    expect(a.body).not.toContain("loss");
  });

  test.each([
    [24.998, 50, "paid"],
    [24.997, undefined, "pending"],
  ])(
    "two commissions of %s are judged against a 50 minimum as the cents they pay",
    async (amount, paid, status) => {
      await seed("d-1", amount);
      await seed("d-2", amount);

      await index();

      expect(quoted()).toEqual(paid === undefined ? [] : [paid]);
      expect(await statuses()).toEqual({ "d-1": status, "d-2": status });
    }
  );

  /** a gift refunded after its commission was paid, so the referrer owes `usd` on it */
  async function seed_owed(
    donation_id: string,
    usd: number,
    party:
      | { referrer_npo: string }
      | { referrer_user: string }
      | {
          npo_id: number;
        } = { referrer_npo: REFERRER },
    created_at = "2026-08-01T00:00:00.000Z"
  ) {
    seeded_owed.push(donation_id);
    await db().insert(donations).values({
      id: donation_id,
      created_at,
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
        ...party,
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

  const owed_rows = async () =>
    (await Promise.all(seeded_owed.map((id) => owed_for_donation(id))))
      .flat()
      .map((r) => ({
        donation_id: r.donation_id,
        recovered_usd: r.recovered_usd,
        outstanding_usd: r.outstanding_usd,
      }))
      .sort((a, b) => a.donation_id.localeCompare(b.donation_id));

  describe("netting what the referrer owes", () => {
    test("switched off, a referrer owing $9 is paid all $200 of its commissions and owes the $9 still", async () => {
      await seed("d-1", 120);
      await seed("d-2", 80);
      await seed_owed("don-owed", 9);

      await index();

      expect(quoted()).toEqual([200]);
      expect(await statuses()).toEqual({ "d-1": "paid", "d-2": "paid" });
      const [payout] = await db().select().from(referrer_payouts);
      expect(payout).toMatchObject({ id: refs()[0], amount: 200 });
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 0, outstanding_usd: 9 },
      ]);
      expect(await db().select().from(owed_entries)).toEqual([]);
    });

    test("switched on, a referrer owing $9 is paid $191, and the row shows $9 recovered under the transfer's ref", async () => {
      deductions.on = true;
      await seed("d-1", 120);
      await seed("d-2", 80);
      await seed_owed("don-owed", 9);

      await index();

      expect(quoted()).toEqual([191]);
      // commission rows keep what each earned
      const amounts = await db()
        .select({
          amount: referrer_commissions.amount,
          status: referrer_commissions.status,
        })
        .from(referrer_commissions);
      expect(amounts).toEqual(
        expect.arrayContaining([
          { amount: 120, status: "paid" },
          { amount: 80, status: "paid" },
        ])
      );
      const [payout] = await db().select().from(referrer_payouts);
      expect(payout).toMatchObject({ id: refs()[0], amount: 191 });
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 9, outstanding_usd: 0 },
      ]);
      expect(
        await db()
          .select({
            kind: owed_entries.kind,
            usd: owed_entries.usd,
            reason: owed_entries.reason,
            ref: owed_entries.ref,
          })
          .from(owed_entries)
      ).toEqual([
        { kind: "recover", usd: 9, reason: "commission_run", ref: refs()[0] },
      ]);
    });

    test("switched on, owing at least the commissions sends no transfer: they are paid as recovered", async () => {
      deductions.on = true;
      await seed("d-1", 20);
      await seed("d-2", 10);
      await seed_owed("don-owed", 40);

      await index();

      expect(wise.transfer).not.toHaveBeenCalled();
      expect(await statuses()).toEqual({ "d-1": "paid", "d-2": "paid" });
      const [{ ref } = { ref: null }] = await db()
        .selectDistinct({ ref: referrer_commissions.ref })
        .from(referrer_commissions);
      expect(await db().select().from(referrer_payouts)).toEqual([
        expect.objectContaining({
          id: ref,
          referrer_npo: REFERRER,
          amount: 0,
          transfer_id: null,
          error: null,
        }),
      ]);
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 30, outstanding_usd: 10 },
      ]);
      expect(alert_titles()).toContain(
        `Commission recovered as owed for ${REFERRER}`
      );
    });

    test("switched on, what a paid-as-recovered run left owing is carried by the next run", async () => {
      deductions.on = true;
      await seed("d-1", 20);
      await seed("d-2", 10);
      await seed_owed("don-owed", 40);
      await index();

      await seed("d-3", 70);
      await index();

      expect(quoted()).toEqual([60]);
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 40, outstanding_usd: 0 },
      ]);
    });

    const entries = () =>
      db()
        .select({
          kind: owed_entries.kind,
          usd: owed_entries.usd,
          ref: owed_entries.ref,
        })
        .from(owed_entries);

    test("a retry after an unknown funding outcome never recovers the row twice, and the stuck claim says how to undo its recovery", async () => {
      deductions.on = true;
      await seed("d-1", 120);
      await seed("d-2", 80);
      await seed_owed("don-owed", 9);
      wise.fund_transfer.mockRejectedValueOnce("fetch failed");
      await index();

      await seed("d-3", 60);
      await index();

      expect(quoted()).toEqual([191, 60]);
      const [first] = refs();
      expect(await entries()).toEqual([
        { kind: "recover", usd: 9, ref: first },
      ]);
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 9, outstanding_usd: 0 },
      ]);
      const stuck = alert_titled("commissions claimed but not paid");
      expect(stuck.body).toContain(
        `unrecover_owed({ referrer_npo: "${REFERRER}", ref: "${first}" })`
      );
    });

    test("switched on, a net under the minimum claims and recovers nothing", async () => {
      deductions.on = true;
      await seed("d-1", 55);
      await seed_owed("don-owed", 9);

      await index();

      expect(wise.transfer).not.toHaveBeenCalled();
      expect(await statuses()).toEqual({ "d-1": "pending" });
      expect(await entries()).toEqual([]);
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 0, outstanding_usd: 9 },
      ]);
    });

    const rejected = async () => ({
      status: "REJECTED" as const,
      errorCode: "balance.insufficient",
    });

    test("an unfunded transfer takes its recovery back, so the next claim recovers the row once", async () => {
      deductions.on = true;
      await seed("d-1", 120);
      await seed("d-2", 80);
      await seed_owed("don-owed", 9);
      wise.fund_transfer.mockImplementationOnce(rejected);
      await index();

      expect(await statuses()).toEqual({ "d-1": "pending", "d-2": "pending" });
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 0, outstanding_usd: 9 },
      ]);

      await index();

      expect(quoted()).toEqual([191, 191]);
      expect(await statuses()).toEqual({ "d-1": "paid", "d-2": "paid" });
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 9, outstanding_usd: 0 },
      ]);
    });

    test("an unfunded release that fails keeps the claim and its recovery whole, and says to take the recovery back with any reset", async () => {
      deductions.on = true;
      await seed("d-1", 120);
      await seed("d-2", 80);
      await seed_owed("don-owed", 9);
      await fail_release();
      wise.fund_transfer.mockImplementationOnce(rejected);

      await index();

      expect(await statuses()).toEqual({
        "d-1": "processing",
        "d-2": "processing",
      });
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 9, outstanding_usd: 0 },
      ]);
      const a = alert_titled("commission not funded, release failed");
      expect(a.body).toContain(
        `only with this run's deductions taken back: run unrecover_owed({ referrer_npo: "${REFERRER}", ref: "${refs()[0]}" })`
      );
      expect(a.body).toContain("the release failed (");
    });

    test("switched on, a transfer whose funding is unknown says a reset needs the run's recovery taken back", async () => {
      deductions.on = true;
      await seed("d-1", 120);
      await seed("d-2", 80);
      await seed_owed("don-owed", 9);
      wise.fund_transfer.mockRejectedValueOnce("fetch failed");

      await index();

      const a = alert_titled("commission funding status unknown");
      expect(a.body).toContain(
        `any reset to pending needs run unrecover_owed({ referrer_npo: "${REFERRER}", ref: "${refs()[0]}" })`
      );
    });

    const USER_REF = "U-REF";
    const seed_user_referrer = (pay_id: string | null = null) =>
      db()
        .insert(user)
        .values({
          id: "u-ref",
          name: "Ref",
          email: "ref@test.com",
          first_name: "R",
          last_name: "F",
          referral_code: USER_REF,
          pay_id,
        })
        .onConflictDoNothing();
    const seed_user_commission = (donation_id: string, amount: number) =>
      db().insert(referrer_commissions).values({
        referrer_user: USER_REF,
        date: "2026-09-01T00:00:00.000Z",
        donation_id,
        npo_id,
        amount,
        status: "pending",
      });
    const payouts = async () =>
      db()
        .select({
          referrer_user: referrer_payouts.referrer_user,
          referrer_npo: referrer_payouts.referrer_npo,
          amount: referrer_payouts.amount,
        })
        .from(referrer_payouts);

    test("a user referrer's rows are netted against its own commissions, never an npo referrer's", async () => {
      deductions.on = true;
      await seed_user_referrer("42");
      await seed("d-npo", 200);
      await seed_user_commission("d-user", 100);
      await seed_owed("don-user-owes", 5, { referrer_user: USER_REF });

      await index();

      expect(await payouts()).toEqual(
        expect.arrayContaining([
          { referrer_user: null, referrer_npo: REFERRER, amount: 200 },
          { referrer_user: USER_REF, referrer_npo: null, amount: 95 },
        ])
      );
      expect(await owed_rows()).toEqual([
        { donation_id: "don-user-owes", recovered_usd: 5, outstanding_usd: 0 },
      ]);
    });

    test("an npo referrer is not netted against what the npo owes as a grantee", async () => {
      deductions.on = true;
      await seed("d-npo", 200);
      await seed_owed("don-grantee-owes", 9, { npo_id });

      await index();

      expect(await payouts()).toEqual([
        { referrer_user: null, referrer_npo: REFERRER, amount: 200 },
      ]);
      expect(await owed_rows()).toEqual([
        {
          donation_id: "don-grantee-owes",
          recovered_usd: 0,
          outstanding_usd: 9,
        },
      ]);
    });

    test("switched on, a user referrer with no payout method whose owed covers its commissions is paid them as recovered", async () => {
      deductions.on = true;
      referrer.real = true;
      await seed_user_referrer();
      await seed_user_commission("d-1", 20);
      await seed_owed("don-owed", 40, { referrer_user: USER_REF });

      await index();

      expect(wise.transfer).not.toHaveBeenCalled();
      expect(await statuses()).toEqual({ "d-1": "paid" });
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 20, outstanding_usd: 20 },
      ]);
    });

    test("switched on with no terms effective date, a referrer with no payout method is never claimed, as if switched off", async () => {
      deductions.on = true;
      terms.effective = "soon";
      send_alert.mockResolvedValue(undefined);
      referrer.pay_id = undefined;
      await seed("d-1", 20);
      await seed_owed("don-owed", 40);

      await index();

      expect(await statuses()).toEqual({ "d-1": "pending" });
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 0, outstanding_usd: 40 },
      ]);
    });

    test("switched on, a referrer with no payout method owed a transfer is left pending, nothing recovered", async () => {
      deductions.on = true;
      referrer.pay_id = undefined;
      await seed("d-1", 120);
      await seed_owed("don-owed", 9);

      await index();

      expect(wise.transfer).not.toHaveBeenCalled();
      expect(await statuses()).toEqual({ "d-1": "pending" });
      expect(await entries()).toEqual([]);
      expect(await db().select().from(referrer_payouts)).toEqual([]);
    });

    // a stripe-only npo has no default bank: its commissions wait for one
    test("switched off, an npo referrer with no default bank is left pending, no transfer", async () => {
      referrer.real = true;
      vi.mocked(report_error).mockClear();
      await seed("d-1", 120);

      await index();

      // a lookup that threw would also leave it pending
      expect(report_error).not.toHaveBeenCalled();
      expect(wise.transfer).not.toHaveBeenCalled();
      expect(await statuses()).toEqual({ "d-1": "pending" });
      expect(await db().select().from(referrer_payouts)).toEqual([]);
    });

    test("switched off, the same npo referrer is paid to its default bank once it has one", async () => {
      referrer.real = true;
      await db().insert(banking_apps).values({
        id: "777",
        npo_id,
        status: "default",
        bank_summary: "USD account ending in 0777",
      });
      await seed("d-1", 120);

      await index();

      expect(wise.transfer).toHaveBeenCalledOnce();
      expect(wise.transfer.mock.calls[0]![0].targetAccount).toBe("777");
      expect(await statuses()).toEqual({ "d-1": "paid" });
    });

    test("switched off, an npo referrer whose bank was approved with no default flag is still paid", async () => {
      referrer.real = true;
      await db().insert(banking_apps).values({
        id: "778",
        npo_id,
        status: "approved",
        bank_summary: "USD account ending in 0778",
      });
      await seed("d-1", 120);

      await index();

      expect(wise.transfer).toHaveBeenCalledOnce();
      expect(wise.transfer.mock.calls[0]![0].targetAccount).toBe("778");
      expect(await statuses()).toEqual({ "d-1": "paid" });
    });

    test("switched off, an npo referrer with two approved banks and no default is paid to the most recently updated", async () => {
      referrer.real = true;
      await db()
        .insert(banking_apps)
        .values([
          {
            id: "778",
            npo_id,
            status: "approved",
            bank_summary: "USD account ending in 0778",
            updated_at: "2029-01-01T00:00:00Z",
          },
          {
            id: "779",
            npo_id,
            status: "approved",
            bank_summary: "USD account ending in 0779",
            updated_at: "2030-01-01T00:00:00Z",
          },
        ]);
      await seed("d-1", 120);

      await index();

      expect(wise.transfer).toHaveBeenCalledOnce();
      expect(wise.transfer.mock.calls[0]![0].targetAccount).toBe("779");
      expect(await statuses()).toEqual({ "d-1": "paid" });
    });

    test("switched on, an npo referrer with no default bank whose owed covers its commissions is paid them as recovered", async () => {
      deductions.on = true;
      referrer.real = true;
      await seed("d-1", 20);
      await seed_owed("don-owed", 40);

      await index();

      expect(wise.transfer).not.toHaveBeenCalled();
      expect(await statuses()).toEqual({ "d-1": "paid" });
      expect(await owed_rows()).toEqual([
        { donation_id: "don-owed", recovered_usd: 20, outstanding_usd: 20 },
      ]);
    });
  });
});
