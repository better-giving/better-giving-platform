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
const deductions = vi.hoisted(() => ({ on: false }));
const verify_qstash = vi.hoisted(() => vi.fn());
const transfer_get = vi.hoisted(() =>
  vi.fn(
    async (id: number): Promise<{ id: number; status?: string }> => ({
      id,
      status: "funds_refunded",
    })
  )
);

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
vi.mock("../kit/queue", () => ({ verify_qstash }));
vi.mock("../kit/wise", () => ({ wise: { transfer_get } }));
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

const { poll_wise_returns, return_settlement } = await import("./wise-return");
const { action: cron_action } = await import(
  "#/routes/api.cron.wise-returns/route"
);
const { settle_npo_payouts } = await import("./settle");
const { dists_for_refund } = await import("../pg/queries/dist");
const { process_refund } = await import("../refund/process");
const { owed_for_donation } = await import("../pg/queries/owed");
const { dists } = await import("../pg/schema/dist");
const { bal_txs } = await import("../pg/schema/bal-tx");
const { donations } = await import("../pg/schema/donation");
const { loss_logs, rev_logs } = await import("../pg/schema/revenue");
const { owed_amounts, owed_entries, owed_notices } = await import(
  "../pg/schema/owed"
);
const { create_test_db } = await import("../pg/test-utils/pglite");
const { banking_apps } = await import("../pg/schema/banking");
const { npos } = await import("../pg/schema/npo");
const { payouts, settlements } = await import("../pg/schema/payout");

const db = () => test_db.current!.db;

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
  deductions.on = false;
  await db().delete(bal_txs);
  await db().delete(loss_logs);
  await db().delete(owed_amounts);
  await db().delete(rev_logs);
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(settlements);
  await db().delete(banking_apps);
  await db().delete(npos);
});

async function seed_npo(cash: number) {
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-RETURN",
      name: "Return Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash,
    })
    .returning();
  return { id: npo!.id, name: npo!.name, payout_minimum: 50 };
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
  amount: number
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
  await db()
    .insert(dists)
    .values({
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
      alloc: { liq: 0, lock: 0, cash: 100 },
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
  await seed_payout(npo_id, id, amount);
  return { don };
}

/** a gift refunded after its grant went out, the npo owing `usd` on it */
async function seed_owed(npo_id: number, donation_id: string, usd: number) {
  await db().insert(donations).values({
    id: donation_id,
    created_at: "2026-08-01T00:00:00.000Z",
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
  await db().insert(owed_notices).values({
    owed_id: owed!.id,
    kind: "recorded",
    created_at: "2026-09-15T00:00:00.000Z",
    sent_at: "2026-09-15T00:00:00.000Z",
  });
}

/** the donor's refund, as it lands on a payout in flight or already settled */
const refund = async (donation_id: string) =>
  process_refund(donation_id, await dists_for_refund(donation_id), {
    form_id: null,
    program_id: null,
    alert_from: "test",
    source: "refund",
    source_ref: "re_1",
  });

let next_transfer = 9000;

/** a grants run that sends the npo's pending `ids` through wise and settles;
 * `in_flight` runs while the transfer is out */
async function sent(
  npo: Awaited<ReturnType<typeof seed_npo>>,
  ids: string[],
  in_flight?: () => Promise<unknown>
) {
  const transfer_id = ++next_transfer;
  const pay = vi.fn<Pay>(async () => {
    await in_flight?.();
    return transfer_id;
  });
  const res = await settle_npo_payouts(npo, ids, { ref_key: RECIPIENT, pay });
  expect(res.status).toBe("settled");
  return String(transfer_id);
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

const status_of = async (id: string) =>
  (
    await db()
      .select({ status: settlements.status })
      .from(settlements)
      .where(eq(settlements.id, id))
  )[0]?.status;

const entries = async () =>
  (await db().select().from(owed_entries))
    .map((e) => ({ kind: e.kind, reason: e.reason, ref: e.ref, usd: e.usd }))
    .sort((a, b) => a.ref.localeCompare(b.ref) || a.kind.localeCompare(b.kind));

describe("return_settlement", () => {
  test("a plain run's payouts go returned, the npo's cash is credited the run's gross, and ops is told once", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const transfer = await sent(npo, ["p-1", "p-2"]);
    expect(await npo_cash(npo.id)).toBe(400);

    const res = await return_settlement(transfer);

    expect(res).toMatchObject({ status: "returned", credited: 100 });
    expect(await payout_types()).toEqual({
      "p-1": "returned",
      "p-2": "returned",
    });
    expect(await npo_cash(npo.id)).toBe(500);
    expect(await status_of(transfer)).toBe("returned");
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe(`Wise transfer returned for npo:${npo.id}`);
    expect(alert.fields).toEqual(
      expect.arrayContaining([
        { name: "npo", value: `${npo.id}: ${npo.name}` },
        { name: "settlement", value: transfer },
        { name: "amount", value: "100" },
        { name: "payout_ids", value: "p-1, p-2" },
      ])
    );
  });

  test("a run that withheld what the npo owed credits the gross, not the net it sent, and the npo owes it again", async () => {
    deductions.on = true;
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    const transfer = await sent(npo, ["p-1"]);
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt?.amount).toBe(406.8);
    expect(await npo_cash(npo.id)).toBe(0);
    const ref = stlmt!.other_id!;

    const res = await return_settlement(transfer);

    expect(res).toMatchObject({ status: "returned", credited: 500 });
    expect(await npo_cash(npo.id)).toBe(500);
    const [row] = await owed_for_donation("don-owed", db() as never);
    expect(row?.outstanding_usd).toBe(93.2);
    expect(await entries()).toEqual([
      { kind: "recover", reason: "grant_run", ref, usd: 93.2 },
      {
        kind: "repay",
        reason: "transfer_unfunded",
        ref: `unfunded:${ref}`,
        usd: 93.2,
      },
    ]);
  });

  test("a run that paid the npo a due-back credits the gross, and the due-back is owed to it again", async () => {
    deductions.on = true;
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    // an earlier run recovered it all, then $50 of it was credited back
    await db().update(owed_amounts).set({
      recovered_usd: 93.2,
      recovered_at: "2026-09-20T00:00:00.000Z",
      credited_back_usd: 50,
      credited_back_at: "2026-09-25T00:00:00.000Z",
    });
    const transfer = await sent(npo, ["p-1"]);
    const [stlmt] = await db().select().from(settlements);
    expect(stlmt?.amount).toBe(550);

    const res = await return_settlement(transfer);

    expect(res).toMatchObject({ status: "returned", credited: 500 });
    expect(await npo_cash(npo.id)).toBe(500);
    const [row] = await owed_for_donation("don-owed", db() as never);
    expect(row?.outstanding_usd).toBe(-50);
  });

  test("a payout loss-refunded while its transfer was in flight is refunded as if pending once the money is back", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 60);
    const { don } = await seed_donation_payout(npo.id, "p-2", 40);
    const transfer = await sent(npo, ["p-1", "p-2"], () => refund(don));
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "refunded_loss",
    });
    expect(await npo_cash(npo.id)).toBe(400);

    const res = await return_settlement(transfer);

    expect(res).toMatchObject({
      status: "returned",
      credited: 100,
      returned: ["p-1"],
      loss_reversed: ["p-2"],
    });
    expect(await payout_types()).toEqual({
      "p-1": "returned",
      "p-2": "refunded",
    });
    // the run's 100 back, less the refunded gift's 40 its refund now takes
    expect(await npo_cash(npo.id)).toBe(460);
    const [row] = await owed_for_donation(don, db() as never);
    expect([row?.credited_back_usd, row?.outstanding_usd]).toEqual([40, 0]);
    const [d] = await db().select().from(dists);
    expect([d?.status, d?.refund_status]).toEqual(["refunded", "completed"]);
    const [dn] = await db()
      .select()
      .from(donations)
      .where(eq(donations.id, don));
    expect(dn?.status).toBe("refunded");
    expect(await db().select().from(loss_logs)).toEqual([]);
    expect(send_alert).toHaveBeenCalledOnce();
    expect(send_alert.mock.calls[0]![0].fields).toContainEqual({
      name: "loss_refund_reversed",
      value: "p-2",
    });
  });

  test("a payout loss-refunded after it settled is refunded as if pending once the money is back", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 60);
    const { don } = await seed_donation_payout(npo.id, "p-2", 40);
    const transfer = await sent(npo, ["p-1", "p-2"]);
    await refund(don);
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "refunded_loss",
    });
    const [settled_loss] = await db()
      .select({ settled_id: payouts.settled_id })
      .from(payouts)
      .where(eq(payouts.id, "p-2"));
    expect(settled_loss?.settled_id).toBe(transfer);
    expect(await npo_cash(npo.id)).toBe(400);

    const res = await return_settlement(transfer);

    expect(res).toMatchObject({
      status: "returned",
      credited: 100,
      loss_reversed: ["p-2"],
    });
    expect(await payout_types()).toEqual({
      "p-1": "returned",
      "p-2": "refunded",
    });
    expect(await npo_cash(npo.id)).toBe(460);
    const [row] = await owed_for_donation(don, db() as never);
    expect(row?.outstanding_usd).toBe(0);
    const [d] = await db().select().from(dists);
    expect(d?.refund_status).toBe("completed");
  });

  test("a loss refund from before the owed ledger is kept, credited, and named to ops without stopping the return", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 60);
    const { don } = await seed_donation_payout(npo.id, "p-2", 40);
    const transfer = await sent(npo, ["p-1", "p-2"], async () => {
      await refund(don);
      // a refund recorded before the ledger wrote a loss log and no owed row
      await db().delete(owed_amounts);
    });

    const res = await return_settlement(transfer);

    expect(res).toMatchObject({ status: "returned", credited: 100 });
    expect(await payout_types()).toEqual({
      "p-1": "returned",
      "p-2": "refunded_loss",
    });
    expect(await npo_cash(npo.id)).toBe(500);
    expect(await status_of(transfer)).toBe("returned");
    expect(send_alert).toHaveBeenCalledTimes(2);
    const [kept] = send_alert.mock.calls[1]!;
    expect(kept.body).toMatch(/debit the cash or reverse the loss log/);
    expect(kept.fields).toContainEqual({
      name: "not_reversed",
      value: expect.stringMatching(/^p-2: .*has no amount owed/),
    });
  });

  test("a second detection of the same return changes nothing and tells no one", async () => {
    deductions.on = true;
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 500);
    await seed_owed(npo.id, "don-owed", 93.2);
    const transfer = await sent(npo, ["p-1"]);
    await return_settlement(transfer);
    const before = {
      cash: await npo_cash(npo.id),
      types: await payout_types(),
      entries: await entries(),
    };
    send_alert.mockReset();

    const res = await return_settlement(transfer);

    expect(res).toEqual({ status: "already_returned" });
    expect({
      cash: await npo_cash(npo.id),
      types: await payout_types(),
      entries: await entries(),
    }).toEqual(before);
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("a settled payout of the run that already moved on another way is neither moved nor credited, and is named", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 60);
    await seed_payout(npo.id, "p-2", 40);
    const transfer = await sent(npo, ["p-1", "p-2"]);
    await db()
      .update(payouts)
      .set({ type: "void" })
      .where(eq(payouts.id, "p-2"));

    const res = await return_settlement(transfer);

    expect(res).toMatchObject({
      status: "returned",
      credited: 60,
      returned: ["p-1"],
      moved_on: ["p-2"],
    });
    expect(await payout_types()).toEqual({ "p-1": "returned", "p-2": "void" });
    expect(await npo_cash(npo.id)).toBe(460);
    expect(send_alert.mock.calls[0]![0].fields).toContainEqual({
      name: "moved_on_not_credited",
      value: "p-2",
    });
  });

  test("a run with no payout left to take back is marked returned, credits nothing, and asks for a check by hand", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await sent(npo, ["p-1"]);
    await db()
      .update(payouts)
      .set({ type: "pending" })
      .where(eq(payouts.id, "p-1"));

    const res = await return_settlement(transfer);

    expect(res).toEqual({ status: "nothing_to_return" });
    expect(await npo_cash(npo.id)).toBe(400);
    expect(await status_of(transfer)).toBe("returned");
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe(
      `Wise transfer returned, nothing to return: npo:${npo.id}`
    );
    expect(alert.body).toMatch(/check by hand/);
  });

  test.each([
    ["the run first", ["run", "hand"]],
    ["the hand-sent copy first", ["hand", "run"]],
  ] as const)(
    "a run sent twice, the second by hand, both returned (%s): the npo is credited once",
    async (_, order) => {
      const npo = await seed_npo(500);
      await seed_payout(npo.id, "p-1", 100);
      const run = await sent(npo, ["p-1"]);
      const [first] = await db().select().from(settlements);
      // the hand-made row: its own transfer, the same sources
      await db()
        .insert(settlements)
        .values({
          ...first!,
          id: "hand-sent-1",
          other_id: "hand-ref",
          date: "2026-10-01T00:00:00.000Z",
        });
      const id = { run, hand: "hand-sent-1" };

      const statuses: Record<string, string> = {};
      for (const which of order) {
        statuses[which] = (await return_settlement(id[which])).status;
      }

      expect(await npo_cash(npo.id)).toBe(500);
      expect(await payout_types()).toEqual({ "p-1": "returned" });
      expect(await status_of(run)).toBe("returned");
      expect(await status_of("hand-sent-1")).toBe("returned");
      expect(statuses).toEqual({ run: "returned", hand: "nothing_to_return" });
    }
  );

  test("a hand-sent copy of a run with a payout loss-refunded in flight owns none of it: only the run reverses the loss", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 60);
    const { don } = await seed_donation_payout(npo.id, "p-2", 40);
    const run = await sent(npo, ["p-1", "p-2"], () => refund(don));
    const [first] = await db().select().from(settlements);
    await db()
      .insert(settlements)
      .values({ ...first!, id: "hand-sent-1", other_id: "hand-ref" });

    expect(await return_settlement("hand-sent-1")).toEqual({
      status: "nothing_to_return",
    });
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "refunded_loss",
    });
    expect(await npo_cash(npo.id)).toBe(400);

    await return_settlement(run);

    expect(await payout_types()).toEqual({
      "p-1": "returned",
      "p-2": "refunded",
    });
    expect(await npo_cash(npo.id)).toBe(460);
  });

  test("a run whose payouts don't add up to what the ledger says it sent changes nothing and tells ops both figures", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await sent(npo, ["p-1"]);
    await db()
      .update(settlements)
      .set({ amount: 90 })
      .where(eq(settlements.id, transfer));

    const res = await return_settlement(transfer);

    expect(res).toEqual({
      status: "gross_mismatch",
      recomputed: 100,
      ledger: 90,
    });
    expect(await npo_cash(npo.id)).toBe(400);
    expect(await payout_types()).toEqual({ "p-1": "settled" });
    expect(await status_of(transfer)).toBe("");
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.fields).toEqual(
      expect.arrayContaining([
        { name: "recomputed", value: "100" },
        { name: "ledger", value: "90" },
      ])
    );
  });
});

describe("poll_wise_returns", () => {
  const NOW = "2026-11-12T12:00:00.000Z";
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse(NOW) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function seed_settlement(
    npo_id: number,
    id: string,
    o: Partial<typeof settlements.$inferInsert> = {}
  ) {
    await db()
      .insert(settlements)
      .values({
        id,
        other_id: `ref-${id}`,
        npo_id,
        date: "2026-11-01T00:00:00.000Z",
        amount: 100,
        sources: [],
        status: "",
        ...o,
      });
  }

  test("asks wise only of real transfers from the last 90 days whose stored state is not final", async () => {
    const npo = await seed_npo(0);
    await seed_settlement(npo.id, "1001");
    await seed_settlement(npo.id, "1002", { status: "outgoing_payment_sent" });
    await seed_settlement(npo.id, "1003", { status: "returned" });
    await seed_settlement(npo.id, "1004", { status: "charged_back" });
    // funded, so on wise's way to `funds_refunded`
    await seed_settlement(npo.id, "1005", { status: "cancelled" });
    await seed_settlement(npo.id, "1006", { date: "2026-08-13T00:00:00.000Z" });
    await seed_settlement(npo.id, "1007", { date: "2026-08-14T12:00:00.000Z" });
    // one per guard on a row with no transfer behind it: no ref, nothing sent
    await seed_settlement(npo.id, "1008", { other_id: null });
    await seed_settlement(npo.id, "1009", { amount: 0 });
    const lookup = vi.fn(async (_: number) => "outgoing_payment_sent");

    await poll_wise_returns(lookup);

    expect(lookup.mock.calls.map(([id]) => id).sort()).toEqual([
      1001, 1002, 1005, 1007,
    ]);
  });

  test("a transfer seen cancelled is polled on, and its money coming back takes the run back", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await sent(npo, ["p-1"]);

    await poll_wise_returns(async () => "cancelled");
    expect(await status_of(transfer)).toBe("cancelled");
    await poll_wise_returns(async () => "funds_refunded");

    expect(await status_of(transfer)).toBe("returned");
    expect(await payout_types()).toEqual({ "p-1": "returned" });
    expect(await npo_cash(npo.id)).toBe(500);
    expect(send_alert.mock.calls.map(([a]) => a.title)).toEqual([
      `Wise transfer cancelled: npo:${npo.id}`,
      `Wise transfer returned for npo:${npo.id}`,
    ]);
  });

  /** the npo's account the grants run pays, approved or made default at `at` */
  const seed_default_bank = (npo_id: number, at: string) =>
    db().insert(banking_apps).values({
      id: "bank-1",
      npo_id,
      status: "default",
      date_created: at,
      updated_at: at,
    });

  test("a return found after the npo's account changed re-sends its payouts, and tells ops", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await sent(npo, ["p-1"]);
    await seed_default_bank(npo.id, "2026-11-12T13:00:00.000Z");

    await poll_wise_returns(async () => "funds_refunded");

    expect(await status_of(transfer)).toBe("returned");
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await npo_cash(npo.id)).toBe(500);
    const notice = send_alert.mock.calls
      .map(([a]) => a)
      .find((a) => a.title === `Returned payouts re-sent for npo:${npo.id}`);
    expect(notice).toMatchObject({
      type: "NOTICE",
      fields: [{ name: "payout_ids", value: "p-1" }],
    });
  });

  test("a return found while the npo still pays the account it was sent to keeps its payouts returned", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    await seed_default_bank(npo.id, "2026-11-01T00:00:00.000Z");
    await sent(npo, ["p-1"]);

    await poll_wise_returns(async () => "funds_refunded");

    expect(await payout_types()).toEqual({ "p-1": "returned" });
    expect(send_alert).toHaveBeenCalledOnce();
  });

  test("stores each observed state that changed, and tells no one of an ordinary one", async () => {
    const npo = await seed_npo(0);
    await seed_settlement(npo.id, "1001");
    await seed_settlement(npo.id, "1002", { status: "processing" });

    await poll_wise_returns(async () => "outgoing_payment_sent");

    expect(await status_of("1001")).toBe("outgoing_payment_sent");
    expect(await status_of("1002")).toBe("outgoing_payment_sent");
    expect(send_alert).not.toHaveBeenCalled();
  });

  test.each([
    "charged_back",
    "cancelled",
    "unknown",
    "bounced_back",
    "some_new_state",
  ])(
    "a transfer now %s is stored and alerted once, and changes nothing else",
    async (state) => {
      const npo = await seed_npo(0);
      await seed_payout(npo.id, "p-1", 100);
      await seed_settlement(npo.id, "1001", {
        status: "outgoing_payment_sent",
      });
      await db()
        .update(payouts)
        .set({ type: "settled", settled_id: "1001", settled_date: NOW })
        .where(eq(payouts.id, "p-1"));

      await poll_wise_returns(async () => state);
      await poll_wise_returns(async () => state);

      expect(await status_of("1001")).toBe(state);
      expect(await payout_types()).toEqual({ "p-1": "settled" });
      expect(await npo_cash(npo.id)).toBe(0);
      expect(send_alert).toHaveBeenCalledOnce();
      const [alert] = send_alert.mock.calls[0]!;
      expect(alert.title).toBe(`Wise transfer ${state}: npo:${npo.id}`);
      expect(alert.fields).toEqual(
        expect.arrayContaining([
          { name: "settlement", value: "1001" },
          { name: "state", value: state },
          { name: "was", value: "outgoing_payment_sent" },
        ])
      );
    }
  );

  test("a transfer whose money came back is taken back once, however many polls see it", async () => {
    const npo = await seed_npo(500);
    await seed_payout(npo.id, "p-1", 100);
    const transfer = await sent(npo, ["p-1"]);

    await poll_wise_returns(async () => "funds_refunded");
    await poll_wise_returns(async () => "funds_refunded");

    expect(await status_of(transfer)).toBe("returned");
    expect(await payout_types()).toEqual({ "p-1": "returned" });
    expect(await npo_cash(npo.id)).toBe(500);
    expect(send_alert).toHaveBeenCalledOnce();
  });

  test("a lookup that fails is reported and the rest are still polled", async () => {
    const npo = await seed_npo(0);
    await seed_settlement(npo.id, "1001");
    await seed_settlement(npo.id, "1002");
    const lookup = vi.fn(async (id: number) => {
      if (id === 1001) throw "wise 503";
      return "processing";
    });

    await poll_wise_returns(lookup);

    expect(await status_of("1001")).toBe("");
    expect(await status_of("1002")).toBe("processing");
    expect(report_error).toHaveBeenCalledWith("wise 503", {
      settlement_id: "1001",
    });
  });

  describe("the daily cron route", () => {
    const deliver = async () =>
      (await cron_action({
        request: new Request("https://bg.test/api/cron/wise-returns", {
          method: "POST",
        }),
      } as any)) as Response;

    beforeEach(() => {
      verify_qstash.mockReset();
      transfer_get.mockClear();
    });

    test("a verified tick reads each transfer's state from wise", async () => {
      const npo = await seed_npo(0);
      await seed_settlement(npo.id, "2449407370");

      const res = await deliver();

      expect(res.status).toBe(200);
      expect(verify_qstash).toHaveBeenCalledOnce();
      expect(transfer_get).toHaveBeenCalledWith(2449407370);
      expect(await status_of("2449407370")).toBe("returned");
    });

    test("a tick qstash did not sign polls nothing", async () => {
      const npo = await seed_npo(0);
      await seed_settlement(npo.id, "1001");
      verify_qstash.mockRejectedValueOnce(new Response(null, { status: 401 }));

      await expect(deliver()).rejects.toBeInstanceOf(Response);
      expect(transfer_get).not.toHaveBeenCalled();
    });

    test("a transfer wise answers without a state is not taken for a change", async () => {
      const npo = await seed_npo(0);
      await seed_settlement(npo.id, "1001");
      transfer_get.mockResolvedValueOnce({ id: 1001 });

      await deliver();

      expect(await status_of("1001")).toBe("");
      expect(report_error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/no status/),
        }),
        { settlement_id: "1001" }
      );
    });
  });
});
