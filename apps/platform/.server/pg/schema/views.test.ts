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
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

const { create_test_db } = await import("../test-utils/pglite");
const { dists } = await import("./dist");
const { donations } = await import("./donation");
const { funds } = await import("./fund");
const { npos } = await import("./npo");
const { user } = await import("./auth");
const { v_contributions, v_donation_total_usd } = await import("./views");

const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

let npo_id: number;
const FUND = "fund-views";

beforeEach(async () => {
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(funds);
  await db().delete(npos);
  await db().delete(user);
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-VIEWS",
      name: "Views NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  npo_id = npo!.id;
  await db().insert(user).values({
    id: "u-views",
    name: "Cam Creator",
    email: "u-views@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Cam",
    last_name: "Creator",
  });
  await db()
    .insert(funds)
    .values({
      id: FUND,
      creator_id: "u-views",
      name: "Views drive",
      slug: "views-drive",
      description_pt: "[]",
      description_v2: "views",
      banner: "https://img.co/banner.png",
      logo: "https://img.co/logo.png",
      videos: [],
      published: true,
      active: true,
      fund_donate_methods: ["stripe"],
      hide_bg_tip: true,
    });
});

/** a gift of `usd` to the npo and the fund: the donation as `donation_status`
 * says, its dist as `dist_status` says */
async function gift(
  id: string,
  usd: number,
  donation_status: "settled" | "refunded" | "refunded_loss",
  dist_status: "settled" | "refunded" | "refunded_loss" = "settled"
) {
  await db().insert(donations).values({
    id,
    upusd: 1,
    status: donation_status,
    amount_base: usd,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db()
    .insert(dists)
    .values({
      id: `dist-${id}`,
      donation_id: id,
      status: dist_status,
      date_created: new Date().toISOString(),
      to_id: npo_id,
      amount_denom: "USD",
      amount_usd: usd,
      net: usd,
      fund_id: FUND,
    });
}

const contributions = async () =>
  (
    await db()
      .select()
      .from(v_contributions)
      .where(eq(v_contributions.npo_id, npo_id))
  )[0];
const fund_total = async () =>
  (
    await db()
      .select()
      .from(v_donation_total_usd)
      .where(eq(v_donation_total_usd.fund_id, FUND))
  )[0]?.total;

describe("lifetime totals count settled donations only", () => {
  test("a refunded donation whose dist is still settled is in neither total", async () => {
    await gift("d-ok", 30, "settled");
    await gift("d-refunded", 70, "refunded");
    await gift("d-loss", 11, "refunded_loss");

    expect(await contributions()).toMatchObject({ total: 30, count: 1 });
    expect(await fund_total()).toBe(30);
  });

  test("a settled donation's settled dist still counts, and a refunded dist does not", async () => {
    await gift("d-ok", 30, "settled");
    await gift("d-ok-2", 5, "settled");
    await gift("d-dist-refunded", 9, "refunded", "refunded");

    expect(await contributions()).toMatchObject({ total: 35, count: 2 });
    expect(await fund_total()).toBe(35);
  });
});
