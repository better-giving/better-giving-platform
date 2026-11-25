import { eq } from "drizzle-orm";
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
import { seed_npo, seed_user } from "#/__tests__/fixtures/funds";

const report_error = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error }));

const { user } = await import("../pg/schema/auth");
const { npos } = await import("../pg/schema/npo");
const { partner_keys, partner_tenants } = await import("../pg/schema/partner");
const { rate_limit_windows } = await import("../pg/schema/rate-limit");
const { create_test_db } = await import("../pg/test-utils/pglite");
const { mint_key, revoke_key } = await import("./keys");
const { charge, LIST_WRITE_QUOTA, open_key, partner_route, READ_QUOTA } =
  await import("./gate");

type Db = Parameters<typeof open_key>[0];
// pglite's drizzle handle differs from neon's only in the result-type HKT
const as_db = (x: unknown) => x as Db;

let t: Awaited<ReturnType<typeof create_test_db>>;

beforeAll(async () => {
  t = await create_test_db();
}, 30_000);

afterAll(async () => {
  await t?.client.close();
});

beforeEach(async () => {
  // mid-minute, so a run of charges never straddles a window edge
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T10:00:20.000Z"));
  report_error.mockReset();
  await t.db.delete(rate_limit_windows);
  await t.db.delete(partner_keys);
  await t.db.delete(partner_tenants);
  await t.db.delete(npos);
  await t.db.delete(user);
});

afterEach(() => {
  vi.useRealTimers();
});

const seed_two = async () => {
  const staff = (await seed_user(t.db, "ada@test.com"))!;
  const mine = (await seed_npo(t.db, { registration_number: "EIN-MINE" }))!;
  const theirs = (await seed_npo(t.db, { registration_number: "EIN-THEM" }))!;
  const key = await mint_key(as_db(t.db), {
    npo_id: mine.id,
    minted_by: staff.id,
  });
  await mint_key(as_db(t.db), { npo_id: theirs.id, minted_by: staff.id });
  return { staff, mine, theirs, key };
};

const call = (
  token: string | null,
  init: { url?: string; body?: unknown; headers?: Record<string, string> } = {}
) =>
  new Request(init.url ?? "https://app.test/partner/v1/tenant", {
    method: init.body === undefined ? "GET" : "POST",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

/** a partner endpoint answering with the tenant row its key reaches */
const tenant_route = partner_route(
  async ({ request }: { request: Request }) => {
    const live = await open_key(as_db(t.db), request);
    if (live instanceof Response) return live;
    const [row] = await t.db
      .select({ npo_id: partner_tenants.npo_id })
      .from(partner_tenants)
      .where(eq(partner_tenants.npo_id, live.npo_id));
    return Response.json(row);
  }
);

describe("open_key", () => {
  test("a key reads its own nonprofit's tenant row", async () => {
    const { mine, key } = await seed_two();

    const res = await tenant_route({ request: call(key.key) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ npo_id: mine.id });
  });

  test("an npo_id in the query, body or a header selects nothing", async () => {
    const { mine, theirs, key } = await seed_two();
    const id = String(theirs.id);

    for (const request of [
      call(key.key, { url: `https://app.test/partner/v1/tenant?npo_id=${id}` }),
      call(key.key, { body: { npo_id: theirs.id } }),
      call(key.key, { headers: { "x-npo-id": id, "npo-id": id } }),
    ]) {
      const res = await tenant_route({ request });
      expect(await res.json()).toEqual({ npo_id: mine.id });
    }
  });

  test.each([
    ["no authorization header", null],
    ["a malformed token", "spk_short"],
    ["an unknown token", `spk_${"A".repeat(43)}`],
  ])("%s gets 401 key_invalid", async (_, token) => {
    await seed_two();

    const res = await tenant_route({ request: call(token) });

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "key_invalid" });
  });

  test("a non-bearer scheme gets 401 key_invalid", async () => {
    const { key } = await seed_two();

    const res = await tenant_route({
      request: call(null, { headers: { authorization: `Basic ${key.key}` } }),
    });

    expect(res.status).toBe(401);
  });

  test("a revoked key gets 401 on its next request", async () => {
    const { mine, staff, key } = await seed_two();
    expect((await tenant_route({ request: call(key.key) })).status).toBe(200);

    await revoke_key(as_db(t.db), {
      id: key.id,
      npo_id: mine.id,
      revoked_by: staff.id,
    });

    const res = await tenant_route({ request: call(key.key) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "key_invalid" });
  });

  test("past 120 a minute a key gets 429 with retry-after to the window's end", async () => {
    const { key } = await seed_two();

    for (let i = 0; i < LIST_WRITE_QUOTA.max; i++) {
      expect((await tenant_route({ request: call(key.key) })).status).toBe(200);
    }
    const res = await tenant_route({ request: call(key.key) });

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("40");
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
  });
});

describe("charge", () => {
  test("the list/write and read-by-id buckets are counted apart", async () => {
    const { key } = await seed_two();
    expect(LIST_WRITE_QUOTA).toEqual({ max: 120, window_s: 60 });
    expect(READ_QUOTA).toEqual({ max: 1200, window_s: 60 });

    for (let i = 0; i < LIST_WRITE_QUOTA.max; i++) {
      expect(await charge(as_db(t.db), key.id, "list_write")).toBeNull();
    }
    expect((await charge(as_db(t.db), key.id, "list_write"))?.status).toBe(429);
    expect(await charge(as_db(t.db), key.id, "read")).toBeNull();
  });

  test("each key has its own bucket", async () => {
    const { key, mine } = await seed_two();
    const other = await mint_key(as_db(t.db), {
      npo_id: mine.id,
      minted_by: null,
    });

    for (let i = 0; i < LIST_WRITE_QUOTA.max; i++) {
      await charge(as_db(t.db), key.id, "list_write");
    }
    expect(await charge(as_db(t.db), other.id, "list_write")).toBeNull();
  });
});

describe("partner_route", () => {
  test("an unexpected throw is reported without the key and answered as provider_error 500", async () => {
    const { key } = await seed_two();
    const route = partner_route(async ({ request }: { request: Request }) => {
      const live = await open_key(as_db(t.db), request);
      if (live instanceof Response) return live;
      throw new Error("boom");
    });

    const res = await route({ request: call(key.key) });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      code: "provider_error",
      status: 500,
    });
    expect(report_error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report_error.mock.calls)).not.toContain(key.key);
  });
});
