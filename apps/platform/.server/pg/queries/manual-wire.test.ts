import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const deductions = vi.hoisted(() => ({ on: false }));

vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));
vi.mock("../../env", () => ({
  stage: "test",
  get owed_deductions() {
    return deductions.on;
  },
}));
vi.mock("@/terms", async (io) => ({
  ...(await io<typeof import("@/terms")>()),
  TERMS_RECOVERY_FROM: "2026-01-01",
  TERMS_POSTED: "",
}));
vi.mock("../../kit/slack", () => ({
  aws_monitor: { send_alert: vi.fn() },
}));
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

const { manual_wire_rows, npos_manual_wire } = await import("./manual-wire");
const { create_test_db } = await import("../test-utils/pglite");
const { npos } = await import("../schema/npo");
const { payouts } = await import("../schema/payout");
const { banking_apps } = await import("../schema/banking");
const { dists } = await import("../schema/dist");
const { donations, donation_donors } = await import("../schema/donation");
const { owed_amounts, owed_notices } = await import("../schema/owed");

const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  deductions.on = false;
  await db().delete(owed_amounts);
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donation_donors);
  await db().delete(donations);
  await db().delete(banking_apps);
  await db().delete(npos);
});

let seq = 0;
async function seed_npo(
  name: string,
  o: { payout_method?: "wise" | "manual_wire"; payout_minimum?: number } = {}
) {
  seq += 1;
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-MWQ-${seq}`,
      name,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      payout_method: o.payout_method ?? "manual_wire",
      payout_minimum: o.payout_minimum,
    })
    .returning();
  return npo!.id;
}

async function seed_gift(id: string, created_at = "2026-08-01T00:00:00.000Z") {
  await db().insert(donations).values({
    id,
    created_at,
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

async function seed_payout(
  npo_id: number,
  id: string,
  amount: number,
  date: string,
  o: { type?: "pending" | "settled"; source?: "donation" | "liq" | "lock" } = {}
) {
  await db()
    .insert(payouts)
    .values({
      id,
      source_id: `dist-${id}`,
      npo_id,
      source: o.source ?? "donation",
      date,
      amount,
      type: o.type ?? "pending",
    });
}

/** a pending payout of a gift from `donor`, through its dist */
async function seed_donor_payout(
  npo_id: number,
  id: string,
  amount: number,
  date: string,
  donor: { email: string; name?: string }
) {
  await seed_gift(`don-${id}`);
  await db()
    .insert(donation_donors)
    .values({ donation_id: `don-${id}`, ...donor });
  await db()
    .insert(dists)
    .values({
      id: `dist-${id}`,
      donation_id: `don-${id}`,
      status: "settled",
      date_created: date,
      to_id: npo_id,
      amount_denom: "USD",
    });
  await seed_payout(npo_id, id, amount, date);
}

describe("manual_wire_rows", () => {
  test("one row per manual-wire npo with pending payouts, by name, payouts oldest first", async () => {
    const paws = await seed_npo("SXM Paws", { payout_minimum: 100 });
    const acme = await seed_npo("Acme Relief");
    const wise = await seed_npo("Wise Paid", { payout_method: "wise" });
    const idle = await seed_npo("Idle Wire");
    await db().insert(banking_apps).values({
      id: "bank-1",
      npo_id: paws,
      status: "default",
      bank_summary: "USD account ending in 0412",
    });
    await seed_donor_payout(paws, "p-2", 60, "2026-09-02T00:00:00.000Z", {
      email: "ann@example.com",
      name: "Ann",
    });
    await seed_donor_payout(paws, "p-1", 40.5, "2026-09-01T00:00:00.000Z", {
      email: "",
      name: "Bob Donor",
    });
    await seed_payout(paws, "p-3", 10, "2026-09-03T00:00:00.000Z", {
      source: "liq",
    });
    // its dist is gone: no donor on record
    await seed_payout(paws, "p-4", 5, "2026-09-04T00:00:00.000Z");
    await seed_payout(acme, "a-1", 75, "2026-09-05T00:00:00.000Z", {
      source: "lock",
    });
    await seed_payout(wise, "w-1", 500, "2026-09-01T00:00:00.000Z");
    await seed_payout(idle, "i-1", 90, "2026-09-01T00:00:00.000Z", {
      type: "settled",
    });

    expect(await manual_wire_rows()).toEqual([
      {
        npo_id: acme,
        name: "Acme Relief",
        gross: 75,
        owed: 0,
        net: 75,
        minimum: 50,
        bank: "No bank account on file",
        payouts: [
          {
            id: "a-1",
            label: "Investments",
            date: "2026-09-05T00:00:00.000Z",
            amount: 75,
          },
        ],
      },
      {
        npo_id: paws,
        name: "SXM Paws",
        gross: 115.5,
        owed: 0,
        net: 115.5,
        minimum: 100,
        bank: "USD account ending in 0412",
        payouts: [
          {
            id: "p-1",
            label: "Bob Donor",
            date: "2026-09-01T00:00:00.000Z",
            amount: 40.5,
          },
          {
            id: "p-2",
            label: "ann@example.com",
            date: "2026-09-02T00:00:00.000Z",
            amount: 60,
          },
          {
            id: "p-3",
            label: "Savings",
            date: "2026-09-03T00:00:00.000Z",
            amount: 10,
          },
          {
            id: "p-4",
            label: "Unknown donor",
            date: "2026-09-04T00:00:00.000Z",
            amount: 5,
          },
        ],
      },
    ]);
  });

  test("netting on, what the npo owes comes off the net", async () => {
    deductions.on = true;
    const paws = await seed_npo("SXM Paws");
    await seed_payout(paws, "p-1", 500, "2026-09-01T00:00:00.000Z");
    await seed_owed(paws, "don-owed", 93.2);

    const [row] = await manual_wire_rows();

    expect(row).toMatchObject({ gross: 500, owed: 93.2, net: 406.8 });
  });

  test("an npo whose net is under its minimum has no row", async () => {
    const small = await seed_npo("Small Wire");
    await seed_payout(small, "s-1", 30, "2026-09-01T00:00:00.000Z");

    expect(await manual_wire_rows()).toEqual([]);
  });

  test("netting on, an npo the owed takes under its minimum, or whose owed covers its pending, has no row", async () => {
    deductions.on = true;
    const short = await seed_npo("Short Wire");
    await seed_payout(short, "s-1", 100, "2026-09-01T00:00:00.000Z");
    await seed_owed(short, "don-short", 60);
    const covered = await seed_npo("Covered Wire");
    await seed_payout(covered, "c-1", 80, "2026-09-01T00:00:00.000Z");
    await seed_owed(covered, "don-covered", 93.2);

    expect(await manual_wire_rows()).toEqual([]);
  });
});

/** a gift refunded after its grant went out, the npo owing `usd` on it, and
 * told of it so a run may net it */
async function seed_owed(npo_id: number, donation_id: string, usd: number) {
  await seed_gift(donation_id);
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

describe("npos_manual_wire", () => {
  test("names the manual-wire npos among the ids, and no others", async () => {
    const paws = await seed_npo("SXM Paws");
    const wise = await seed_npo("Wise Paid", { payout_method: "wise" });

    expect(await npos_manual_wire([paws, wise, 99_999])).toEqual(
      new Set([paws])
    );
    expect(await npos_manual_wire([])).toEqual(new Set());
  });
});
