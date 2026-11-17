import { and, eq } from "drizzle-orm";
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

import { exchange_code, issue_code, revoke_key } from "$/connector/keys";
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
import { action, loader } from "./connector.v1.memberships";

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

let seq = 0;
const npo = async (name: string, logo: string | null = null) =>
  (await seed_npo(db(), {
    name,
    logo,
    registration_number: `EIN-MB-${++seq}`,
  }))!;

const member = (user_id: string, npo_id: number) =>
  db().insert(user_npo_memberships).values({ user_id, npo_id });

/** a user with a live key on `current`, plus memberships in `others` */
const connect = async (email: string, current: { id: number }) => {
  const owner = (await seed_user(db(), email, "Ada", "Lovelace"))!;
  await member(owner.id, current.id);
  const issued = await issue_code(as_db(db()), {
    npo_id: current.id,
    allowed_by: owner.id,
    iss: "https://zap.example",
  });
  const exchanged = await exchange_code(as_db(db()), issued.code);
  if (!exchanged.ok) throw new Error("seed key failed");
  return { owner, ...exchanged };
};

const list = (authorization?: string, search = "") => {
  const request = new Request(
    `https://bg.test/connector/v1/memberships${search}`,
    {
      headers: {
        "x-forwarded-for": "203.0.113.50",
        ...(authorization ? { authorization } : {}),
      },
    }
  );
  return loader({
    request,
    url: new URL(request.url),
    params: {},
    context: {},
  } as any) as Promise<Response>;
};

const KEY_REFUSED = {
  code: "key_refused",
  status: 401,
  error: {
    code: "key_refused",
    message: "The API key is missing or no longer valid.",
  },
};

describe("GET /connector/v1/memberships", () => {
  test("a user with one membership gets just the connected nonprofit", async () => {
    const red = await npo("Red Bird", "https://img.test/red.png");
    const a = await connect("ada@test.com", red);

    const res = await list(`Bearer ${a.key}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [
        {
          id: String(red.id),
          name: "Red Bird",
          role: "admin",
          can_manage: true,
          current: true,
          logo_url: "https://img.test/red.png",
        },
      ],
      next_cursor: null,
    });
  });

  test("two memberships: the exact response, connected nonprofit first", async () => {
    const zeta = await npo("Zeta Fund", "https://img.test/zeta.png");
    const alpha = await npo("Alpha Aid");
    const a = await connect("ada@test.com", zeta);
    await member(a.owner.id, alpha.id);

    const res = await list(`Bearer ${a.key}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [
        {
          id: String(zeta.id),
          name: "Zeta Fund",
          role: "admin",
          can_manage: true,
          current: true,
          logo_url: "https://img.test/zeta.png",
        },
        {
          id: String(alpha.id),
          name: "Alpha Aid",
          role: "admin",
          can_manage: true,
          current: false,
          logo_url: null,
        },
      ],
      next_cursor: null,
    });
  });

  test("several memberships: current first, the rest by name, one current", async () => {
    const mid = await npo("Mid Org");
    const a = await connect("ada@test.com", mid);
    for (const name of ["Zed Org", "Alpha Org", "Beta Org"]) {
      await member(a.owner.id, (await npo(name)).id);
    }

    const body = (await (await list(`Bearer ${a.key}`)).json()) as {
      data: { name: string; current: boolean }[];
    };

    expect(body.data.map((n) => n.name)).toEqual([
      "Mid Org",
      "Alpha Org",
      "Beta Org",
      "Zed Org",
    ]);
    expect(body.data.filter((n) => n.current)).toHaveLength(1);
    expect(body.data[0]?.current).toBe(true);
  });

  test("the rest sort by name ignoring case", async () => {
    const mid = await npo("Mid Org");
    const a = await connect("ada@test.com", mid);
    for (const name of ["Zeta Fund", "charity: water", "Beta Org"]) {
      await member(a.owner.id, (await npo(name)).id);
    }

    const body = (await (await list(`Bearer ${a.key}`)).json()) as {
      data: { name: string }[];
    };

    expect(body.data.map((n) => n.name)).toEqual([
      "Mid Org",
      "Beta Org",
      "charity: water",
      "Zeta Fund",
    ]);
  });

  test("same-name nonprofits sort by id", async () => {
    const mid = await npo("Mid Org");
    const a = await connect("ada@test.com", mid);
    const first = await npo("Twin Org");
    const second = await npo("Twin Org");
    await member(a.owner.id, second.id);
    await member(a.owner.id, first.id);

    const body = (await (await list(`Bearer ${a.key}`)).json()) as {
      data: { id: string }[];
    };

    expect(body.data.map((n) => n.id)).toEqual([
      String(mid.id),
      String(first.id),
      String(second.id),
    ]);
  });

  test("an empty logo is logo_url null", async () => {
    const red = await npo("Red Bird", "");
    const a = await connect("ada@test.com", red);

    const body = (await (await list(`Bearer ${a.key}`)).json()) as {
      data: { logo_url: string | null }[];
    };

    expect(body.data[0]?.logo_url).toBeNull();
  });

  test("a membership the user lost is left out", async () => {
    const red = await npo("Red Bird");
    const gone = await npo("Gone Org");
    const a = await connect("ada@test.com", red);
    await member(a.owner.id, gone.id);
    await db()
      .delete(user_npo_memberships)
      .where(
        and(
          eq(user_npo_memberships.user_id, a.owner.id),
          eq(user_npo_memberships.npo_id, gone.id)
        )
      );

    const body = (await (await list(`Bearer ${a.key}`)).json()) as {
      data: { id: string }[];
    };

    expect(body.data.map((n) => n.id)).toEqual([String(red.id)]);
  });

  test("another user's nonprofit never appears", async () => {
    const red = await npo("Red Bird");
    const other = await npo("Someone Else's Org");
    const a = await connect("ada@test.com", red);
    const bea = (await seed_user(db(), "bea@test.com", "Bea", "Smith"))!;
    await member(bea.id, other.id);
    await member(bea.id, red.id);

    const body = (await (await list(`Bearer ${a.key}`)).json()) as {
      data: { id: string }[];
    };

    expect(body.data.map((n) => n.id)).toEqual([String(red.id)]);
  });

  test("a revoked key is key_refused", async () => {
    const red = await npo("Red Bird");
    const a = await connect("ada@test.com", red);
    await revoke_key(as_db(db()), {
      id: a.key_id,
      npo_id: red.id,
      revoked_by: null,
    });

    const res = await list(`Bearer ${a.key}`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(KEY_REFUSED);
  });

  test.each([
    ["missing", undefined],
    ["bad shape", "Basic nope"],
    ["unknown", `Bearer bgc_${"a".repeat(43)}`],
  ])("%s bearer is key_refused", async (_label, authorization) => {
    const res = await list(authorization);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(KEY_REFUSED);
  });

  test("a query parameter is refused", async () => {
    const red = await npo("Red Bird");
    const a = await connect("ada@test.com", red);
    const res = await list(`Bearer ${a.key}`, "?limit=1");
    expect(res.status).toBe(422);
  });

  test("a write method is unknown_action", async () => {
    const res = (await action({
      request: new Request("https://bg.test/connector/v1/memberships", {
        method: "POST",
      }),
      params: {},
      context: {},
    } as any)) as Response;
    expect(res.status).toBe(404);
  });
});
