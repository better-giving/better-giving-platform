import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { TestDb } from "$/pg/test-utils/pglite";

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

const { seed_fund, seed_npo, seed_user } = await import(
  "#/__tests__/fixtures/funds"
);
const { user } = await import("$/pg/schema/auth");
const { campaigns } = await import("$/pg/schema/campaign");
const { funds } = await import("$/pg/schema/fund");
const { npos } = await import("$/pg/schema/npo");
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { loader } = await import("./api");

let npo_id: number;
let creator_id: string;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const db = () => test_db.current!.db;

beforeEach(async () => {
  const d = db();
  // campaigns reference funds/npos/user; fund_members and campaign_members
  // cascade from their parents
  await d.delete(campaigns);
  await d.delete(funds);
  await d.delete(npos);
  await d.delete(user);
  npo_id = (await seed_npo(d, { slug: "acme-org", published: true })).id;
  creator_id = (await seed_user(d, `creator-${npo_id}@test.com`)).id;
});

function load(fund_id: string, search = "") {
  return loader({
    request: new Request(`https://x/campaigns/${fund_id}${search}`),
    params: { fund_id },
  } as any);
}

async function migrated_fund(fund_slug: string) {
  const fund = await seed_fund(db(), {
    id: crypto.randomUUID(),
    slug: fund_slug,
    npo_owner: npo_id,
    creator_id,
    members: [npo_id],
  });
  await db()
    .insert(campaigns)
    .values({
      id: `camp-${fund.id}`,
      owner_npo_id: npo_id,
      creator_id,
      name: "Winter",
      slug: "winter",
      status: "live",
      legacy_fund_id: fund.id,
    });
  return fund;
}

describe("folded fund redirects", () => {
  it("301s a folded fund's id to its campaign page, keeping the query", async () => {
    const fund = await migrated_fund("owned-drive");

    const res = (await load(fund.id, "?amount=50").catch(
      (e: unknown) => e
    )) as Response;

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/org/acme-org/winter?amount=50");
  });

  it("301s a folded fund's slug to its campaign page, keeping the query", async () => {
    await migrated_fund("owned-drive");

    const res = (await load("owned-drive", "?ref=x").catch(
      (e: unknown) => e
    )) as Response;

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/org/acme-org/winter?ref=x");
  });

  it("still renders an unfolded fund", async () => {
    const fund = await seed_fund(db(), {
      id: crypto.randomUUID(),
      slug: "solo-drive",
      npo_owner: npo_id,
      creator_id,
      members: [npo_id],
    });

    const data = await load(fund.id);
    expect(data).not.toBeInstanceOf(Response);
    expect((data as { id: string }).id).toBe(fund.id);
  });

  it("keeps serving a fund whose campaign is still a draft (the campaign page would 404)", async () => {
    const fund = await seed_fund(db(), {
      id: crypto.randomUUID(),
      slug: "draft-drive",
      npo_owner: npo_id,
      creator_id,
      members: [npo_id],
    });
    await db()
      .insert(campaigns)
      .values({
        id: `camp-${fund.id}`,
        owner_npo_id: npo_id,
        creator_id,
        name: "Winter",
        slug: "winter",
        status: "draft",
        legacy_fund_id: fund.id,
      });

    const data = await load(fund.id);
    expect(data).not.toBeInstanceOf(Response);
    expect((data as { id: string }).id).toBe(fund.id);
  });

  it("keeps serving a multi-beneficiary folded fund (the campaign pays the owner alone)", async () => {
    const other = await seed_npo(db(), {
      registration_number: "EIN-OTHER",
      slug: "other-org",
      published: true,
    });
    const fund = await seed_fund(db(), {
      id: crypto.randomUUID(),
      slug: "shared-drive",
      npo_owner: npo_id,
      creator_id,
      members: [npo_id, other.id],
    });
    await db()
      .insert(campaigns)
      .values({
        id: `camp-${fund.id}`,
        owner_npo_id: npo_id,
        creator_id,
        name: "Winter",
        slug: "winter",
        status: "live",
        legacy_fund_id: fund.id,
      });

    const data = await load(fund.id);
    expect(data).not.toBeInstanceOf(Response);
    expect((data as { id: string }).id).toBe(fund.id);
  });

  it("keeps serving a folded fund when the owner npo is unpublished (campaign page would 404)", async () => {
    const hidden = await seed_npo(db(), {
      registration_number: "EIN-HIDDEN",
      slug: "hidden-org",
      published: false,
    });
    const creator = await seed_user(db(), `hidden-${hidden.id}@test.com`);
    const fund = await seed_fund(db(), {
      id: crypto.randomUUID(),
      slug: "hidden-drive",
      npo_owner: hidden.id,
      creator_id: creator.id,
      members: [hidden.id],
    });
    await db()
      .insert(campaigns)
      .values({
        id: `camp-${fund.id}`,
        owner_npo_id: hidden.id,
        creator_id: creator.id,
        name: "Winter",
        slug: "winter",
        status: "live",
        legacy_fund_id: fund.id,
      });

    const data = await load(fund.id);
    expect(data).not.toBeInstanceOf(Response);
    expect((data as { id: string }).id).toBe(fund.id);
  });

  it("keeps serving a folded fund when the owner npo is inactive (campaign page would 404)", async () => {
    const dormant = await seed_npo(db(), {
      registration_number: "EIN-DORMANT",
      slug: "dormant-org",
      published: true,
      active: false,
    });
    const creator = await seed_user(db(), `dormant-${dormant.id}@test.com`);
    const fund = await seed_fund(db(), {
      id: crypto.randomUUID(),
      slug: "dormant-drive",
      npo_owner: dormant.id,
      creator_id: creator.id,
      members: [dormant.id],
    });
    await db()
      .insert(campaigns)
      .values({
        id: `camp-${fund.id}`,
        owner_npo_id: dormant.id,
        creator_id: creator.id,
        name: "Winter",
        slug: "winter",
        status: "live",
        legacy_fund_id: fund.id,
      });

    const data = await load(fund.id);
    expect(data).not.toBeInstanceOf(Response);
    expect((data as { id: string }).id).toBe(fund.id);
  });

  it("redirects to the owner's numeric id when the org has no slug", async () => {
    const slugless = await seed_npo(db(), {
      registration_number: "EIN-NOSLUG",
      slug: null,
      published: true,
    });
    const fund = await seed_fund(db(), {
      id: crypto.randomUUID(),
      slug: "noslug-drive",
      npo_owner: slugless.id,
      creator_id,
      members: [slugless.id],
    });
    await db()
      .insert(campaigns)
      .values({
        id: `camp-${fund.id}`,
        owner_npo_id: slugless.id,
        creator_id,
        name: "Winter",
        slug: "winter",
        status: "live",
        legacy_fund_id: fund.id,
      });

    const res = (await load(fund.id).catch((e: unknown) => e)) as Response;
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/org/${slugless.id}/winter`);
  });
});
