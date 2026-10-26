import { eq } from "drizzle-orm";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { seed_fund, seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { exchange_code, issue_code } from "$/connector/keys";
import { campaign_status } from "$/connector/reads";
import { campaign_get } from "$/pg/queries/campaign";
import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import { bal_txs } from "$/pg/schema/bal-tx";
import { campaign_members, campaigns } from "$/pg/schema/campaign";
import {
  connector_codes,
  connector_idempotency,
  connector_keys,
} from "$/pg/schema/connector";
import { donation_disputes } from "$/pg/schema/dispute";
import { dists } from "$/pg/schema/dist";
import {
  donation_donors,
  donation_recipients,
  donations,
} from "$/pg/schema/donation";
import { forms } from "$/pg/schema/form";
import { funds } from "$/pg/schema/fund";
import { npos } from "$/pg/schema/npo";
import { subscriptions } from "$/pg/schema/subscription";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";
import { create_test_db } from "$/pg/test-utils/pglite";
import { loader as catalog_loader } from "./connector.v1.blocks.catalog";
import {
  action as campaigns_action,
  loader as campaigns_loader,
} from "./connector.v1.campaigns";
import { loader as campaign_loader } from "./connector.v1.campaigns.$id";
import { loader as page_loader } from "./connector.v1.donation-page";
import { loader as donations_loader } from "./connector.v1.donations";
import { loader as donors_loader } from "./connector.v1.donors";
import { loader as donor_loader } from "./connector.v1.donors.$id";
import { loader as forms_loader } from "./connector.v1.forms";
import { loader as form_loader } from "./connector.v1.forms.$id";
import { loader as recurring_loader } from "./connector.v1.recurring";
import { loader as results_loader } from "./connector.v1.results";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("$/pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

const db = () => test_db.current!.db;
const as_db = (x: unknown) => x as DbOrTx;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  reset_rate_limits();
  await db().delete(donation_disputes);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(subscriptions);
  await db().delete(forms);
  await db().delete(campaign_members);
  await db().delete(campaigns);
  await db().delete(funds);
  await db().delete(connector_idempotency);
  await db().delete(connector_keys);
  await db().delete(connector_codes);
  await db().delete(user_npo_memberships);
  await db().delete(bal_txs);
  await db().delete(npos);
  await db().delete(user);
});

type Call = {
  request: Request;
  params: Record<string, string>;
  context: Record<string, never>;
  url: URL;
  pattern: string;
};

const call = (
  path: string,
  init: RequestInit = {},
  params: Record<string, string> = {}
): Call => {
  const request = new Request(`https://bg.test${path}`, init);
  return {
    request,
    params,
    context: {},
    url: new URL(request.url),
    pattern: path.split("?")[0] ?? path,
  };
};

const auth = (key?: string, extra?: Record<string, string>) => {
  const headers = new Headers(extra);
  if (key) headers.set("authorization", `Bearer ${key}`);
  return headers;
};

const get = (
  loader: (args: LoaderFunctionArgs) => Promise<Response> | Response,
  path: string,
  key?: string,
  params: Record<string, string> = {}
) =>
  loader(
    call(path, { headers: auth(key) }, params) as unknown as LoaderFunctionArgs
  ) as Promise<Response>;

const post = (
  action: (args: ActionFunctionArgs) => Promise<Response> | Response,
  path: string,
  key: string,
  body: unknown,
  idem?: string
) =>
  action(
    call(path, {
      method: "POST",
      headers: auth(key, {
        "content-type": "application/json",
        ...(idem ? { "idempotency-key": idem } : {}),
      }),
      body: JSON.stringify(body),
    }) as unknown as ActionFunctionArgs
  ) as Promise<Response>;

async function mint(npo_id: number, user_id: string) {
  const issued = await issue_code(as_db(db()), {
    npo_id,
    allowed_by: user_id,
    iss: "https://zap.example",
  });
  const exchanged = await exchange_code(as_db(db()), issued.code);
  if (!exchanged.ok) throw new Error("exchange failed");
  return exchanged.key;
}

async function pair(name: string, ein: string, email: string) {
  const npo = (await seed_npo(db(), {
    name,
    registration_number: ein,
  }))!;
  const owner = (await seed_user(db(), email, name, "Owner"))!;
  await db().insert(user_npo_memberships).values({
    user_id: owner.id,
    npo_id: npo.id,
  });
  const key = await mint(npo.id, owner.id);
  return { npo, owner, key };
}

async function insert_campaign(vals: {
  id: string;
  npo_id: number;
  creator_id: string;
  name?: string;
  slug?: string;
  status?: "draft" | "live" | "ended";
  ends_at?: string | null;
  target_number?: number | null;
  banner?: string | null;
}) {
  await db()
    .insert(campaigns)
    .values({
      id: vals.id,
      owner_npo_id: vals.npo_id,
      creator_id: vals.creator_id,
      name: vals.name ?? "Campaign",
      slug: vals.slug ?? vals.id,
      description_pt: "A story",
      banner: vals.banner ?? null,
      status: vals.status ?? "draft",
      ends_at: vals.ends_at ?? null,
      target_number: vals.target_number ?? null,
    });
  await db().insert(campaign_members).values({
    campaign_id: vals.id,
    npo_id: vals.npo_id,
    position: 0,
  });
}

async function insert_gift(vals: {
  id: string;
  npo_id?: number;
  fund_id?: string;
  campaign_id?: string;
  email: string;
  name?: string;
  amount: number;
  upusd?: number;
  currency?: string;
  status?: string;
  source?: string;
  via?: string;
  created_at: string;
  frequency?: string;
}) {
  await db()
    .insert(donations)
    .values({
      id: vals.id,
      upusd: vals.upusd ?? 1,
      status: vals.status ?? "settled",
      amount_base: vals.amount,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: vals.currency ?? "USD",
      frequency: vals.frequency ?? "one-time",
      source: vals.source ?? "bg-marketplace",
      via: vals.via ?? "stripe:card",
      campaign_id: vals.campaign_id ?? null,
      created_at: vals.created_at,
      updated_at: vals.created_at,
    });
  await db()
    .insert(donation_recipients)
    .values({
      donation_id: vals.id,
      npo_id: vals.fund_id ? null : vals.npo_id,
      fund_id: vals.fund_id ?? null,
      name: "Recipient",
      type: vals.fund_id ? "fund" : "npo",
    });
  await db()
    .insert(donation_donors)
    .values({
      donation_id: vals.id,
      email: vals.email,
      name: vals.name ?? "Donor",
    });
}

describe("campaign reads", () => {
  test("a live campaign stays open until noon UTC the day after it ends", () => {
    const ends = "2026-10-21T00:00:00.000Z";
    expect(
      campaign_status("live", ends, Date.parse("2026-10-22T11:00:00.000Z"))
    ).toBe("published");
    expect(
      campaign_status("live", ends, Date.parse("2026-10-22T12:00:00.000Z"))
    ).toBe("ended");
    expect(campaign_status("draft", "2020-01-01T00:00:00.000Z")).toBe("draft");
    expect(campaign_status("ended", null)).toBe("ended");
  });

  test("lists current campaigns, and a live one is open through the day it ends", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    await db().update(npos).set({ slug: "alpha" }).where(eq(npos.id, a.npo.id));
    const today = new Date().toISOString().slice(0, 10);
    await insert_campaign({
      id: "ended-one",
      name: "Ended",
      npo_id: a.npo.id,
      creator_id: a.owner.id,
      status: "ended",
      slug: "ended-one",
    });
    await insert_campaign({
      id: "expired-live",
      name: "Expired live",
      npo_id: a.npo.id,
      creator_id: a.owner.id,
      status: "live",
      ends_at: "2020-06-01T00:00:00.000Z",
      slug: "expired-live",
    });
    await insert_campaign({
      id: "draft-one",
      name: "Draft",
      npo_id: a.npo.id,
      creator_id: a.owner.id,
      status: "draft",
      ends_at: "2020-01-15T00:00:00.000Z",
      slug: "draft-one",
    });
    await insert_campaign({
      id: "live-one",
      name: "Live",
      npo_id: a.npo.id,
      creator_id: a.owner.id,
      status: "live",
      target_number: 1000,
      slug: "live-one",
    });
    await insert_campaign({
      id: "closes-today",
      name: "Closes today",
      npo_id: a.npo.id,
      creator_id: a.owner.id,
      status: "live",
      ends_at: `${today}T00:00:00.000Z`,
      slug: "closes-today",
    });
    await insert_campaign({
      id: "other-live",
      name: "Other",
      npo_id: b.npo.id,
      creator_id: b.owner.id,
      status: "live",
      slug: "other-live",
    });

    const list = await get(campaigns_loader, "/connector/v1/campaigns", a.key);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      data: {
        id: string;
        status: string;
        public_url: string | null;
        goal: { amount: string; currency: string } | null;
      }[];
      next_cursor: string | null;
    };
    const by_id = Object.fromEntries(body.data.map((row) => [row.id, row]));
    expect(by_id["ended-one"]?.status).toBe("ended");
    expect(by_id["expired-live"]?.status).toBe("ended");
    expect(by_id["draft-one"]?.status).toBe("draft");
    expect(by_id["live-one"]?.status).toBe("published");
    expect(by_id["closes-today"]?.status).toBe("published");
    expect(by_id["other-live"]).toBeUndefined();
    expect(by_id["draft-one"]?.public_url).toBeNull();
    expect(by_id["ended-one"]?.public_url).toBe(
      "http://localhost:4200/org/alpha/ended-one"
    );
    expect(by_id["live-one"]?.public_url).toBe(
      "http://localhost:4200/org/alpha/live-one"
    );
    expect(by_id["live-one"]?.goal).toEqual({
      amount: "1000.00",
      currency: "USD",
    });

    const ended = await get(
      campaigns_loader,
      "/connector/v1/campaigns?status=ended",
      a.key
    );
    const ended_ids = (
      (await ended.json()) as { data: { id: string }[] }
    ).data.map((row) => row.id);
    expect(ended_ids.sort()).toEqual(["ended-one", "expired-live"]);

    const still_open = await get(
      campaigns_loader,
      "/connector/v1/campaigns?status=published",
      a.key
    );
    const open_ids = (
      (await still_open.json()) as { data: { id: string }[] }
    ).data.map((row) => row.id);
    expect(open_ids.sort()).toEqual(["closes-today", "live-one"]);

    const other = await get(
      campaign_loader,
      "/connector/v1/campaigns/live-one",
      b.key,
      { id: "live-one" }
    );
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({
      code: "not_found",
      status: 404,
    });

    const detail = await get(
      campaign_loader,
      "/connector/v1/campaigns/live-one",
      a.key,
      { id: "live-one" }
    );
    expect(detail.status).toBe(200);
    const campaign = (await detail.json()) as {
      blocks: { type: string }[];
      has_unpublished_changes: boolean;
      public_url: string;
    };
    expect(campaign.blocks.map((block) => block.type)).toEqual([
      "title",
      "story",
      "hero",
      "goal-bar",
    ]);
    expect(campaign.has_unpublished_changes).toBe(false);
    expect(campaign.public_url).toBe(
      "http://localhost:4200/org/alpha/live-one"
    );

    const bad = await get(
      campaigns_loader,
      "/connector/v1/campaigns?limit=101&extra=1",
      a.key
    );
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: "invalid", status: 422 });
  });
});

describe("donation page and catalog", () => {
  test("projects an absolute marketplace url and only the blocks it emits", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    await db()
      .update(npos)
      .set({
        slug: "red-bird",
        published: true,
        active: true,
        overview_v2: "A story",
        logo: "https://img.example/logo.png",
      })
      .where(eq(npos.id, a.npo.id));

    const page = await get(page_loader, "/connector/v1/donation-page", a.key);
    expect(page.status).toBe(200);
    const body = (await page.json()) as {
      status: string;
      public_url: string | null;
      has_unpublished_changes: boolean;
      blocks: { type: string; text?: string; image_url?: string | null }[];
    };
    expect(body.status).toBe("published");
    expect(body.public_url).toBe("http://localhost:4200/org/red-bird");
    expect(body.has_unpublished_changes).toBe(false);
    expect(body.blocks.map((block) => block.type)).toEqual([
      "title",
      "story",
      "hero",
    ]);
    expect(body.blocks[2]?.image_url).toBe("https://img.example/logo.png");

    await db()
      .update(npos)
      .set({ published: false })
      .where(eq(npos.id, a.npo.id));
    const draft = (await (
      await get(page_loader, "/connector/v1/donation-page", a.key)
    ).json()) as { status: string; public_url: string | null };
    expect(draft.status).toBe("draft");
    expect(draft.public_url).toBeNull();

    const catalog = await get(
      catalog_loader,
      "/connector/v1/blocks/catalog",
      a.key
    );
    expect(catalog.status).toBe(200);
    const blocks = (
      (await catalog.json()) as { blocks: { type: string }[] }
    ).blocks.map((block) => block.type);
    expect(blocks).toEqual(["title", "story", "hero", "goal-bar"]);
  });
});

describe("forms", () => {
  test("maps ConnectorForm for forms this nonprofit owns", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    await seed_fund(db(), {
      id: "fund-a",
      npo_owner: a.npo.id,
      creator_id: a.owner.id,
      active: true,
    });
    await seed_fund(db(), {
      id: "fund-b",
      npo_owner: b.npo.id,
      creator_id: b.owner.id,
      active: true,
    });
    const outsider = (await seed_user(db(), "out@test.com", "Out", "Side"))!;
    await db()
      .insert(forms)
      .values([
        {
          id: "owned",
          owner_npo_id: a.npo.id,
          name: "Alpha",
          tag: "Owned",
          status: "active",
          increments: [{ value: "25", label: "25" }],
          program_id: "prog_1",
          date_created: "2024-01-02T00:00:00.000Z",
        },
        {
          id: "on-page",
          owner_user_id: outsider.id,
          recipient_npo_id: a.npo.id,
          name: "On the page",
          status: null,
          date_created: "2024-01-03T00:00:00.000Z",
        },
        {
          id: "on-fund",
          owner_user_id: outsider.id,
          recipient_fund_id: "fund-a",
          name: "On the fund",
          status: "inactive",
          date_created: "2024-01-04T00:00:00.000Z",
        },
        {
          id: "owned-campaign",
          owner_npo_id: a.npo.id,
          recipient_fund_id: "fund-a",
          name: "Owned campaign",
          status: "active",
          date_created: "2024-01-06T00:00:00.000Z",
        },
        {
          id: "foreign-fund",
          owner_npo_id: a.npo.id,
          recipient_fund_id: "fund-b",
          name: "Points away",
          status: "active",
          date_created: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "theirs",
          owner_npo_id: b.npo.id,
          name: "Theirs",
          status: "active",
          date_created: "2024-01-05T00:00:00.000Z",
        },
      ]);

    const list = await get(forms_loader, "/connector/v1/forms", a.key);
    expect(list.status).toBe(200);
    const data = (
      (await list.json()) as {
        data: {
          id: string;
          name: string;
          status: string;
          suggested_amounts: { amount: string; currency: string }[];
          minimum: unknown;
          maximum: unknown;
          allowed_origins: string[];
          gifts_go_to: { mode: string; program_id: string | null };
          campaign_id: string | null;
        }[];
      }
    ).data;
    const ids = data.map((row) => row.id);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual(
      expect.arrayContaining(["owned", "owned-campaign", "foreign-fund"])
    );
    expect(ids).not.toContain("on-page");
    expect(ids).not.toContain("on-fund");
    expect(ids).not.toContain("theirs");
    const owned = data.find((row) => row.id === "owned");
    expect(owned).toMatchObject({
      name: "Owned",
      status: "live",
      suggested_amounts: [{ amount: "25.00", currency: "USD" }],
      minimum: null,
      maximum: null,
      allowed_origins: [],
      gifts_go_to: { mode: "pinned", program_id: "prog_1" },
      campaign_id: null,
      // unset columns read as what the donate form falls back to
      frequencies: ["one-time", "monthly"],
      donate_methods: [
        "stripe",
        "stripe_bank",
        "daf",
        "stocks",
        "ira_qcd",
        "crypto",
      ],
    });
    expect(data.find((row) => row.id === "owned-campaign")?.campaign_id).toBe(
      "fund-a"
    );
    expect(
      data.find((row) => row.id === "foreign-fund")?.campaign_id
    ).toBeNull();
    // no label reads as the form's name, as the admin list shows it
    expect(data.find((row) => row.id === "foreign-fund")?.name).toBe(
      "Points away"
    );

    const missing = await get(
      form_loader,
      "/connector/v1/forms/theirs",
      a.key,
      {
        id: "theirs",
      }
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
    const attached = await get(
      form_loader,
      "/connector/v1/forms/on-page",
      a.key,
      { id: "on-page" }
    );
    expect(attached.status).toBe(404);
    expect(await attached.json()).toMatchObject({ code: "not_found" });
  });
});

describe("donations, donors, results, recurring", () => {
  test("pages gifts and hides the other nonprofit", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    await insert_campaign({
      id: "camp-a",
      name: "Drive",
      npo_id: a.npo.id,
      creator_id: a.owner.id,
      status: "live",
      slug: "drive",
      target_number: 500,
    });
    await insert_gift({
      id: "g-new",
      npo_id: a.npo.id,
      email: "ada@example.com",
      name: "Ada",
      amount: 40,
      created_at: "2024-03-01T12:00:00.000Z",
    });
    await insert_gift({
      id: "g-mid",
      npo_id: a.npo.id,
      campaign_id: "camp-a",
      email: "ada@example.com",
      name: "Ada",
      amount: 10,
      created_at: "2024-02-01T12:00:00.000Z",
    });
    await insert_gift({
      id: "g-old",
      npo_id: a.npo.id,
      email: "hand-old@recorded.invalid",
      name: "Walk-up",
      amount: 5,
      created_at: "2024-01-01T12:00:00.000Z",
    });
    await insert_gift({
      id: "g-refunded",
      npo_id: a.npo.id,
      email: "ada@example.com",
      amount: 99,
      status: "refunded",
      created_at: "2024-03-02T12:00:00.000Z",
    });
    await insert_gift({
      id: "g-other",
      npo_id: b.npo.id,
      email: "bea@example.com",
      amount: 1000,
      created_at: "2024-03-03T12:00:00.000Z",
    });

    const page = await get(
      donations_loader,
      "/connector/v1/donations?limit=2",
      a.key
    );
    expect(page.status).toBe(200);
    const first = (await page.json()) as {
      data: { id: string; campaign_id: string | null }[];
      next_cursor: string | null;
    };
    expect(first.data.map((row) => row.id)).toEqual(["g-new", "g-mid"]);
    expect(first.data[0]?.campaign_id).toBeNull();
    expect(first.data[1]?.campaign_id).toBe("camp-a");
    expect(first.next_cursor).toBeTruthy();

    const second = await get(
      donations_loader,
      `/connector/v1/donations?limit=2&cursor=${encodeURIComponent(first.next_cursor!)}`,
      a.key
    );
    const rest = (await second.json()) as {
      data: { id: string }[];
      next_cursor: string | null;
    };
    expect(rest.data.map((row) => row.id)).toEqual(["g-old"]);
    expect(rest.next_cursor).toBeNull();

    const forged = await get(
      donations_loader,
      "/connector/v1/donations?cursor=not-a-cursor",
      a.key
    );
    expect(forged.status).toBe(422);

    const results = await get(results_loader, "/connector/v1/results", a.key);
    const summary = (await results.json()) as {
      total: { amount: string };
      gift_count: number;
      donor_count: number;
      campaigns: {
        id: string;
        total: { amount: string };
        gift_count: number;
        goal: { amount: string } | null;
      }[];
    };
    expect(summary.total.amount).toBe("55.00");
    expect(summary.gift_count).toBe(3);
    expect(summary.donor_count).toBe(2);
    const drive = summary.campaigns.find((row) => row.id === "camp-a");
    expect(drive?.total.amount).toBe("10.00");
    expect(drive?.gift_count).toBe(1);
    expect(drive?.goal?.amount).toBe("500.00");

    const hidden = await get(
      results_loader,
      "/connector/v1/results?campaign_id=camp-a",
      b.key
    );
    expect(hidden.status).toBe(404);

    const donors = await get(
      donors_loader,
      "/connector/v1/donors?q=ada",
      a.key
    );
    const donor_rows = (
      (await donors.json()) as {
        data: { id: string; email: string | null; gift_count: number }[];
      }
    ).data;
    expect(donor_rows).toHaveLength(1);
    expect(donor_rows[0]).toMatchObject({
      id: "ada@example.com",
      email: "ada@example.com",
      gift_count: 2,
    });

    const one = await get(
      donor_loader,
      "/connector/v1/donors/ada@example.com",
      a.key,
      { id: "ada@example.com" }
    );
    expect(one.status).toBe(200);
    const detail = (await one.json()) as {
      consent: string;
      gifts: { data: { id: string }[] };
    };
    expect(detail.consent).toBe("unasked");
    expect(detail.gifts.data.map((gift) => gift.id)).toEqual([
      "g-new",
      "g-mid",
    ]);

    const stranger = await get(
      donor_loader,
      "/connector/v1/donors/bea@example.com",
      a.key,
      { id: "bea@example.com" }
    );
    expect(stranger.status).toBe(404);

    await seed_fund(db(), {
      id: "fund-a",
      name: "Drive",
      npo_owner: a.npo.id,
      creator_id: a.owner.id,
      active: true,
    });
    await db()
      .insert(subscriptions)
      .values([
        {
          id: "sub-month",
          interval: "month",
          interval_count: 1,
          next_billing: "2026-11-01T00:00:00.000Z",
          amount: 20,
          amount_usd: 20,
          currency: "USD",
          product_id: "price_month",
          to_npo_id: a.npo.id,
          to_name: "Alpha",
          platform: "stripe",
          status: "active",
          from_id: "Ada@Example.com",
          created_at: "2024-05-01T00:00:00.000Z",
          updated_at: "2024-05-02T00:00:00.000Z",
        },
        {
          id: "sub-year",
          interval: "year",
          interval_count: 1,
          next_billing: "2026-01-01T00:00:00.000Z",
          amount: 100,
          amount_usd: 100,
          currency: "EUR",
          product_id: "price_year",
          to_fund_id: "fund-a",
          to_name: "Drive",
          platform: "paypal",
          status: "inactive",
          from_id: "ada@example.com",
          created_at: "2024-04-01T00:00:00.000Z",
          updated_at: "2024-04-02T00:00:00.000Z",
        },
        {
          id: "sub-week",
          interval: "week",
          interval_count: 1,
          next_billing: "2026-10-01T00:00:00.000Z",
          amount: 5,
          amount_usd: 5,
          currency: "USD",
          product_id: "price_week",
          to_npo_id: a.npo.id,
          to_name: "Alpha",
          platform: "stripe",
          status: "active",
          from_id: "week@example.com",
          created_at: "2024-03-01T00:00:00.000Z",
          updated_at: "2024-03-02T00:00:00.000Z",
        },
        {
          id: "sub-b",
          interval: "month",
          interval_count: 1,
          next_billing: "2026-11-01T00:00:00.000Z",
          amount: 9,
          amount_usd: 9,
          currency: "USD",
          product_id: "price_b",
          to_npo_id: b.npo.id,
          to_name: "Beta",
          platform: "stripe",
          status: "active",
          from_id: "bea@example.com",
          created_at: "2024-06-01T00:00:00.000Z",
          updated_at: "2024-06-02T00:00:00.000Z",
        },
      ]);

    const recurring = await get(
      recurring_loader,
      "/connector/v1/recurring",
      a.key
    );
    const plans = (
      (await recurring.json()) as {
        data: {
          id: string;
          frequency: string;
          status: string;
          currency: string;
          next_charge_at: string | null;
          donor_id: string;
        }[];
      }
    ).data;
    expect(plans.map((row) => row.id)).not.toContain("sub-b");
    expect(plans.find((row) => row.id === "sub-month")).toMatchObject({
      frequency: "monthly",
      status: "active",
      currency: "USD",
      donor_id: "ada@example.com",
    });
    expect(plans.find((row) => row.id === "sub-year")).toMatchObject({
      frequency: "yearly",
      status: "stopped",
      next_charge_at: null,
    });
    expect(plans.find((row) => row.id === "sub-week")?.frequency).toBe(
      "monthly"
    );
  });

  test("a full page stays under 1 MiB and limit 100 is the ceiling", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    for (let i = 0; i < 100; i++) {
      await insert_gift({
        id: `bulk-${i}`,
        npo_id: a.npo.id,
        email: `p${i}@example.com`,
        amount: 1,
        created_at: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
      });
    }
    const res = await get(
      donations_loader,
      "/connector/v1/donations?limit=100",
      a.key
    );
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text.length).toBeLessThan(1024 * 1024);
    expect(text.length).toBeLessThan(256 * 1024);

    const too_big = await get(
      donations_loader,
      "/connector/v1/donations?limit=101",
      a.key
    );
    expect(too_big.status).toBe(422);
  });

  test("a marketplace gift with no recipient row is listed, and the campaign total is the dist net", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    await insert_campaign({
      id: "winter",
      name: "Winter Drive",
      npo_id: a.npo.id,
      creator_id: a.owner.id,
      status: "live",
      slug: "winter",
    });
    await db().insert(donations).values({
      id: "stripe-25",
      upusd: 25,
      status: "settled",
      amount_base: 25,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe",
      campaign_id: "winter",
      created_at: "2026-10-18T12:00:00.000Z",
      updated_at: "2026-10-18T12:00:00.000Z",
    });
    await db().insert(donation_donors).values({
      donation_id: "stripe-25",
      email: "campaign-donor@example.com",
      name: "Campaign Donor",
    });
    await db().insert(dists).values({
      id: "dist-stripe-25",
      donation_id: "stripe-25",
      status: "settled",
      date_created: "2026-10-18T12:00:00.000Z",
      to_id: a.npo.id,
      amount_denom: "USD",
      amount: 25,
      amount_usd: 25,
      net: 25,
    });

    const listed = await get(
      donations_loader,
      "/connector/v1/donations",
      a.key
    );
    expect(listed.status).toBe(200);
    const gifts = (
      (await listed.json()) as {
        data: {
          id: string;
          amount: string;
          donor_name: string;
          campaign_id: string | null;
        }[];
      }
    ).data;
    expect(gifts).toEqual([
      expect.objectContaining({
        id: "stripe-25",
        amount: "25.00",
        donor_name: "Campaign Donor",
        campaign_id: "winter",
      }),
    ]);

    const results = await get(results_loader, "/connector/v1/results", a.key);
    const summary = (await results.json()) as {
      total: { amount: string };
      gift_count: number;
      campaigns: {
        id: string;
        total: { amount: string };
        gift_count: number;
      }[];
    };
    expect(summary.total.amount).toBe("25.00");
    expect(summary.gift_count).toBe(1);
    expect(summary.campaigns.find((row) => row.id === "winter")).toMatchObject({
      total: { amount: "25.00" },
      gift_count: 1,
    });

    const donors = await get(donors_loader, "/connector/v1/donors", a.key);
    const donor_rows = (
      (await donors.json()) as {
        data: {
          name: string;
          gift_count: number;
          total_given: { amount: string };
        }[];
      }
    ).data;
    expect(donor_rows).toHaveLength(1);
    expect(donor_rows[0]).toMatchObject({
      name: "Campaign Donor",
      gift_count: 1,
      total_given: { amount: "25.00" },
    });
  });

  test("a split gift with one share refunded adds nothing to this nonprofit's totals", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    await insert_campaign({
      id: "split-drive",
      name: "Split Drive",
      npo_id: a.npo.id,
      creator_id: a.owner.id,
      status: "live",
      slug: "split",
    });
    await db().insert(donations).values({
      id: "split-100",
      upusd: 1,
      status: "settled",
      amount_base: 100,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe",
      campaign_id: "split-drive",
      created_at: "2026-10-19T12:00:00.000Z",
      updated_at: "2026-10-19T12:00:00.000Z",
    });
    await db().insert(donation_donors).values({
      donation_id: "split-100",
      email: "split-donor@example.com",
      name: "Split Donor",
    });
    await db()
      .insert(dists)
      .values([
        {
          id: "dist-split-a",
          donation_id: "split-100",
          status: "refunded",
          date_created: "2026-10-19T12:00:00.000Z",
          to_id: a.npo.id,
          amount_denom: "USD",
          amount: 40,
          amount_usd: 40,
          net: 40,
        },
        {
          id: "dist-split-b",
          donation_id: "split-100",
          status: "settled",
          date_created: "2026-10-19T12:00:00.000Z",
          to_id: b.npo.id,
          amount_denom: "USD",
          amount: 60,
          amount_usd: 60,
          net: 60,
        },
      ]);

    const results = await get(results_loader, "/connector/v1/results", a.key);
    const summary = (await results.json()) as {
      total: { amount: string };
      campaigns: { id: string; total: { amount: string } }[];
    };
    expect(summary.total.amount).toBe("0.00");
    expect(
      summary.campaigns.find((row) => row.id === "split-drive")
    ).toMatchObject({ total: { amount: "0.00" } });

    const donors = await get(donors_loader, "/connector/v1/donors", a.key);
    const donor_rows = (
      (await donors.json()) as {
        data: { total_given: { amount: string } }[];
      }
    ).data;
    expect(donor_rows).toHaveLength(1);
    expect(donor_rows[0]).toMatchObject({
      total_given: { amount: "0.00" },
    });

    const other = await get(results_loader, "/connector/v1/results", b.key);
    const other_summary = (await other.json()) as { total: { amount: string } };
    expect(other_summary.total.amount).toBe("60.00");
  });

  test("a non-USD gift reports its currency amount and adds amount_base / upusd to USD totals", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    await insert_gift({
      id: "g-usd",
      npo_id: a.npo.id,
      email: "ada@example.com",
      amount: 5,
      created_at: "2024-04-01T12:00:00.000Z",
    });
    await insert_gift({
      id: "g-eur",
      npo_id: a.npo.id,
      email: "ada@example.com",
      amount: 80,
      upusd: 4,
      currency: "EUR",
      created_at: "2024-04-02T12:00:00.000Z",
    });

    const listed = await get(
      donations_loader,
      "/connector/v1/donations",
      a.key
    );
    const gifts = (
      (await listed.json()) as {
        data: { id: string; amount: string; currency: string }[];
      }
    ).data;
    expect(gifts.find((row) => row.id === "g-eur")).toMatchObject({
      amount: "80",
      currency: "EUR",
    });
    expect(gifts.find((row) => row.id === "g-usd")).toMatchObject({
      amount: "5.00",
      currency: "USD",
    });

    const results = await get(results_loader, "/connector/v1/results", a.key);
    const summary = (await results.json()) as {
      total: { amount: string };
    };
    expect(summary.total.amount).toBe("25.00");

    const donors = await get(
      donors_loader,
      "/connector/v1/donors?q=ada",
      a.key
    );
    const donor = (
      (await donors.json()) as {
        data: { total_given: { amount: string } }[];
      }
    ).data[0];
    expect(donor?.total_given.amount).toBe("25.00");
  });

  test("a name search totals every gift from the matched donor", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    await insert_gift({
      id: "name-1",
      npo_id: a.npo.id,
      email: "ada@example.com",
      name: "Ada Smith",
      amount: 10,
      created_at: "2024-01-01T12:00:00.000Z",
    });
    await insert_gift({
      id: "name-2",
      npo_id: a.npo.id,
      email: "ada@example.com",
      name: "Ada Jones",
      amount: 30,
      created_at: "2024-02-01T12:00:00.000Z",
    });
    const donors = await get(
      donors_loader,
      "/connector/v1/donors?q=Smith",
      a.key
    );
    const row = (
      (await donors.json()) as {
        data: { gift_count: number; total_given: { amount: string } }[];
      }
    ).data[0];
    expect(row).toMatchObject({
      gift_count: 2,
      total_given: { amount: "40.00" },
    });
  });
});

describe("writes", () => {
  test("create_campaign is a draft and replays on the same key", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    await db()
      .update(npos)
      .set({
        overview_pt: "Fixture nonprofit for campaign verify flows.",
      })
      .where(eq(npos.id, a.npo.id));
    const created = await post(
      campaigns_action,
      "/connector/v1/campaigns",
      a.key,
      { title: "  Library drive  " },
      "idem-1"
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      id: string;
      title: string;
      status: string;
      public_url: string | null;
      blocks: { type: string; text?: string }[];
    };
    expect(body).toMatchObject({
      title: "Library drive",
      status: "draft",
      public_url: null,
    });
    expect(body.blocks.find((block) => block.type === "story")?.text).toBe("");

    const again = await post(
      campaigns_action,
      "/connector/v1/campaigns",
      a.key,
      { title: "  Library drive  " },
      "idem-1"
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(body);
    expect(await db().select().from(campaigns)).toHaveLength(1);
    const [row] = await db().select().from(campaigns);
    expect(row?.status).toBe("draft");
    expect(row?.owner_npo_id).toBe(a.npo.id);
    expect(row?.slug.startsWith("library-drive-")).toBe(true);
    expect(row?.description_pt).toBe("[]");
    expect(row?.description_v2).toBe("");
    const members = await db().select().from(campaign_members);
    expect(members).toEqual([
      { campaign_id: body.id, npo_id: a.npo.id, position: 0 },
    ]);
    const editor = await campaign_get(a.npo.id, body.id);
    expect(editor?.name).toBe("Library drive");
    expect(editor?.status).toBe("draft");

    const clash = await post(
      campaigns_action,
      "/connector/v1/campaigns",
      a.key,
      { title: "Something else" },
      "idem-1"
    );
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({
      code: "idempotency_conflict",
      status: 409,
    });
    expect(await db().select().from(campaigns)).toHaveLength(1);

    const named = await post(
      campaigns_action,
      "/connector/v1/campaigns",
      a.key,
      { name: "Nope", campaign_type: "event" },
      "idem-2"
    );
    expect(named.status).toBe(422);

    const missing = await post(
      campaigns_action,
      "/connector/v1/campaigns",
      a.key,
      { title: "No key" }
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      code: "idempotency_key_required",
      status: 400,
    });

    const hidden = await get(
      campaign_loader,
      `/connector/v1/campaigns/${body.id}`,
      b.key,
      { id: body.id }
    );
    expect(hidden.status).toBe(404);
    const visible = await get(
      campaigns_loader,
      "/connector/v1/campaigns",
      b.key
    );
    expect(((await visible.json()) as { data: unknown[] }).data).toEqual([]);
  });
});
