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

import { issue_code } from "$/connector/keys";
import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import { connector_codes, connector_keys } from "$/pg/schema/connector";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "./connector.v1.exchange";

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
  await db().delete(connector_keys);
  await db().delete(connector_codes);
  await db().delete(user_npo_memberships);
  await db().delete(npos);
  await db().delete(user);
});

const post = (body: string, ip = "203.0.113.20") =>
  action({
    request: new Request("https://bg.test/connector/v1/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body,
    }),
    params: {},
    context: {},
  } as any) as Promise<Response>;

const seed = async () => {
  const npo = (await seed_npo(db(), {
    name: "Red Bird",
    registration_number: "EIN-EX",
  }))!;
  const owner = (await seed_user(db(), "ada@test.com", "Ada", "Lovelace"))!;
  await db()
    .insert(user_npo_memberships)
    .values({ user_id: owner.id, npo_id: npo.id });
  return issue_code(as_db(db()), {
    npo_id: npo.id,
    allowed_by: owner.id,
    iss: "https://zap.example",
  });
};

describe("POST /connector/v1/exchange", () => {
  test("exchanges a code once for a key that is not stored in plaintext", async () => {
    const issued = await seed();

    const res = await post(JSON.stringify({ code: issued.code }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = (await res.json()) as { key: string; name: string };
    expect(Object.keys(json).sort()).toEqual(["key", "name"]);
    expect(json.name).toBe("Red Bird");
    expect(json.key).toMatch(/^bgc_[A-Za-z0-9_-]{43}$/);

    const [row] = await db().select().from(connector_keys);
    expect(row).toBeDefined();
    for (const value of Object.values(row!)) {
      if (typeof value === "string")
        expect(value.includes(json.key)).toBe(false);
    }

    const again = await post(JSON.stringify({ code: issued.code }));
    expect(again.status).toBe(400);
    expect(again.headers.get("content-type")).toBe("application/problem+json");
    expect(await again.json()).toEqual({
      code: "code_invalid",
      status: 400,
      error: {
        code: "code_invalid",
        message: "The authorization code is invalid, expired or already used.",
      },
    });
    expect(await db().select().from(connector_keys)).toHaveLength(1);
  });

  test("an expired code is code_invalid and stores no key", async () => {
    const issued = await seed();
    await db()
      .update(connector_codes)
      .set({ expires_at: "2020-01-01T00:00:00.000Z" });

    const res = await post(JSON.stringify({ code: issued.code }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "code_invalid",
      status: 400,
      error: {
        code: "code_invalid",
        message: "The authorization code is invalid, expired or already used.",
      },
    });
    expect(await db().select().from(connector_keys)).toHaveLength(0);
  });

  test.each(["not-json", "[]", "null", "{}", JSON.stringify({ code: 1 })])(
    "a body that is not { code: string } is code_invalid (%j)",
    async (body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        code: "code_invalid",
        status: 400,
        error: {
          code: "code_invalid",
          message:
            "The authorization code is invalid, expired or already used.",
        },
      });
    }
  );

  test("the 31st POST from one address is 429", async () => {
    let res = await post("nope", "203.0.113.30");
    for (let i = 1; i < 30; i++) res = await post("nope", "203.0.113.30");
    expect(res.status).toBe(400);

    const limited = await post("nope", "203.0.113.30");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(await limited.json()).toEqual({
      code: "rate_limited",
      status: 429,
      error: {
        code: "rate_limited",
        message: "Too many requests. Wait a moment, then retry.",
      },
    });
  });
});

describe("GET /connector/v1/exchange", () => {
  test("is unknown_action", async () => {
    const res = (await loader({
      request: new Request("https://bg.test/connector/v1/exchange"),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(405);
    expect(await res.json()).toEqual({
      code: "unknown_action",
      status: 404,
      error: {
        code: "unknown_action",
        message: "This connector action does not exist.",
      },
    });
  });
});
