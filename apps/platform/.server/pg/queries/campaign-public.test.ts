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
import { campaign_members, campaigns } from "../schema/campaign";
import { npos } from "../schema/npo";
import { create_test_db } from "../test-utils/pglite";
import { campaign_public } from "./campaign";

/** owner with a slug */
let acme: number;
/** owner with no slug */
let bare: number;

beforeAll(async () => {
  test_db.current = await create_test_db();
  const { db } = test_db.current;
  await db.insert(user).values({
    id: "user-pub",
    name: "Ada Admin",
    email: "ada-pub@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Ada",
    last_name: "Admin",
  });
  const rows = await db
    .insert(npos)
    .values(
      (["acme", null] as const).map((slug) => ({
        registration_number: `EIN-PUB-${slug ?? "bare"}`,
        name: slug ?? "Bare",
        slug,
        endow_designation: "Charity" as const,
        overview_pt: "[]",
        hq_country: "United States",
        active: true,
        published: true,
      }))
    )
    .returning({ id: npos.id });
  [acme, bare] = rows.map((r) => r.id) as [number, number];

  const campaign = (
    id: string,
    owner_npo_id: number,
    slug: string,
    status: "draft" | "live" = "live"
  ): typeof campaigns.$inferInsert => ({
    id,
    owner_npo_id,
    creator_id: "user-pub",
    name: id,
    slug,
    status,
  });
  await db
    .insert(campaigns)
    .values([
      campaign("acme-spring", acme, "spring"),
      campaign("acme-draft", acme, "plans", "draft"),
      campaign("bare-winter", bare, "winter"),
      campaign("bare-draft", bare, "plans", "draft"),
    ]);
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

describe("campaign_public", () => {
  it("finds a slugless owner's campaign by the owner's id", async () => {
    const row = await campaign_public(String(bare), "Winter");
    expect([row?.id, row?.owner_slug]).toStrictEqual(["bare-winter", null]);
  });

  it("finds a campaign by its owner's id when the owner has a slug", async () => {
    const row = await campaign_public(String(acme), "spring");
    expect([row?.id, row?.owner_slug]).toStrictEqual(["acme-spring", "acme"]);
  });

  it("matches the owner's slug case-insensitively", async () => {
    const row = await campaign_public("ACME", "SPRING");
    expect(row?.id).toBe("acme-spring");
  });

  it("finds nothing under another owner's id", async () => {
    expect(await campaign_public(String(acme), "winter")).toBeUndefined();
  });

  it("keeps a draft absent by id and by slug", async () => {
    expect(await campaign_public(String(bare), "plans")).toBeUndefined();
    expect(await campaign_public("acme", "plans")).toBeUndefined();
  });

  it("finds nothing for an id past the integer range", async () => {
    expect(await campaign_public("99999999999", "winter")).toBeUndefined();
  });
});

// BG-1943 decision 6: 0070 dropped the one-member/owner-only guard, so a
// campaign folded from an org fund carries its several beneficiaries
describe("campaign_members", () => {
  it("accepts the owner and another org as beneficiaries", async () => {
    const { db } = test_db.current!;
    await db
      .insert(campaign_members)
      .values({ campaign_id: "acme-spring", npo_id: acme });
    await db
      .insert(campaign_members)
      .values({ campaign_id: "acme-spring", npo_id: bare });
    const rows = await db
      .select()
      .from(campaign_members)
      .where(eq(campaign_members.campaign_id, "acme-spring"));
    expect(rows.map((r) => r.npo_id).sort((a, b) => a - b)).toEqual(
      [acme, bare].sort((a, b) => a - b)
    );
  });
});
