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
const deductions = vi.hoisted(() => ({ on: false }));
/** spies the real template, for the tests that read the run's data */
const template = vi.hoisted(() => vi.fn());
/** the transport: the text part is the one the provider receives */
const send_mail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => {
  const createTransport = () => ({ sendMail: send_mail });
  return { default: { createTransport }, createTransport };
});

vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));
vi.mock("$/env", () => ({
  wise: { profile_id: "1", balance_id_usd: "2" },
  smtp: { password: "test-token" },
  stage: "test",
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
  aws_monitor: { send_alert: vi.fn(async () => {}) },
}));
vi.mock("$/kit/wise", () => ({
  wise: { balance: async () => ({ totalWorth: { value: 150 } }) },
}));
vi.mock("emails", async (io) => {
  const real = await io<typeof import("emails")>();
  template.mockImplementation(real.grants_schedule.template);
  return { ...real, grants_schedule: { ...real.grants_schedule, template } };
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

const { index } = await import("./notif");
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { banking_apps } = await import("$/pg/schema/banking");
const { donations } = await import("$/pg/schema/donation");
const { owed_amounts, owed_notices } = await import("$/pg/schema/owed");
const { npos } = await import("$/pg/schema/npo");
const { payouts } = await import("$/pg/schema/payout");

const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  template.mockClear();
  send_mail.mockReset().mockResolvedValue({ messageId: "<m@bg>" });
  deductions.on = false;
  terms.effective = "2026-01-01";
  await db().delete(owed_amounts);
  await db().delete(donations);
  await db().delete(payouts);
  await db().delete(banking_apps);
  await db().delete(npos);
});

const npo_ids: Record<string, number> = {};

async function seed_npo(
  name: string,
  o: {
    active?: boolean;
    recipient?: boolean;
    amount: number;
    payout_method?: "wise" | "manual_wire";
  }
) {
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-${name}`,
      name,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      cash: 1000,
      active: o.active,
      payout_method: o.payout_method,
    })
    .returning();
  npo_ids[name] = npo!.id;
  if (o.recipient !== false) {
    await db()
      .insert(banking_apps)
      .values({ id: `${npo!.id}77`, npo_id: npo!.id, status: "default" });
  }
  await db()
    .insert(payouts)
    .values({
      id: `p-${name}`,
      source_id: `dist-${name}`,
      npo_id: npo!.id,
      source: "donation",
      date: "2026-09-01T00:00:00.000Z",
      amount: o.amount,
      type: "pending",
    });
}

/** the npo named `name` owes `usd` on a gift refunded after its grant */
async function seed_owed(name: string, donation_id: string, usd: number) {
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
      npo_id: npo_ids[name],
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

/** the text line beginning with `first`, split on the column gutter */
const row_cells = (text: string, first: string) =>
  text
    .split("\n")
    .find((l) => l.trimStart().startsWith(`${first} `))
    ?.trim()
    .split(/\s{2,}/);

const sent_text = () => send_mail.mock.calls[0]![0].text as string;

describe("grants schedule notice", () => {
  test("lists only the nonprofits the payout run will pay as pass, and totals those alone", async () => {
    await seed_npo("Paid", { amount: 100 });
    await seed_npo("Inactive", { active: false, amount: 100 });
    await seed_npo("NoRecipient", { recipient: false, amount: 100 });

    await index();

    const data = template.mock.calls[0]![0] as any;
    const effects = Object.fromEntries(
      data.rows.map((r: any) => [r.name, r.effect])
    );
    expect(effects).toEqual({
      Paid: "pass",
      Inactive: "skipped",
      NoRecipient: "skipped",
    });
    expect(data.total_grant).toBe(100);
    expect(data.low_balance).toBe(false);
  });

  test("an npo under its minimum is a skipped row showing its total and minimum, left out of the total", async () => {
    await seed_npo("Paid", { amount: 100 });
    await seed_npo("Small", { amount: 30 });

    await index();

    const data = template.mock.calls[0]![0] as any;
    const small = data.rows.find((r: any) => r.name === "Small");
    expect(small).toMatchObject({ amount: 30, min: 50, effect: "skipped" });
    expect(data.total_grant).toBe(100);
  });

  test("judges the 50 minimum on the cents the run pays: 49.996 passes as 50, 49.994 is skipped as 49.99", async () => {
    await seed_npo("Edge", { amount: 49.996 });
    await seed_npo("Under", { amount: 49.994 });

    await index();

    const data = template.mock.calls[0]![0] as any;
    const rows = Object.fromEntries(
      data.rows.map((r: any) => [r.name, [r.amount, r.effect]])
    );
    expect(rows).toEqual({ Edge: [50, "pass"], Under: [49.99, "skipped"] });
    expect(data.total_grant).toBe(50);
  });

  test("switched on, an npo's row shows its gross, each deduction by gift and its net, the total summing nets", async () => {
    deductions.on = true;
    await seed_npo("Nets", { amount: 500 });
    await seed_owed("Nets", "don-owed", 93.2);
    await seed_npo("Covered", { amount: 80, recipient: false });
    await seed_owed("Covered", "don-big", 93.2);

    await index();

    const text = sent_text();
    expect(row_cells(text, `${npo_ids.Nets}`)).toEqual([
      `${npo_ids.Nets}`,
      "Nets",
      "$500.00",
      "−$93.20",
      "$406.80",
      "$50.00",
      "pass",
    ]);
    expect(row_cells(text, `${npo_ids.Covered}`)).toEqual([
      `${npo_ids.Covered}`,
      "Covered",
      "$80.00",
      "−$80.00",
      "$0.00",
      "$50.00",
      "recovered",
    ]);
    expect(row_cells(text, "don-owed")).toEqual([
      "don-owed",
      `${npo_ids.Nets}`,
      "−$93.20",
    ]);
    expect(row_cells(text, "don-big")).toEqual([
      "don-big",
      `${npo_ids.Covered}`,
      "−$80.00",
    ]);
    expect(text).toMatch(/Grant total: \$406\.80/);
  });

  test("switched on with no terms effective date, a row is the gross one, as if switched off", async () => {
    deductions.on = true;
    terms.effective = "soon";
    await seed_npo("Gross", { amount: 500 });
    await seed_owed("Gross", "don-owed", 93.2);

    await index();

    const text = sent_text();
    expect(row_cells(text, `${npo_ids.Gross}`)).toEqual([
      `${npo_ids.Gross}`,
      "Gross",
      "$500.00",
      "$50.00",
      "pass",
    ]);
    expect(text).not.toContain("don-owed");
    expect(text).toMatch(/Grant total: \$500\.00/);
  });

  test("switched on, an npo whose net falls under its minimum is skipped, still showing what it owes", async () => {
    deductions.on = true;
    await seed_npo("Small", { amount: 80 });
    await seed_owed("Small", "don-owed", 50);

    await index();

    const text = sent_text();
    expect(row_cells(text, `${npo_ids.Small}`)).toEqual([
      `${npo_ids.Small}`,
      "Small",
      "$80.00",
      "−$50.00",
      "$30.00",
      "$50.00",
      "skipped",
    ]);
    expect(row_cells(text, "don-owed")).toEqual([
      "don-owed",
      `${npo_ids.Small}`,
      "−$50.00",
    ]);
    expect(text).toMatch(/Grant total: \$0\.00/);
  });

  test("switched on, an npo owed a transfer with no wise recipient is skipped, its total left out", async () => {
    deductions.on = true;
    await seed_npo("Paid", { amount: 100 });
    await seed_npo("NoRecipient", { amount: 500, recipient: false });
    await seed_owed("NoRecipient", "don-owed", 93.2);

    await index();

    const text = sent_text();
    expect(row_cells(text, `${npo_ids.NoRecipient}`)).toEqual([
      `${npo_ids.NoRecipient}`,
      "NoRecipient",
      "$500.00",
      "−$93.20",
      "$406.80",
      "$50.00",
      "skipped",
    ]);
    expect(text).toMatch(/Grant total: \$100\.00/);
  });

  test("an npo paid by manual wire is a manual_wire row with its net, deductions and minimum, kept out of the wise total and the low-balance check", async () => {
    deductions.on = true;
    await seed_npo("Paid", { amount: 100 });
    await seed_npo("Wired", { amount: 3000, payout_method: "manual_wire" });
    await seed_owed("Wired", "don-owed", 93.2);

    await index();

    const data = template.mock.calls[0]![0] as any;
    expect(data.rows.find((r: any) => r.name === "Wired")).toEqual({
      id: npo_ids.Wired,
      name: "Wired",
      amount: 3000,
      min: 50,
      net: 2906.8,
      effect: "manual_wire",
      deductions: [{ donation_id: "don-owed", usd: 93.2 }],
    });
    // the wise balance is 150: counting the wire would flag it low
    expect(data.total_grant).toBe(100);
    expect(data.low_balance).toBe(false);
    expect(row_cells(sent_text(), "don-owed")).toEqual([
      "don-owed",
      `${npo_ids.Wired}`,
      "−$93.20",
    ]);
  });

  test("switched off, a manual-wire npo's row is its gross, with nothing netted", async () => {
    await seed_npo("Wired", { amount: 3000, payout_method: "manual_wire" });

    await index();

    const data = template.mock.calls[0]![0] as any;
    expect(data.rows).toEqual([
      {
        id: npo_ids.Wired,
        name: "Wired",
        amount: 3000,
        min: 50,
        effect: "manual_wire",
      },
    ]);
    expect(data.total_grant).toBe(0);
  });
});
