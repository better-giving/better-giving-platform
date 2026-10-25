import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { TestDb } from "./test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

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

const { user } = await import("./schema/auth");
const { campaign_members, campaigns } = await import("./schema/campaign");
const { dists } = await import("./schema/dist");
const { donations } = await import("./schema/donation");
const { fund_members, funds } = await import("./schema/fund");
const { npos } = await import("./schema/npo");
const { user_npo_memberships } = await import("./schema/user");
const { v_campaign_total_usd, v_donation_total_usd } = await import(
  "./schema/views"
);
const { create_test_db } = await import("./test-utils/pglite");
const { backfill_campaign_funds } = await import("./backfill-campaign-funds");

const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(campaign_members);
  await db().delete(campaigns);
  await db().delete(fund_members);
  await db().delete(funds);
  await db().delete(user_npo_memberships);
  await db().delete(npos);
  await db().delete(user);
});

let counter = 0;
async function npo(slug?: string) {
  counter++;
  const [row] = await db()
    .insert(npos)
    .values({
      registration_number: `EIN-BF-${counter}`,
      name: `Org ${counter}`,
      slug: slug ?? null,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: true,
      active: true,
    })
    .returning();
  return row!;
}

async function member(npo_id: number) {
  counter++;
  const id = `u-${counter}`;
  await db()
    .insert(user)
    .values({
      id,
      name: "Cam Creator",
      email: `${id}@test.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      first_name: "Cam",
      last_name: "Creator",
    });
  await db().insert(user_npo_memberships).values({ user_id: id, npo_id });
  return id;
}

/** a settled dist (counted) or a non-settled contribution (not counted) on the
 * fund. a pending gift lands as a donation with no dist */
async function gift(
  fund_id: string,
  to_id: number,
  net: number,
  settled: boolean
) {
  counter++;
  const donation_id = `d-${counter}`;
  await db()
    .insert(donations)
    .values({
      id: donation_id,
      upusd: 1,
      status: settled ? "settled" : "intent",
      amount_base: net,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
    });
  if (settled) {
    await db()
      .insert(dists)
      .values({
        id: `dist-${counter}`,
        donation_id,
        status: "settled",
        date_created: new Date().toISOString(),
        to_id,
        amount_denom: "USD",
        net,
        fund_id,
      });
  }
}

/** an org fund with two beneficiaries, a settled gift, a pending gift, a target */
async function seed_org_fund() {
  const org = await npo("org-slug");
  const partner = await npo("partner-slug");
  const creator = await member(org.id);
  const fund = (
    await db()
      .insert(funds)
      .values({
        id: "fund-owned",
        name: "Owned drive",
        slug: "owned-drive",
        description_pt: "[]",
        description_v2: "owned",
        banner: "https://img.co/banner.png",
        logo: "https://img.co/logo.png",
        videos: ["https://youtu.be/a"],
        published: true,
        active: true,
        fund_donate_methods: ["stripe"],
        target_number: 1000,
        hide_bg_tip: true,
        npo_owner: org.id,
        creator_id: creator,
      })
      .returning()
  )[0]!;
  await db()
    .insert(fund_members)
    .values([
      { fund_id: fund.id, npo_id: org.id, position: 0 },
      { fund_id: fund.id, npo_id: partner.id, position: 1 },
    ]);
  await gift(fund.id, org.id, 7.5, true);
  await gift(fund.id, org.id, 3, false); // pending: not counted
  return { org, partner, fund };
}

describe("backfill org funds into campaigns", () => {
  it("dry-run counts what it would create and writes nothing", async () => {
    await seed_org_fund();

    const counts = await backfill_campaign_funds({ dry_run: true });

    // the recorded dry-run counts for a seeded db
    console.info(`[bg1943 dry-run] ${JSON.stringify(counts)}`);
    expect(counts).toEqual({
      org_funds: 1,
      already_migrated: 0,
      campaigns_created: 1,
      members_copied: 2,
    });
    expect(await db().select().from(campaigns)).toHaveLength(0);
  });

  it("folds an org fund into one campaign with both members, and is idempotent", async () => {
    const { org, partner, fund } = await seed_org_fund();

    const first = await backfill_campaign_funds();
    expect(first.campaigns_created).toBe(1);
    expect(first.members_copied).toBe(2);

    const [campaign] = await db()
      .select()
      .from(campaigns)
      .where(eq(campaigns.legacy_fund_id, fund.id));
    expect(campaign).toBeDefined();
    expect(campaign!.owner_npo_id).toBe(org.id);
    expect(campaign!.slug).toBe("owned-drive");
    expect(campaign!.name).toBe("Owned drive");
    expect(campaign!.status).toBe("live");
    expect(campaign!.target_number).toBe(1000);
    expect(campaign!.hide_bg_tip).toBe(true);
    expect(campaign!.videos).toEqual(["https://youtu.be/a"]);

    const members = await db()
      .select()
      .from(campaign_members)
      .where(eq(campaign_members.campaign_id, campaign!.id));
    expect(members.map((m) => m.npo_id).sort((a, b) => a - b)).toEqual(
      [org.id, partner.id].sort((a, b) => a - b)
    );

    // a second run creates nothing new
    const second = await backfill_campaign_funds();
    expect(second).toMatchObject({
      org_funds: 1,
      already_migrated: 1,
      campaigns_created: 0,
      members_copied: 0,
    });
    expect(await db().select().from(campaigns)).toHaveLength(1);
  });

  it("gives the migrated campaign the fund's settled total, net of fees", async () => {
    const { fund } = await seed_org_fund();
    await backfill_campaign_funds();

    const [campaign] = await db()
      .select()
      .from(campaigns)
      .where(eq(campaigns.legacy_fund_id, fund.id));

    const [fund_total] = await db()
      .select()
      .from(v_donation_total_usd)
      .where(eq(v_donation_total_usd.fund_id, fund.id));
    const [campaign_total] = await db()
      .select()
      .from(v_campaign_total_usd)
      .where(eq(v_campaign_total_usd.campaign_id, campaign!.id));

    // settled only, net of fees: the pending gift of 3 is excluded
    expect(fund_total!.total ?? 0).toBeCloseTo(7.5, 2);
    expect(campaign_total!.total ?? 0).toBeCloseTo(fund_total!.total ?? 0, 2);
  });

  it("leaves a fund whose creator never joined the owning org alone", async () => {
    const org = await npo("lonely-org");
    // an outsider creates a fund naming the org as owner, but never joined it
    counter += 1;
    const outsider = `outsider-${counter}`;
    await db()
      .insert(user)
      .values({
        id: outsider,
        name: "Out Sider",
        email: `${outsider}@test.com`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        first_name: "Out",
        last_name: "Sider",
      });
    await db().insert(funds).values({
      id: "fund-outsider",
      name: "Outsider drive",
      slug: "outsider-drive",
      description_pt: "[]",
      banner: "https://img.co/b.png",
      logo: "https://img.co/l.png",
      npo_owner: org.id,
      creator_id: outsider,
    });

    const counts = await backfill_campaign_funds();
    expect(counts.org_funds).toBe(0);
    expect(counts.campaigns_created).toBe(0);
  });
});
