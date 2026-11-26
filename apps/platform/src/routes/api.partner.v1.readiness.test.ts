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
import type { TestDb } from "$/pg/test-utils/pglite";

// every server secret the app reads, set to a value of its own before any
// module reads it, so a leak anywhere in a body shows as a match
const secrets = vi.hoisted(() => {
  // hoisted above the imports, so node:crypto isn't bound yet
  const randomBytes = (n: number) =>
    Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const set: Record<string, string> = {};
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("VITE_")) continue;
    if (!/SECRET|_KEY$|TOKEN|PASSWORD|SIGNING/.test(name)) continue;
    // the encryption key must stay a 32-byte base64 key to seal with
    set[name] =
      name === "APP_API_ENCRYPTION_KEY"
        ? randomBytes(32).toString("base64")
        : `sentinel-${name}-${randomBytes(6).toString("hex")}`;
    process.env[name] = set[name];
  }
  return set;
});
const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const report_error = vi.hoisted(() => vi.fn());

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
vi.mock("#/errors/report", () => ({ report_error }));

const { create_test_db } = await import("$/pg/test-utils/pglite");
const { user } = await import("$/pg/schema/auth");
const { npos } = await import("$/pg/schema/npo");
const { partner_keys, partner_tenants } = await import("$/pg/schema/partner");
const { rate_limit_windows } = await import("$/pg/schema/rate-limit");
const { mint_key, revoke_key } = await import("$/partner/keys");
const { charge, LIST_WRITE_QUOTA } = await import("$/partner/gate");
const { loader, action } = await import("./api.partner.v1.readiness");

type Db = Parameters<typeof mint_key>[0];
const as_db = (x: unknown) => x as Db;
const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  // mid-minute, so a run of charges never straddles a window edge
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T10:00:20.000Z"));
  report_error.mockReset();
  await db().delete(rate_limit_windows);
  await db().delete(partner_keys);
  await db().delete(partner_tenants);
  await db().delete(npos);
  await db().delete(user);
});

afterEach(() => {
  vi.useRealTimers();
});

const seed_two = async () => {
  const staff = (await seed_user(db(), "ada@test.com"))!;
  const mine = (await seed_npo(db(), {
    registration_number: "EIN-MINE",
    donate_methods: ["stripe"],
    // card runs on the nonprofit's connected stripe account
    stripe_account_id: "acct_mine",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_details_submitted: true,
  }))!;
  const theirs = (await seed_npo(db(), {
    registration_number: "EIN-THEM",
    donate_methods: ["crypto", "daf"],
  }))!;
  const key = await mint_key(as_db(db()), {
    npo_id: mine.id,
    minted_by: staff.id,
  });
  await mint_key(as_db(db()), { npo_id: theirs.id, minted_by: staff.id });
  return { staff, mine, theirs, key };
};

const URL_ = "https://app.test/api/partner/v1/readiness";

const get = (
  token: string | null,
  init: { url?: string; headers?: Record<string, string> } = {}
) =>
  loader({
    request: new Request(init.url ?? URL_, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    }),
    params: {},
    context: {},
  } as never);

describe("GET /api/partner/v1/readiness", () => {
  test("a key reads its own nonprofit's readiness, uncached", async () => {
    const { key } = await seed_two();

    const res = await get(key.key);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.revision).toBe(1);
    expect(body.rails.card.state).toBe("active");
    expect(body.rails.crypto.state).toBe("unrequested");
  });

  test("an npo_id in the query, a header or a body selects nothing", async () => {
    const { theirs, key } = await seed_two();
    const id = String(theirs.id);
    const baseline = await get(key.key);
    expect(baseline.status).toBe(200);
    const own = await baseline.json();
    // mine offers card only and theirs crypto and daf, so a body of the wrong
    // nonprofit reads differently from this one
    expect(own.rails.card.state).toBe("active");
    expect(own.rails.daf.state).toBe("unrequested");

    for (const res of [
      await get(key.key, { url: `${URL_}?npo_id=${id}&npo=${id}` }),
      await get(key.key, { headers: { "x-npo-id": id, "npo-id": id } }),
      await loader({
        request: new Request(URL_, {
          method: "GET",
          headers: {
            authorization: `Bearer ${key.key}`,
            "content-type": "application/json",
          },
        }),
        params: { npo_id: id },
        context: {},
      } as never),
    ]) {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(own);
    }
  });

  test.each([
    ["no key", null],
    ["a malformed key", "spk_short"],
  ])("%s gets 401 key_invalid", async (_, token) => {
    await seed_two();

    const res = await get(token);

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(await res.json()).toMatchObject({ code: "key_invalid" });
  });

  test("a revoked key gets 401 key_invalid", async () => {
    const { mine, staff, key } = await seed_two();
    await revoke_key(as_db(db()), {
      id: key.id,
      npo_id: mine.id,
      revoked_by: staff.id,
    });

    const res = await get(key.key);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "key_invalid" });
  });

  test("a read charges the read bucket, so a key out of list/write room still reads", async () => {
    const { key } = await seed_two();
    for (let i = 0; i < LIST_WRITE_QUOTA.max; i++) {
      await charge(
        db() as unknown as Parameters<typeof charge>[0],
        key.id,
        "list_write"
      );
    }

    const res = await get(key.key);

    expect(res.status).toBe(200);
    const windows = await db()
      .select({ key: rate_limit_windows.key, count: rate_limit_windows.count })
      .from(rate_limit_windows);
    expect(windows).toContainEqual({ key: `partner:read:${key.id}`, count: 1 });
  });

  test("a live key whose nonprofit has no tenant row is a reported 500 provider_error", async () => {
    const { key } = await seed_two();
    await db().delete(partner_tenants);

    const res = await get(key.key);

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "provider_error" });
    expect(report_error).toHaveBeenCalledOnce();
  });

  test("the body carries no secret, no key, no key hash and no event secret", async () => {
    const staff = (await seed_user(db(), "ada@test.com"))!;
    const npo = (await seed_npo(db(), {}))!;
    const key = await mint_key(as_db(db()), {
      npo_id: npo.id,
      minted_by: staff.id,
    });
    const [stored] = await db().select().from(partner_keys);
    const [tenant] = await db().select().from(partner_tenants);

    const res = await get(key.key);
    // a 401 or 500 problem body holds no secret either: scan a real body
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({
      revision: 1,
      rails: { card: { state: expect.any(String) } },
      clients: expect.any(Array),
    });

    expect(Object.keys(secrets).length).toBeGreaterThan(10);
    for (const [name, value] of Object.entries(secrets)) {
      expect(text.includes(value), name).toBe(false);
    }
    for (const value of [
      key.key,
      stored.key_hash,
      key.event_secret!,
      tenant.event_secret,
    ]) {
      expect(text).not.toContain(value);
    }
  });

  test("a POST is the contract's not_found and writes nothing: the revision a changed body is owed waits for a GET", async () => {
    const { mine, key } = await seed_two();
    expect((await (await get(key.key)).json()).revision).toBe(1);
    // the body now differs from the stored fingerprint, so any read of it bumps
    await db()
      .update(npos)
      .set({ donate_methods: ["stripe", "daf"] })
      .where(eq(npos.id, mine.id));

    const res = await action({
      request: new Request(URL_, {
        method: "POST",
        headers: { authorization: `Bearer ${key.key}` },
        body: "{}",
      }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "not_found" });
    const [tenant] = await db()
      .select()
      .from(partner_tenants)
      .where(eq(partner_tenants.npo_id, mine.id));
    expect(tenant.revision).toBe(1);

    expect((await (await get(key.key)).json()).revision).toBe(2);
  });
});
