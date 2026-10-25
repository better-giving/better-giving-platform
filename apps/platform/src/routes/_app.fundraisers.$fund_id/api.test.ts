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
    request: new Request(`https://x/fundraisers/${fund_id}${search}`),
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
});
