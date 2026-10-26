import { createHash } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { exchange_code, issue_code } from "$/connector/keys";
import { absolute } from "$/connector/money";
import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import { campaign_members, campaigns } from "$/pg/schema/campaign";
import {
  connector_codes,
  connector_keys,
  connector_photo_links,
} from "$/pg/schema/connector";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import { create_test_db, type TestDb } from "$/pg/test-utils/pglite";
import { action, loader } from "./connector.v1.photos.upload-link";

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

const NOW = new Date("2026-10-26T12:00:00.000Z");

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  reset_rate_limits();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  await db().delete(connector_photo_links);
  await db().delete(campaign_members);
  await db().delete(campaigns);
  await db().delete(connector_keys);
  await db().delete(connector_codes);
  await db().delete(user_npo_memberships);
  await db().delete(npos);
  await db().delete(user);
});

afterEach(() => {
  vi.useRealTimers();
});

const URL_ = "https://bg.test/connector/v1/photos/upload-link";

const post = (key: string | undefined, body?: unknown, method = "POST") => {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("authorization", `Bearer ${key}`);
  const request = new Request(URL_, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return action({
    request,
    params: {},
    context: {},
  } as unknown as ActionFunctionArgs) as Promise<Response>;
};

async function pair(name: string, ein: string, email: string) {
  const npo = (await seed_npo(db(), { name, registration_number: ein }))!;
  const owner = (await seed_user(db(), email, name, "Owner"))!;
  await db()
    .insert(user_npo_memberships)
    .values({ user_id: owner.id, npo_id: npo.id });
  const issued = await issue_code(as_db(db()), {
    npo_id: npo.id,
    allowed_by: owner.id,
    iss: "https://zap.example",
  });
  const exchanged = await exchange_code(as_db(db()), issued.code);
  if (!exchanged.ok) throw new Error("exchange failed");
  return { npo, owner, key: exchanged.key };
}

async function seed_campaign(
  o: { npo: { id: number }; owner: { id: string } },
  extra: { status?: "draft" | "live" | "ended"; ends_at?: string } = {}
) {
  const id = crypto.randomUUID();
  await db()
    .insert(campaigns)
    .values({
      id,
      owner_npo_id: o.npo.id,
      creator_id: o.owner.id,
      name: "Library drive",
      slug: `library-drive-${id.slice(0, 8)}`,
      description_pt: "[]",
      status: "draft",
      ...extra,
    });
  return id;
}

const links = () => db().select().from(connector_photo_links);

describe("create_photo_upload_link", () => {
  test("201 with a link url whose token only the hash of is stored", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);

    const res = await post(a.key, {
      target: { kind: "campaign", id },
      slot: "hero",
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { url: string; expires_at: string };
    expect(Object.keys(body).sort()).toEqual(["expires_at", "url"]);
    const prefix = absolute("/photo-upload/");
    expect(body.url.startsWith(prefix)).toBe(true);
    const token = body.url.slice(prefix.length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.expires_at).toBe(
      new Date(NOW.getTime() + 15 * 60 * 1000).toISOString()
    );

    const rows = await links();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ npo_id: a.npo.id, campaign_id: id });
    expect(row.token_hash).toBe(
      createHash("sha256").update(token).digest("hex")
    );
    for (const value of Object.values(row)) {
      expect(String(value)).not.toContain(token);
    }
  });

  test("slot may be left out", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);

    const res = await post(a.key, { target: { kind: "campaign", id } });

    expect(res.status).toBe(201);
  });

  test("the donation page is refused on target.kind", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");

    const res = await post(a.key, { target: { kind: "donation_page" } });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: "invalid",
      errors: [
        {
          path: "target.kind",
          message:
            "is not supported on Better Giving; only a campaign's photo can be uploaded",
        },
      ],
    });
    expect(await links()).toHaveLength(0);
  });

  test("a slot other than hero is refused on slot", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a);

    const res = await post(a.key, {
      target: { kind: "campaign", id },
      slot: "gallery",
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { path: string }[] };
    expect(body.errors.map((e) => e.path)).toEqual(["slot"]);
    expect(await links()).toHaveLength(0);
  });

  test.each([
    [{}, ["target"]],
    [{ target: "campaign" }, ["target"]],
    [{ target: { kind: "page" } }, ["target.kind"]],
    [{ target: { kind: "campaign" } }, ["target.id"]],
    [{ target: { kind: "campaign", id: "" } }, ["target.id"]],
    [{ target: { kind: "campaign", id: 7 } }, ["target.id"]],
    [{ target: { kind: "campaign", id: "x", extra: 1 } }, ["target.extra"]],
    [{ target: { kind: "campaign", id: "x" }, color: "red" }, ["color"]],
  ])("refuses %j on %j", async (body, paths) => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");

    const res = await post(a.key, body);

    expect(res.status).toBe(422);
    const parsed = (await res.json()) as { errors: { path: string }[] };
    expect(parsed.errors.map((e) => e.path)).toEqual(paths);
  });

  test("another org's campaign is 404 and issues no link", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const b = await pair("Beta", "EIN-B", "b@test.com");
    const id = await seed_campaign(a);

    const res = await post(b.key, { target: { kind: "campaign", id } });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
    expect(await links()).toHaveLength(0);
  });

  // NOW is 2026-10-26 12:00 UTC: an end date of the 25th closed at this
  // instant, one of the 26th is open until noon tomorrow
  test.each([
    ["an ended campaign", { status: "ended" as const }],
    [
      "a live campaign past its end date",
      { status: "live" as const, ends_at: "2026-10-25T00:00:00.000Z" },
    ],
  ])("%s is 409 campaign_ended and issues no link", async (_, extra) => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, extra);

    const res = await post(a.key, { target: { kind: "campaign", id } });

    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toEqual({
      code: "campaign_ended",
      status: 409,
      detail: "This campaign has ended, and an ended campaign stays ended.",
    });
    expect(await links()).toHaveLength(0);
  });

  test.each([
    [
      "a live campaign on its end date",
      { status: "live" as const, ends_at: "2026-10-26T00:00:00.000Z" },
    ],
    [
      "a draft whose end date has passed",
      { status: "draft" as const, ends_at: "2026-10-01T00:00:00.000Z" },
    ],
  ])("%s still gets a link", async (_, extra) => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");
    const id = await seed_campaign(a, extra);

    const res = await post(a.key, { target: { kind: "campaign", id } });

    expect(res.status).toBe(201);
    expect(await links()).toHaveLength(1);
  });

  test("an unknown campaign is 404", async () => {
    const a = await pair("Alpha", "EIN-A", "a@test.com");

    const res = await post(a.key, {
      target: { kind: "campaign", id: crypto.randomUUID() },
    });

    expect(res.status).toBe(404);
  });

  test("no key is 401", async () => {
    const res = await post(undefined, {
      target: { kind: "campaign", id: "x" },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "key_refused", status: 401 });
  });

  test("GET is unknown_action", async () => {
    const res = (await loader()) as Response;

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "unknown_action", status: 404 });
  });
});
