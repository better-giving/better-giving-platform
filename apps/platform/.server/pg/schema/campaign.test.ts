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

const { user } = await import("./auth");
const { campaign_members, campaigns } = await import("./campaign");
const { npos } = await import("./npo");
const { campaign_create } = await import("../queries/campaign");
const { create_test_db } = await import("../test-utils/pglite");

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  const db = test_db.current!.db;
  await db.delete(campaign_members);
  await db.delete(campaigns);
  await db.delete(npos);
  await db.delete(user);
  await db.insert(user).values({
    id: USER,
    name: "Ada Admin",
    email: "ada-campaign@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Ada",
    last_name: "Admin",
  });
});

const db = () => test_db.current!.db;

async function npo(ein: string) {
  const [row] = await db()
    .insert(npos)
    .values({
      registration_number: ein,
      name: ein,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  return row!;
}

function chain(err: unknown) {
  const parts: string[] = [];
  let cur: any = err;
  for (let i = 0; i < 6 && cur; i++) {
    parts.push(String(cur.message ?? ""), String(cur.constraint ?? ""));
    cur = cur.cause;
  }
  return parts.join(" ");
}

async function rejects(p: Promise<unknown>, needle: string) {
  try {
    await p;
  } catch (err) {
    expect(chain(err)).toContain(needle);
    return;
  }
  expect.fail(`expected a failure containing ${needle}`);
}

describe("campaigns constraints", () => {
  it("requires exactly one owner", async () => {
    const org = await npo("EIN-XOR");
    await rejects(
      db().insert(campaigns).values({
        id: "c-none",
        creator_id: USER,
        name: "None",
        slug: "none",
      }),
      "owner_xor"
    );
    await rejects(
      db().insert(campaigns).values({
        id: "c-both",
        owner_npo_id: org.id,
        owner_user_id: USER,
        creator_id: USER,
        name: "Both",
        slug: "both",
      }),
      "owner_xor"
    );
    await db().insert(campaigns).values({
      id: "c-user",
      owner_user_id: USER,
      creator_id: USER,
      name: "Mine",
      slug: "mine",
    });
    const [row] = await db()
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, "c-user"));
    expect(row?.owner_user_id).toBe(USER);
    expect(row?.owner_npo_id).toBeNull();
  });

  it("keeps a slug unique per nonprofit, case-insensitively", async () => {
    const a = await npo("EIN-SLUG-A");
    const b = await npo("EIN-SLUG-B");
    await db().insert(campaigns).values({
      id: "c-a",
      owner_npo_id: a.id,
      creator_id: USER,
      name: "Winter",
      slug: "Winter",
    });
    await db().insert(campaigns).values({
      id: "c-b",
      owner_npo_id: b.id,
      creator_id: USER,
      name: "Winter",
      slug: "Winter",
    });
    await rejects(
      db().insert(campaigns).values({
        id: "c-a2",
        owner_npo_id: a.id,
        creator_id: USER,
        name: "winter",
        slug: "winter",
      }),
      "campaigns_owner_npo_slug_idx"
    );
  });

  it("seeds the owner as the member and accepts further beneficiaries", async () => {
    const org = await npo("EIN-MEM");
    const other = await npo("EIN-MEM-2");
    await campaign_create({
      id: "c-own",
      owner_npo_id: org.id,
      creator_id: USER,
      name: "Owned",
      slug: "owned",
      campaign_type: null,
      description_pt: "[]",
      banner: null,
      logo: null,
      videos: [],
      ends_at: null,
      donate_methods: ["stripe"],
      donate_frequencies: ["one-time"],
      increments: [],
      target: "0",
      hide_bg_tip: false,
      program_id: null,
      program_name: null,
    });
    const members = await db()
      .select()
      .from(campaign_members)
      .where(eq(campaign_members.campaign_id, "c-own"));
    expect(members.map((m) => m.npo_id)).toEqual([org.id]);

    // BG-1943 decision 6: a campaign folded from an org fund keeps the fund's
    // several beneficiaries, so 0070 dropped 0067's one-member/owner-only guard
    await db()
      .insert(campaign_members)
      .values({ campaign_id: "c-own", npo_id: other.id });
    const after = await db()
      .select()
      .from(campaign_members)
      .where(eq(campaign_members.campaign_id, "c-own"));
    expect(after.map((m) => m.npo_id).sort((a, b) => a - b)).toEqual(
      [org.id, other.id].sort((a, b) => a - b)
    );

    // the same nonprofit twice on one campaign is still the primary key's job
    await rejects(
      db().insert(campaign_members).values({
        campaign_id: "c-own",
        npo_id: org.id,
      }),
      "campaign_members_campaign_id_npo_id_pk"
    );
  });
});
