import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { seed_fund } from "#/__tests__/fixtures/funds";
import { user } from "$/pg/schema/auth";
import { fund_members, funds } from "$/pg/schema/fund";
import { npos } from "$/pg/schema/npo";
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

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({ user_ctx: true })
);

vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return { redirectWithSuccess: (url: string) => redirect(url) };
});

const { admin_ctx, user_ctx } = await import("$/auth/test-utils");
const { campaign_members, campaigns } = await import("$/pg/schema/campaign");
const { campaign_update } = await import("$/pg/queries/campaign");
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { loader: list_loader } = await import("./api");
const { action: create_action } = await import(
  "../admin.$id.campaigns_.new/api"
);
const { action: edit_action, loader: edit_loader } = await import(
  "../admin.$id.campaigns_.$campaign_id/api"
);

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  const db = test_db.current!.db;
  await db.delete(fund_members);
  await db.delete(funds);
  await db.delete(campaign_members);
  await db.delete(campaigns);
  await db.delete(npos);
  await db.delete(user);
  await db.insert(user).values({
    id: USER,
    name: "Ada Admin",
    email: "ada-admin-campaign@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Ada",
    last_name: "Admin",
  });
});

const db = () => test_db.current!.db;

async function npo(ein: string, slug?: string) {
  const [row] = await db()
    .insert(npos)
    .values({
      registration_number: ein,
      name: ein,
      slug: slug ?? null,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  return row!;
}

function ctx(npo_id: number) {
  const context = new RouterContextProvider();
  context.set(admin_ctx, npo_id);
  context.set(user_ctx, { id: USER });
  return context;
}

function body(slug: string, op: "save" | "publish" = "save") {
  return {
    name: "Winter drive",
    slug,
    description_pt: "[]",
    donate_methods: ["stripe"],
    donate_frequencies: ["one-time"],
    target: "0",
    op,
  };
}

function post(npo_id: number, payload: unknown, campaign_id = "new") {
  return new Request(`https://x/admin/${npo_id}/campaigns/${campaign_id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function outcome(res: unknown) {
  if (res instanceof Response) {
    return {
      status: res.status,
      location: res.headers.get("Location"),
      error: undefined as string | undefined,
      field: undefined as string | undefined,
    };
  }
  const r = res as {
    data?: { error?: string; field?: string };
    init?: { status?: number };
  };
  return {
    status: r.init?.status ?? 200,
    location: null as string | null,
    error: r.data?.error,
    field: r.data?.field,
  };
}

async function thrown_status(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(Response);
    return (err as Response).status;
  }
  expect.fail("expected a thrown response");
}

describe("another nonprofit's campaign", () => {
  async function foreign() {
    const mine = await npo("EIN-A", "org-a");
    const theirs = await npo("EIN-B", "org-b");
    await db().insert(campaigns).values({
      id: "camp-b",
      owner_npo_id: theirs.id,
      creator_id: USER,
      name: "Theirs",
      slug: "theirs",
    });
    await db().insert(campaign_members).values({
      campaign_id: "camp-b",
      npo_id: theirs.id,
    });
    return mine;
  }

  it("404s the editor loader", async () => {
    const mine = await foreign();
    const status = await thrown_status(
      edit_loader({
        request: new Request("https://x/admin/a/campaigns/camp-b"),
        params: { id: String(mine.id), campaign_id: "camp-b" },
        context: ctx(mine.id),
      } as any)
    );
    expect(status).toBe(404);
  });

  it.each([
    ["save", body("theirs", "save")],
    ["publish", body("theirs", "publish")],
    ["end", { op: "end" }],
    ["delete", { op: "delete" }],
  ] as const)("404s %s", async (op, payload) => {
    const mine = await foreign();
    const status = await thrown_status(
      edit_action({
        request: post(mine.id, payload, "camp-b"),
        params: { id: String(mine.id), campaign_id: "camp-b" },
        context: ctx(mine.id),
      } as any)
    );
    expect(op).toBeTruthy();
    expect(status).toBe(404);
  });
});

describe("campaign slug", () => {
  it("refuses to create one before the organization has a slug", async () => {
    const org = await npo("EIN-NOSLUG");
    const res = outcome(
      await create_action({
        request: post(org.id, body("winter")),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    expect(res.status).toBe(400);
    expect(res.error).toBe(
      "Set your profile link on Organization before creating a campaign."
    );
  });

  it("refuses a slug another campaign of this nonprofit already uses", async () => {
    const org = await npo("EIN-TAKEN", "taken-org");
    const first = outcome(
      await create_action({
        request: post(org.id, body("Winter")),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    expect(first.status).toBe(302);
    const second = outcome(
      await create_action({
        request: post(org.id, body("winter")),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    expect(second.status).toBe(400);
    expect(second.error).toBe("That link is already used by another campaign.");
    expect(second.field).toBe("slug");
  });

  it("lets the slug change until the first publish, then refuses", async () => {
    const org = await npo("EIN-LOCK", "lock-org");
    const created = outcome(
      await create_action({
        request: post(org.id, body("draft-slug")),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    expect(created.status).toBe(302);
    const campaign_id = created.location!.split("/").pop()!;

    const renamed = outcome(
      await edit_action({
        request: post(org.id, body("open-slug"), campaign_id),
        params: { id: String(org.id), campaign_id },
        context: ctx(org.id),
      } as any)
    );
    expect(renamed.status).toBe(302);
    const [row] = await db()
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign_id));
    expect(row?.slug).toBe("open-slug");
    expect(row?.published_at).toBeNull();

    const published = outcome(
      await edit_action({
        request: post(org.id, body("open-slug", "publish"), campaign_id),
        params: { id: String(org.id), campaign_id },
        context: ctx(org.id),
      } as any)
    );
    expect(published.status).toBe(302);

    const locked = outcome(
      await edit_action({
        request: post(org.id, body("changed", "save"), campaign_id),
        params: { id: String(org.id), campaign_id },
        context: ctx(org.id),
      } as any)
    );
    expect(locked.status).toBe(400);
    expect(locked.error).toBe(
      "This link is fixed because the campaign is published."
    );
    expect(locked.field).toBe("slug");
    const [after] = await db()
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign_id));
    expect(after?.slug).toBe("open-slug");
    expect(after?.status).toBe("live");
  });

  it("keeps a published address when the write lands after publish", async () => {
    const org = await npo("EIN-RACE", "race-org");
    const created = outcome(
      await create_action({
        request: post(org.id, body("first-slug")),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    const campaign_id = created.location!.split("/").pop()!;
    await db()
      .update(campaigns)
      .set({
        status: "live",
        published_at: new Date().toISOString(),
      })
      .where(eq(campaigns.id, campaign_id));
    const wrote = await campaign_update(org.id, campaign_id, {
      slug: "after-publish",
      name: "Still the same address",
    });
    expect(wrote).toBe("slug_locked");
    const [row] = await db()
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign_id));
    expect(row?.slug).toBe("first-slug");
    expect(row?.name).toBe("Winter drive");
  });

  it("stores the organization's tip setting", async () => {
    const org = await npo("EIN-TIP", "tip-org");
    await db()
      .update(npos)
      .set({ hide_bg_tip: true })
      .where(eq(npos.id, org.id));
    const created = outcome(
      await create_action({
        request: post(org.id, { ...body("tipped"), hide_bg_tip: false }),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    expect(created.status).toBe(302);
    const campaign_id = created.location!.split("/").pop()!;
    const [row] = await db()
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaign_id));
    expect(row?.hide_bg_tip).toBe(true);
  });

  it("names the field a refusal belongs on, and leaves an ended publish unnamed", async () => {
    const org = await npo("EIN-FIELD", "field-org");
    const missing = outcome(
      await create_action({
        request: post(org.id, {
          ...body("field-slug"),
          program_id: "11111111-1111-4111-8111-111111111111",
        }),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    expect(missing.status).toBe(400);
    expect(missing.error).toBe("That program is not on this nonprofit.");
    expect(missing.field).toBe("program_id");

    const blank = outcome(
      await create_action({
        request: post(org.id, { ...body("field-slug"), name: "" }),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    expect(blank.status).toBe(400);
    expect(blank.error).toBe("Enter a name.");
    expect(blank.field).toBe("name");

    const created = outcome(
      await create_action({
        request: post(org.id, body("field-slug", "publish")),
        params: { id: String(org.id) },
        context: ctx(org.id),
      } as any)
    );
    expect(created.status).toBe(302);
    const campaign_id = created.location!.split("/").pop()!;
    const ended = outcome(
      await edit_action({
        request: post(org.id, { op: "end" }, campaign_id),
        params: { id: String(org.id), campaign_id },
        context: ctx(org.id),
      } as any)
    );
    expect(ended.status).toBe(302);
    const again = outcome(
      await edit_action({
        request: post(org.id, body("field-slug", "publish"), campaign_id),
        params: { id: String(org.id), campaign_id },
        context: ctx(org.id),
      } as any)
    );
    expect(again.status).toBe(400);
    expect(again.error).toBe("An ended campaign stays ended.");
    expect(again.field).toBeUndefined();
  });
});

describe("campaign list loader", () => {
  it("lists real campaigns and unfolded org funds on Your campaigns, supporter funds on the other tab", async () => {
    const org = await npo("EIN-LIST", "list-org");
    await db().insert(campaigns).values({
      id: "camp-real",
      owner_npo_id: org.id,
      creator_id: USER,
      name: "Real drive",
      slug: "real-drive",
      status: "live",
    });
    await db()
      .insert(campaign_members)
      .values({ campaign_id: "camp-real", npo_id: org.id });
    // an org fund not yet folded still lists on the campaigns tab as its own row
    // (the backfill is gated), so it never vanishes
    await seed_fund(db(), {
      id: "fund-owned",
      name: "Owned drive",
      npo_owner: org.id,
      creator_id: USER,
    });
    // an org fund already folded into a campaign lives on as that campaign, so
    // it is dropped from the fund list and not shown twice
    await seed_fund(db(), {
      id: "fund-folded",
      name: "Folded drive",
      npo_owner: org.id,
      creator_id: USER,
    });
    await db().insert(campaigns).values({
      id: "camp-folded",
      owner_npo_id: org.id,
      creator_id: USER,
      name: "Folded drive",
      slug: "folded-drive",
      status: "live",
      legacy_fund_id: "fund-folded",
    });
    // a folded fund with several beneficiaries keeps its fund flow and editor,
    // so it stays listed with its fund row
    const partner = await npo("EIN-LIST-2", "list-partner");
    await seed_fund(db(), {
      id: "fund-multi",
      name: "Shared drive",
      npo_owner: org.id,
      creator_id: USER,
      members: [org.id, partner.id],
    });
    await db().insert(campaigns).values({
      id: "camp-multi",
      owner_npo_id: org.id,
      creator_id: USER,
      name: "Shared drive",
      slug: "shared-drive",
      status: "live",
      legacy_fund_id: "fund-multi",
    });
    await seed_fund(db(), {
      id: "fund-supporter",
      name: "Supporter drive",
      npo_owner: null,
      creator_id: USER,
      members: [org.id],
    });
    const args = {
      params: { id: String(org.id) },
      context: ctx(org.id),
    };
    const data = await list_loader({
      request: new Request("https://x/admin/list/campaigns"),
      ...args,
    } as any);
    if (data.view !== "campaigns")
      throw new Error("expected the campaigns tab");
    expect(data.campaigns.map((c) => c.id).sort()).toEqual([
      "camp-folded",
      "camp-multi",
      "camp-real",
    ]);
    // the unfolded and multi-beneficiary org funds list; the single-beneficiary
    // fold is excluded (it is a campaign)
    expect(data.org_funds.map((f) => f.id).sort()).toEqual([
      "fund-multi",
      "fund-owned",
    ]);

    const tab = await list_loader({
      request: new Request("https://x/admin/list/campaigns?tab=fundraisers"),
      ...args,
    } as any);
    if (tab.view !== "fundraisers")
      throw new Error("expected the fundraisers tab");
    expect(tab.funds.map((f) => f.id)).toEqual(["fund-supporter"]);

    // the tab is others-only; a stale ?creator= from an old link is ignored
    const stale = await list_loader({
      request: new Request(
        "https://x/admin/list/campaigns?tab=fundraisers&creator=ours"
      ),
      ...args,
    } as any);
    if (stale.view !== "fundraisers") {
      throw new Error("expected the fundraisers tab");
    }
    expect(stale.funds.map((f) => f.id)).toEqual(["fund-supporter"]);

    const unknown = await list_loader({
      request: new Request("https://x/admin/list/campaigns?tab=nope"),
      ...args,
    } as any);
    expect(unknown.view).toBe("campaigns");
  });
});
