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
const deductions = vi.hoisted(() => ({ on: false }));

vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));
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
  aws_monitor: { send_alert: vi.fn() },
  fiat_monitor: { send_alert: vi.fn() },
}));
/** the duplicate check misses once, as it does for a concurrent mark of the
 * same wire that commits between that check and this one's insert */
const precheck_miss = vi.hoisted(() => ({ once: false }));
vi.mock("../pg/queries/manual-wire", async (io) => {
  const actual = await io<typeof import("../pg/queries/manual-wire")>();
  return {
    ...actual,
    manual_wire_by_tx: (
      ...args: Parameters<typeof actual.manual_wire_by_tx>
    ) => {
      if (precheck_miss.once) {
        precheck_miss.once = false;
        return Promise.resolve(undefined);
      }
      return actual.manual_wire_by_tx(...args);
    },
  };
});
vi.mock("../kit/wise", () => ({ wise: {} }));
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

const { mark_wired } = await import("./manual-wire");
const { poll_wise_returns } = await import("./wise-return");
const { settle_npo_payouts } = await import("./settle");
const { create_test_db } = await import("../pg/test-utils/pglite");
const { npos } = await import("../pg/schema/npo");
const { payouts, settlements, manual_wires } = await import(
  "../pg/schema/payout"
);
const { donations } = await import("../pg/schema/donation");
const { user } = await import("../pg/schema/auth");
const { owed_amounts, owed_notices } = await import("../pg/schema/owed");

const db = () => test_db.current!.db;

const ADMIN = "admin-1";

beforeAll(async () => {
  test_db.current = await create_test_db();
  await db().insert(user).values({
    id: ADMIN,
    name: "Admin",
    email: "admin@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Admin",
    last_name: "Test",
  });
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  deductions.on = false;
  await db().delete(owed_amounts);
  await db().delete(donations);
  await db().delete(payouts);
  await db().delete(manual_wires);
  await db().delete(settlements);
  await db().delete(npos);
});

let seq = 0;
async function seed_npo(
  o: {
    cash?: number;
    payout_method?: "wise" | "manual_wire";
    payout_minimum?: number;
    name?: string;
  } = {}
) {
  seq += 1;
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-WIRE-${seq}`,
      name: o.name ?? `Wire NPO ${seq}`,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash: o.cash ?? 1000,
      payout_minimum: o.payout_minimum,
      payout_method: o.payout_method ?? "manual_wire",
    })
    .returning();
  return npo!.id;
}

async function seed_payout(
  npo_id: number,
  id: string,
  amount: number,
  o: { type?: "pending" | "settled"; date?: string } = {}
) {
  await db()
    .insert(payouts)
    .values({
      id,
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: o.date ?? "2026-09-01T00:00:00.000Z",
      amount,
      type: o.type ?? "pending",
    });
}

const wire = (
  npo_id: number,
  o: Partial<Parameters<typeof mark_wired>[0]>
) => ({
  npo_id,
  wire_date: "2026-11-18",
  provider: "Mercury",
  provider_tx_id: "tx-1",
  wire_fee: 0,
  amount_sent: 0,
  recorded_by: ADMIN,
  ...o,
});

const payout_types = async () =>
  Object.fromEntries(
    (
      await db().select({ id: payouts.id, type: payouts.type }).from(payouts)
    ).map((r) => [r.id, r.type])
  );

const npo_cash = async (id: number) =>
  (await db().select({ cash: npos.cash }).from(npos).where(eq(npos.id, id)))[0]
    ?.cash;

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
  // the party was told of it, so a run may net it
  await db().insert(owed_notices).values({
    owed_id: owed!.id,
    kind: "recorded",
    created_at: "2026-09-15T00:00:00.000Z",
    sent_at: "2026-09-15T00:00:00.000Z",
  });
}

describe("mark_wired", () => {
  test("settles every pending payout of that nonprofit, debits the net and records the wire", async () => {
    const npo = await seed_npo({ cash: 1000 });
    const other = await seed_npo({ cash: 1000 });
    await seed_payout(npo, "p-1", 60);
    await seed_payout(npo, "p-2", 40);
    await seed_payout(other, "o-1", 70);

    const res = await mark_wired(
      wire(npo, { amount_sent: 75, wire_fee: 25, provider_tx_id: "mt-9" })
    );

    expect(res).toMatchObject({ status: "ok" });
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "settled",
      "o-1": "pending",
    });
    expect(await npo_cash(npo)).toBe(900);
    expect(await npo_cash(other)).toBe(1000);
    const [w] = await db().select().from(manual_wires);
    expect(w).toMatchObject({
      npo_id: npo,
      provider: "Mercury",
      provider_tx_id: "mt-9",
      wire_date: "2026-11-18",
      amount_sent: 75,
      wire_fee: 25,
      recorded_by: ADMIN,
    });
    const [s] = await db().select().from(settlements);
    expect(w!.settlement_id).toBe(s!.id);
    expect(s).toMatchObject({ npo_id: npo, amount: 100, status: "paid" });
    const settled = await db()
      .select({ settled_id: payouts.settled_id })
      .from(payouts)
      .where(eq(payouts.npo_id, npo));
    expect(settled.map((p) => p.settled_id)).toEqual([s!.id, s!.id]);
  });

  test("owing $93.20 on $500 pending, a $406.80 wire settles the payouts, recovers the owed and takes the $500 gross off the cash", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 500 });
    await seed_payout(npo, "p-1", 500);
    await seed_owed(npo, "don-owed", 93.2);

    const res = await mark_wired(
      wire(npo, { amount_sent: 396.8, wire_fee: 10 })
    );

    expect(res).toMatchObject({ status: "ok", net: 406.8 });
    expect(await payout_types()).toEqual({ "p-1": "settled" });
    expect(await npo_cash(npo)).toBe(0);
    const [s] = await db().select().from(settlements);
    expect(s).toMatchObject({ amount: 406.8 });
    const [row] = await db().select().from(owed_amounts);
    expect(row).toMatchObject({ recovered_usd: 93.2, outstanding_usd: 0 });
  });

  test("a wire that is not the net less its fee is refused, and nothing is written", async () => {
    const npo = await seed_npo({ cash: 1000 });
    await seed_payout(npo, "p-1", 100);

    const res = await mark_wired(wire(npo, { amount_sent: 100, wire_fee: 25 }));

    expect(res).toEqual({ status: "amount_mismatch", net: 100, expected: 75 });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await npo_cash(npo)).toBe(1000);
    expect(await db().select().from(manual_wires)).toEqual([]);
    expect(await db().select().from(settlements)).toEqual([]);
  });

  test("the fee is taken to the cent: $0.10 + $0.20 of payouts, a $0.10 fee, $0.20 sent", async () => {
    const npo = await seed_npo({ payout_minimum: 0 });
    await seed_payout(npo, "p-1", 0.1);
    await seed_payout(npo, "p-2", 0.2);

    const res = await mark_wired(
      wire(npo, { amount_sent: 0.2, wire_fee: 0.1 })
    );

    expect(res).toMatchObject({ status: "ok", net: 0.3 });
  });

  test("a provider reference already recorded is a duplicate, and nothing is written", async () => {
    const npo = await seed_npo({ cash: 1000 });
    await seed_payout(npo, "p-1", 100);
    expect(await mark_wired(wire(npo, { amount_sent: 100 }))).toMatchObject({
      status: "ok",
    });
    await seed_payout(npo, "p-2", 80);
    const before = {
      wires: await db().select().from(manual_wires),
      settlements: await db().select().from(settlements),
      payouts: await payout_types(),
      cash: await npo_cash(npo),
    };

    const res = await mark_wired(wire(npo, { amount_sent: 80 }));

    expect(res).toEqual({ status: "duplicate" });
    expect({
      wires: await db().select().from(manual_wires),
      settlements: await db().select().from(settlements),
      payouts: await payout_types(),
      cash: await npo_cash(npo),
    }).toEqual(before);
    expect(before.payouts).toEqual({ "p-1": "settled", "p-2": "pending" });
  });

  test("the same reference at another provider is a different wire", async () => {
    const providers = ["Mercury", "Other Bank"];
    const npo = await seed_npo({ cash: 1000 });
    await seed_payout(npo, "p-1", 100);
    await mark_wired(wire(npo, { amount_sent: 100 }), providers);
    await seed_payout(npo, "p-2", 80);

    const res = await mark_wired(
      wire(npo, { amount_sent: 80, provider: "Other Bank" }),
      providers
    );

    expect(res).toMatchObject({ status: "ok" });
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "settled",
    });
    expect(await db().select().from(manual_wires)).toHaveLength(2);
  });

  test("a provider outside WIRE_PROVIDERS is refused", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);

    const res = await mark_wired(
      wire(npo, { amount_sent: 100, provider: "Other Bank" })
    );

    expect(res).toEqual({ status: "invalid", field: "provider" });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
  });

  test("a negative fee is refused", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100);

    const res = await mark_wired(wire(npo, { amount_sent: 105, wire_fee: -5 }));

    expect(res).toEqual({ status: "invalid", field: "wire_fee" });
  });

  test("a net under the npo's minimum is refused, and nothing is written", async () => {
    const npo = await seed_npo({ cash: 1000, payout_minimum: 150 });
    await seed_payout(npo, "p-1", 100);

    const res = await mark_wired(wire(npo, { amount_sent: 100 }));

    expect(res).toEqual({ status: "under_minimum", net: 100, minimum: 150 });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await npo_cash(npo)).toBe(1000);
    expect(await db().select().from(manual_wires)).toEqual([]);
  });

  test("with no minimum of its own, the npo is held to the platform's $50", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 40);

    const res = await mark_wired(wire(npo, { amount_sent: 40 }));

    expect(res).toEqual({ status: "under_minimum", net: 40, minimum: 50 });
  });

  test("an npo paid by wise is refused, its payouts left pending", async () => {
    const npo = await seed_npo({ payout_method: "wise" });
    await seed_payout(npo, "p-1", 100);

    const res = await mark_wired(wire(npo, { amount_sent: 100 }));

    expect(res).toEqual({ status: "not_manual_wire" });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await db().select().from(manual_wires)).toEqual([]);
  });

  test("an npo with nothing pending has nothing to wire", async () => {
    const npo = await seed_npo();
    await seed_payout(npo, "p-1", 100, { type: "settled" });

    const res = await mark_wired(wire(npo, { amount_sent: 100 }));

    expect(res).toEqual({ status: "none_pending" });
  });

  test("a concurrent mark of the same wire that commits first makes this one a duplicate, and nothing is written", async () => {
    const npo = await seed_npo({ cash: 1000 });
    await seed_payout(npo, "p-1", 100);
    await mark_wired(wire(npo, { amount_sent: 100 }));
    await seed_payout(npo, "p-2", 80);
    precheck_miss.once = true;

    const res = await mark_wired(wire(npo, { amount_sent: 80 }));

    expect(res).toEqual({ status: "duplicate" });
    expect(await payout_types()).toEqual({
      "p-1": "settled",
      "p-2": "pending",
    });
    expect(await npo_cash(npo)).toBe(900);
    expect(await db().select().from(manual_wires)).toHaveLength(1);
  });
});

/** a wise transfer of the npo's that came back, with no newer account
 * approved since: a wise npo's grants are held on it */
async function seed_returned_transfer(npo_id: number) {
  await db()
    .insert(settlements)
    .values({
      id: `returned-${npo_id}`,
      other_id: "ref-returned",
      npo_id,
      date: "2026-08-01T00:00:00.000Z",
      amount: 200,
      status: "returned",
      recipient_id: "bank-old",
    });
}

describe("a returned wise transfer on record", () => {
  test("does not stop a manual-wire npo being marked wired", async () => {
    const npo = await seed_npo({ cash: 1000 });
    await seed_returned_transfer(npo);
    await seed_payout(npo, "p-1", 100);

    const res = await mark_wired(wire(npo, { amount_sent: 100 }));

    expect(res).toMatchObject({ status: "ok" });
    expect(await payout_types()).toEqual({ "p-1": "settled" });
  });

  test("a manual-wire npo whose owed covers its pending settles as recovered with no wire, the cash down by the gross", async () => {
    deductions.on = true;
    const npo = await seed_npo({ cash: 80 });
    await seed_returned_transfer(npo);
    await seed_payout(npo, "p-1", 80);
    await seed_owed(npo, "don-owed", 93.2);

    const res = await settle_npo_payouts(
      { id: npo, name: "n", payout_minimum: 50, payout_method: "manual_wire" },
      ["p-1"],
      null
    );

    expect(res).toMatchObject({ status: "recovered", total: 80 });
    expect(await payout_types()).toEqual({ "p-1": "settled" });
    expect(await npo_cash(npo)).toBe(0);
    expect(await db().select().from(manual_wires)).toEqual([]);
    const [row] = await db().select().from(owed_amounts);
    expect(row).toMatchObject({ recovered_usd: 80 });
  });

  test("a manual-wire npo with a net to pay and no recipient is left untouched", async () => {
    const npo = await seed_npo({ cash: 1000 });
    await seed_returned_transfer(npo);
    await seed_payout(npo, "p-1", 100);

    const res = await settle_npo_payouts(
      { id: npo, name: "n", payout_minimum: 50, payout_method: "manual_wire" },
      ["p-1"],
      null
    );

    expect(res).toEqual({ status: "no_recipient", total: 100 });
    expect(await payout_types()).toEqual({ "p-1": "pending" });
    expect(await npo_cash(npo)).toBe(1000);
  });

  test("still holds a wise npo", async () => {
    const npo = await seed_npo({ cash: 1000, payout_method: "wise" });
    await seed_returned_transfer(npo);
    await seed_payout(npo, "p-1", 100);

    const res = await settle_npo_payouts(
      { id: npo, name: "n", payout_minimum: 50 },
      ["p-1"],
      null
    );

    expect(res).toMatchObject({ status: "held" });
  });
});

describe("the wise returns poll", () => {
  test("never asks wise about a manual wire's settlement, and still reads a transfer's", async () => {
    const npo = await seed_npo({ cash: 1000 });
    await seed_payout(npo, "p-1", 100);
    const today = new Date().toISOString();
    await mark_wired(
      wire(npo, { amount_sent: 100, wire_date: today.slice(0, 10) })
    );
    await db().insert(settlements).values({
      id: "4242",
      other_id: "ref-4242",
      npo_id: npo,
      date: today,
      amount: 50,
      status: "processing",
    });
    const state_of = vi.fn(async () => "processing");

    await poll_wise_returns(state_of);

    expect(state_of.mock.calls).toEqual([[4242]]);
  });
});
