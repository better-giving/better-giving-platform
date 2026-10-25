import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

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

import { user } from "../schema/auth";
import { campaigns } from "../schema/campaign";
import { donations } from "../schema/donation";
import { funds } from "../schema/fund";
import { npos } from "../schema/npo";
import { create_test_db } from "../test-utils/pglite";
import { campaign_delete } from "./campaign";

/** owner of every campaign under test */
let acme: number;
/** a second org, to prove ownership is enforced */
let other: number;

async function present(id: string): Promise<boolean> {
  const rows = await test_db
    .current!.db.select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, id));
  return rows.length > 0;
}

beforeAll(async () => {
  test_db.current = await create_test_db();
  const { db } = test_db.current;
  await db.insert(user).values({
    id: "user-del",
    name: "Ada Admin",
    email: "ada-del@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Ada",
    last_name: "Admin",
  });
  const orgs = await db
    .insert(npos)
    .values(
      (["acme", "other"] as const).map((slug) => ({
        registration_number: `EIN-DEL-${slug}`,
        name: slug,
        slug,
        endow_designation: "Charity" as const,
        overview_pt: "[]",
        hq_country: "United States",
        active: true,
        published: true,
      }))
    )
    .returning({ id: npos.id });
  [acme, other] = orgs.map((r) => r.id) as [number, number];

  // the legacy fund a folded campaign points back at
  await db.insert(funds).values({
    id: "fund-legacy",
    name: "Legacy fund",
    description_pt: "[]",
    banner: "",
    logo: "",
    creator_id: "user-del",
  });

  const campaign = (
    id: string,
    legacy_fund_id: string | null = null
  ): typeof campaigns.$inferInsert => ({
    id,
    owner_npo_id: acme,
    creator_id: "user-del",
    name: id,
    slug: id,
    legacy_fund_id,
  });
  await db
    .insert(campaigns)
    .values([
      campaign("plain"),
      campaign("folded", "fund-legacy"),
      campaign("with-gift"),
      campaign("owned-elsewhere"),
    ]);
  // a gift of its own keeps "with-gift" undeletable
  await db.insert(donations).values({
    id: "don-1",
    campaign_id: "with-gift",
    upusd: 1,
    status: "settled",
    amount_base: 10,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

describe("campaign_delete", () => {
  it("deletes a campaign with no gifts and no legacy fund", async () => {
    expect(await campaign_delete(acme, "plain")).toBe(true);
    expect(await present("plain")).toBe(false);
  });

  it("refuses a campaign folded from a legacy fund, leaving it in place", async () => {
    expect(await campaign_delete(acme, "folded")).toBe(false);
    expect(await present("folded")).toBe(true);
  });

  it("refuses a campaign that has its own gifts", async () => {
    expect(await campaign_delete(acme, "with-gift")).toBe(false);
    expect(await present("with-gift")).toBe(true);
  });

  it("refuses when another nonprofit owns it", async () => {
    expect(await campaign_delete(other, "owned-elsewhere")).toBe(false);
    expect(await present("owned-elsewhere")).toBe(true);
  });
});
