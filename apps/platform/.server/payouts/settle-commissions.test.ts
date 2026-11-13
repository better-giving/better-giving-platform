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
import type { Pay } from "./settle";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const send_alert = vi.hoisted(() => vi.fn());

vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));
vi.mock("../env", () => ({ stage: "test", owed_deductions: false }));
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

const { settle_referrer_commissions } = await import("./settle-commissions");
const { NotFundedError, PayRefused } = await import("./transfer");
const { create_test_db } = await import("../pg/test-utils/pglite");
const { npos } = await import("../pg/schema/npo");
const { referrer_commissions, referrer_payouts } = await import(
  "../pg/schema/referrer"
);

const db = () => test_db.current!.db;
const REFERRER = "NPO-REF";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  send_alert.mockReset();
  await db().delete(referrer_payouts);
  await db().delete(referrer_commissions);
  await db().delete(npos);
});

async function seed_commission(donation_id: string, amount: number) {
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-SETTLE-COMMISSION",
      name: "Referrer NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      referral_id: REFERRER,
    })
    .returning();
  await db().insert(referrer_commissions).values({
    referrer_npo: REFERRER,
    date: "2026-09-01T00:00:00.000Z",
    donation_id,
    npo_id: npo!.id,
    amount,
    status: "pending",
  });
}

const statuses = async () =>
  (
    await db()
      .select({ status: referrer_commissions.status })
      .from(referrer_commissions)
  ).map((r) => r.status);

describe("settle_referrer_commissions", () => {
  test("a payout refused before funding goes back to pending, pays nothing and alerts ops", async () => {
    await seed_commission("d-1", 60);
    const pay = vi.fn<Pay>(async () => {
      throw new NotFundedError(
        new PayRefused(
          "recipient 42 is one of Better Giving's own Wise accounts"
        )
      );
    });

    const res = await settle_referrer_commissions(
      { id: REFERRER, pay_min: 50 },
      { pay_id: 42, pay }
    );

    expect(res).toMatchObject({ status: "released" });
    expect(await statuses()).toEqual(["pending"]);
    // only the failure row: nothing recorded as paid
    expect(
      (await db().select().from(referrer_payouts)).map((p) => p.error)
    ).toEqual(["Failed to process commission"]);
    const refused = send_alert.mock.calls
      .map(([a]) => a)
      .find((a) => a.title === `commission payout refused for ${REFERRER}`);
    expect(refused?.body).toContain("one of Better Giving's own Wise accounts");
    expect(refused?.fields).toEqual(
      expect.arrayContaining([{ name: "recipient", value: "42" }])
    );
  });
});
