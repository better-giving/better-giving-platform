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

import { reserve_keyed } from "$/connector/gate";
import { exchange_code, issue_code } from "$/connector/keys";
import type { DbOrTx } from "$/pg/queries/helpers";
import { user } from "$/pg/schema/auth";
import {
  connector_codes,
  connector_idempotency,
  connector_keys,
} from "$/pg/schema/connector";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "./connector.v1.disconnect";

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
  await db().delete(connector_idempotency);
  await db().delete(connector_keys);
  await db().delete(connector_codes);
  await db().delete(user_npo_memberships);
  await db().delete(npos);
  await db().delete(user);
});

const issue = async (email: string, ein: string) => {
  const npo = (await seed_npo(db(), {
    name: "Red Bird",
    registration_number: ein,
  }))!;
  const owner = (await seed_user(db(), email, "Ada", "Lovelace"))!;
  await db()
    .insert(user_npo_memberships)
    .values({ user_id: owner.id, npo_id: npo.id });
  const issued = await issue_code(as_db(db()), {
    npo_id: npo.id,
    allowed_by: owner.id,
    iss: "https://zap.example",
  });
  const exchanged = await exchange_code(as_db(db()), issued.code);
  if (!exchanged.ok) throw new Error("seed key failed");
  return exchanged;
};

const disconnect = (authorization?: string) =>
  action({
    request: new Request("https://bg.test/connector/v1/disconnect", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.40",
        ...(authorization ? { authorization } : {}),
      },
    }),
    params: {},
    context: {},
  } as any) as Promise<Response>;

describe("POST /connector/v1/disconnect", () => {
  test("revokes the issued key and the next call is refused", async () => {
    const issued = await issue("ada@test.com", "EIN-DC");

    const res = await disconnect(`Bearer ${issued.key}`);

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");

    const again = await disconnect(`Bearer ${issued.key}`);
    expect(again.status).toBe(401);
    expect(again.headers.get("content-type")).toBe("application/problem+json");
    expect(await again.json()).toEqual({
      code: "key_refused",
      status: 401,
      error: {
        code: "key_refused",
        message: "The API key is missing or no longer valid.",
      },
    });
  });

  test.each([
    ["missing", undefined],
    ["bad shape", "Basic nope"],
    ["unknown", `Bearer bgc_${"a".repeat(43)}`],
  ])("%s bearer is key_refused", async (_label, authorization) => {
    const res = await disconnect(authorization);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "key_refused",
      status: 401,
      error: {
        code: "key_refused",
        message: "The API key is missing or no longer valid.",
      },
    });
  });
});

describe("GET /connector/v1/disconnect", () => {
  test("is unknown_action", async () => {
    const res = (await loader({
      request: new Request("https://bg.test/connector/v1/disconnect"),
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

describe("reserve_keyed", () => {
  test("after 120 charges key A is limited and key B still passes, on one address", async () => {
    const a = await issue("ada@test.com", "EIN-A");
    const b = await issue("bea@test.com", "EIN-B");

    let slot = reserve_keyed(a.key_id);
    for (let i = 1; i < 120; i++) slot = reserve_keyed(a.key_id);
    expect(slot).not.toBeNull();
    expect(reserve_keyed(a.key_id)).toBeNull();
    expect(reserve_keyed(b.key_id)).not.toBeNull();
  });
});
