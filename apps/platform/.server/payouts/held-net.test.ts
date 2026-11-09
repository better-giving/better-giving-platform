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
vi.mock("../pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        return (test_db.current!.db as any)[prop];
      },
    }
  ),
}));

const { held_money_net } = await import("./held-net");
const { create_test_db } = await import("../pg/test-utils/pglite");
const { dists } = await import("../pg/schema/dist");
const { donations } = await import("../pg/schema/donation");
const { npos } = await import("../pg/schema/npo");
const { owed_amounts, owed_notices } = await import("../pg/schema/owed");
const { payouts } = await import("../pg/schema/payout");

const db = () => test_db.current!.db;
let npo_id: number;
let n = 0;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T09:00:00.000Z"));
  deductions.on = false;
  await db().delete(owed_amounts);
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(npos);
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-NET",
      name: "Net NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  npo_id = npo!.id;
});

afterEach(() => {
  vi.useRealTimers();
});

/** a pending PayPal payout, held for want of a bank */
async function seed_held(amount: number) {
  const id = `held-${++n}`;
  await db().insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: amount,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "paypal",
  });
  await db()
    .insert(dists)
    .values({
      id: `dist-${id}`,
      donation_id: id,
      status: "settled",
      date_created: "2026-10-01T00:00:00.000Z",
      to_id: npo_id,
      amount_denom: "USD",
      net: amount,
    });
  await db()
    .insert(payouts)
    .values({
      id: `payout-${id}`,
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: "2026-10-01T00:00:00.000Z",
      amount,
      type: "pending",
    });
}

/** a gift refunded after its grant went out, the npo owing `usd` on it */
async function seed_owed(usd: number) {
  const id = `owed-${++n}`;
  await db().insert(donations).values({
    id,
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
      donation_id: id,
      npo_id,
      source: "refund",
      source_ref: `re_${id}`,
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

describe("held_money_net", () => {
  test("takes what the npo owes off the held total, as the payout run does", async () => {
    deductions.on = true;
    await seed_held(100);
    await seed_owed(30.5);

    const held = await held_money_net(db() as any, npo_id);

    expect(held.total).toBe(100);
    expect(held.net).toBe(69.5);
  });

  test("an npo owing more than it holds nets to nothing", async () => {
    deductions.on = true;
    await seed_held(100);
    await seed_owed(250);

    expect((await held_money_net(db() as any, npo_id)).net).toBe(0);
  });

  test("owing nothing, the net is the total", async () => {
    deductions.on = true;
    await seed_held(100);

    expect((await held_money_net(db() as any, npo_id)).net).toBe(100);
  });

  test("with owed deductions off the run subtracts nothing, so no net is given", async () => {
    await seed_held(100);
    await seed_owed(30.5);

    expect((await held_money_net(db() as any, npo_id)).net).toBeUndefined();
  });
});
