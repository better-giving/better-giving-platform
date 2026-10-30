import { createHash } from "node:crypto";
import { RouterContextProvider } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { type AuthUser, user_ctx } from "#/.server/auth";
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
vi.mock("$/pg/db", () => ({
  db: new Proxy({} as any, {
    get(_, prop) {
      return (test_db.current!.db as any)[prop];
    },
  }),
}));

import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import { connector_codes } from "$/pg/schema/connector";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, CONNECTION_REFUSED, loader } from "./api";

const db = () => test_db.current!.db;
const as_db = (x: unknown) => x as DbOrTx;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const ORIGIN = "https://app.example";
const RETURN_URL = "https://connector.test/done";
const STATE = "state.ok~1";
const ALLOW_URL = `${ORIGIN}/admin/connector/allow`;

const saved_env = {
  BASE_URL: process.env.BASE_URL,
  CONNECTOR_RETURN_URL: process.env.CONNECTOR_RETURN_URL,
  CONNECTOR_ORIGINS: process.env.CONNECTOR_ORIGINS,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  process.env.BASE_URL = saved_env.BASE_URL;
  process.env.CONNECTOR_RETURN_URL = saved_env.CONNECTOR_RETURN_URL;
  process.env.CONNECTOR_ORIGINS = saved_env.CONNECTOR_ORIGINS;
  if (saved_env.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved_env.VERCEL_ENV;
  await test_db.current?.client.close();
});

beforeEach(async () => {
  process.env.BASE_URL = ORIGIN;
  process.env.CONNECTOR_RETURN_URL = RETURN_URL;
  process.env.CONNECTOR_ORIGINS = "";
  process.env.VERCEL_ENV = "preview";
  await db().delete(connector_codes);
  await db().delete(user_npo_memberships);
  await db().delete(npos);
  await db().delete(user);
});

type UserRow = { id: string; role: string; email?: string };

const context_for = (user_row: UserRow) => {
  const context = new RouterContextProvider();
  context.set(user_ctx, user_row as AuthUser);
  return context;
};

const seed = async () => {
  const npo_a = (await seed_npo(db(), {
    name: "Alpha",
    registration_number: "EIN-A",
  }))!;
  const npo_b = (await seed_npo(db(), {
    name: "Beta",
    registration_number: "EIN-B",
  }))!;
  const member = (await seed_user(db(), "ada@test.com", "Ada", "Lovelace"))!;
  await db()
    .insert(user_npo_memberships)
    .values({ user_id: member.id, npo_id: npo_a.id });
  return { npo_a, npo_b, member };
};

const post = (
  url: string,
  fields: Record<string, string>,
  user_row: { id: string; role: string }
) =>
  action({
    request: new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    }),
    context: context_for(user_row),
    params: {},
  } as any) as Promise<Response>;

const load = (url: string, user_row: UserRow) =>
  loader({
    request: new Request(url),
    context: context_for(user_row),
    params: {},
  } as any);

const codes = () => as_db(db()).select().from(connector_codes);

const refusal = {
  data: { error: CONNECTION_REFUSED },
  init: { status: 400 },
};

describe("connector allow", () => {
  test("allow for a member's nonprofit redirects with a hashed code", async () => {
    const { npo_a, member } = await seed();
    const user_row = { id: member.id, role: "user", email: member.email };

    const loaded = await load(`${ALLOW_URL}?state=${STATE}`, user_row);
    expect(loaded).toEqual({
      email: "ada@test.com",
      client: null,
      nonprofits: [{ id: npo_a.id, name: "Alpha" }],
      state: STATE,
      blocked: false,
    });

    const res = await post(
      ALLOW_URL,
      { decision: "allow", npo_id: String(npo_a.id), state: STATE },
      user_row
    );

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(RETURN_URL);
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
    expect(location.searchParams.get("state")).toBe(STATE);
    const code = location.searchParams.get("code");
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [row] = await codes();
    expect(row?.code_hash).toBe(sha256_hex(code!));
    expect(row?.iss).toBe(ORIGIN);
    expect(row?.npo_id).toBe(npo_a.id);
    expect(row?.allowed_by).toBe(member.id);
    for (const value of Object.values(row ?? {})) {
      if (typeof value === "string") expect(value).not.toContain(code);
    }
  });

  test("allow for a nonprofit the user does not administer stores no code", async () => {
    const { npo_b, member } = await seed();

    const res = await post(
      ALLOW_URL,
      { decision: "allow", npo_id: String(npo_b.id), state: STATE },
      { id: member.id, role: "user" }
    );

    expect(res).toMatchObject(refusal);
    expect(await codes()).toHaveLength(0);
  });

  test("allow without a nonprofit re-renders the choice and stores no code", async () => {
    const { member } = await seed();

    const result = await action({
      request: new Request(ALLOW_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ decision: "allow", state: STATE }),
      }),
      context: context_for({ id: member.id, role: "user" }),
      params: {},
    } as any);

    expect(result).toMatchObject({
      data: { error: "Choose a nonprofit" },
      init: { status: 400 },
    });
    expect(await codes()).toHaveLength(0);
  });

  test("allow from an origin other than this app stores no code", async () => {
    const { npo_a, member } = await seed();

    const res = await post(
      "https://evil.example/admin/connector/allow",
      { decision: "allow", npo_id: String(npo_a.id), state: STATE },
      { id: member.id, role: "user" }
    );

    expect(res).toMatchObject(refusal);
    expect(await codes()).toHaveLength(0);
  });

  test("deny redirects with access_denied and stores no code", async () => {
    const { npo_a, member } = await seed();

    const res = await post(
      ALLOW_URL,
      { decision: "deny", npo_id: String(npo_a.id), state: STATE },
      { id: member.id, role: "user" }
    );

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(RETURN_URL);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(location.searchParams.get("iss")).toBe(ORIGIN);
    expect(location.searchParams.has("code")).toBe(false);
    expect(await codes()).toHaveLength(0);
  });

  test("a state of ../x is refused and stores no code", async () => {
    const { npo_a, member } = await seed();
    const user_row = { id: member.id, role: "user", email: member.email };

    const loaded = await load(
      `${ALLOW_URL}?state=${encodeURIComponent("../x")}`,
      user_row
    );
    expect(loaded).not.toBeInstanceOf(Response);
    expect(loaded).toMatchObject({
      data: {
        email: "ada@test.com",
        nonprofits: [],
        state: "",
        error: CONNECTION_REFUSED,
        blocked: true,
      },
      init: { status: 400 },
    });

    const res = await post(
      ALLOW_URL,
      { decision: "allow", npo_id: String(npo_a.id), state: "../x" },
      user_row
    );
    expect(res).toMatchObject(refusal);
    expect(await codes()).toHaveLength(0);
  });

  test("an admin with no memberships gets an empty nonprofit list", async () => {
    await seed_npo(db(), {
      name: "Unrelated",
      registration_number: "EIN-U",
    });
    const admin = (await seed_user(db(), "admin@test.com", "Ann", "Admin"))!;

    const loaded = await load(`${ALLOW_URL}?state=${STATE}`, {
      id: admin.id,
      role: "admin",
      email: admin.email,
    });

    expect(loaded).toEqual({
      email: "admin@test.com",
      client: null,
      nonprofits: [],
      state: STATE,
      blocked: false,
    });
  });

  test.each([
    ["chatgpt", "chatgpt"],
    ["claude", "claude"],
    ["ChatGPT", null],
    ["gemini", null],
    ["", null],
  ])("a client of %j loads as %j", async (raw, expected) => {
    const { member } = await seed();
    const loaded = await load(
      `${ALLOW_URL}?state=${STATE}&client=${encodeURIComponent(raw)}`,
      { id: member.id, role: "user", email: member.email }
    );
    expect(loaded).toMatchObject({ client: expected });
  });
});
