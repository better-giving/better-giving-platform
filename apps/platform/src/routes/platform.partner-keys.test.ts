import path from "node:path";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import {
  createStaticHandler,
  type RouteObject,
  RouterContextProvider,
} from "react-router";
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

// the staff action under its real parent: the route config fs-routes builds,
// the platform layout's own middleware, and react-router's static handler
// running that middleware the way the server runtime does for a resource route
const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const session = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
}));
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
vi.mock("#/.server/auth/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.user ? { user: session.user } : null
      ),
    },
  },
}));
vi.mock("#/errors/report", () => ({ report_error }));

const { create_test_db } = await import("$/pg/test-utils/pglite");
const { user } = await import("$/pg/schema/auth");
const { npos } = await import("$/pg/schema/npo");
const { partner_keys, partner_tenants } = await import("$/pg/schema/partner");
const { find_live_key } = await import("$/partner/keys");

const app_dir = path.resolve(import.meta.dirname, "..");
Object.assign(globalThis, { __reactRouterAppDirectory: app_dir });
const { default: config } = await import("#/routes");

const ROUTE_FILE = "routes/platform.partner-keys.ts";

const find_parent = (
  entries: RouteConfigEntry[],
  file: string
): RouteConfigEntry | undefined => {
  for (const e of entries) {
    if (e.children?.some((c) => c.file === file)) return e;
    const deeper = find_parent(e.children ?? [], file);
    if (deeper) return deeper;
  }
};

const parent = find_parent(await config, ROUTE_FILE);
const child = parent?.children?.find((c) => c.file === ROUTE_FILE);
const parent_mod = await import(
  /* @vite-ignore */ path.join(app_dir, parent!.file)
);
const child_mod = await import(
  /* @vite-ignore */ path.join(app_dir, ROUTE_FILE)
);

const handler = createStaticHandler([
  {
    id: parent!.id,
    path: parent!.path,
    middleware: parent_mod.middleware,
    children: [
      {
        id: child!.id,
        path: child!.path,
        loader: child_mod.loader,
        action: child_mod.action,
      },
    ],
  } as RouteObject,
]);

const URL_ = "https://bg.test/platform/partner-keys";

const hit = async (method: string, body?: unknown): Promise<Response> => {
  const request = new Request(URL_, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const res = await handler.queryRoute(request, {
    requestContext: new RouterContextProvider(),
    generateMiddlewareResponse: (query) => query(request),
  });
  if (!(res instanceof Response)) throw new Error("no response");
  return res;
};

const STAFF = { id: "", role: "admin" };
let console_out: string[];

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  const { db } = test_db.current!;
  await db.delete(partner_keys);
  await db.delete(partner_tenants);
  await db.delete(npos);
  await db.delete(user);
  const staff = (await seed_user(db, "staff@bg.test"))!;
  STAFF.id = staff.id;
  session.user = STAFF;
  report_error.mockReset();
  console_out = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      console_out.push(a.map((x) => String(x)).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = async () =>
  (await seed_npo(test_db.current!.db, { registration_number: "EIN-PK" }))!;

const keys_in_db = () => test_db.current!.db.select().from(partner_keys);

/** the report_error calls and console output must not hold `secret`. the route
 * reports and logs nothing today and has no catch to reach an error path, so
 * this guards a log or report added later; the response is the caller's
 * secret to read and is asserted on by each test */
const expect_unleaked = (secret: string) => {
  expect(JSON.stringify(report_error.mock.calls)).not.toContain(secret);
  expect(console_out.join("\n")).not.toContain(secret);
};

describe("route placement", () => {
  test("nests under the platform layout, whose middleware is auth then admin", async () => {
    expect(parent!.file).toBe("routes/platform/route.tsx");
    const { auth_mdlwr, admin_mdlwr } = await import("#/.server/auth");
    expect(parent_mod.middleware).toEqual([auth_mdlwr, admin_mdlwr]);
  });
});

describe("access", () => {
  test("a signed-in non-admin is refused 403 and nothing is minted", async () => {
    const npo = await seed();
    session.user = { id: STAFF.id, role: "user" };

    const res = await hit("POST", { op: "mint", npo_id: npo.id });

    expect(res.status).toBe(403);
    expect(await keys_in_db()).toHaveLength(0);
  });

  test("no session is sent to sign in and nothing is minted", async () => {
    const npo = await seed();
    session.user = null;

    const res = await hit("POST", { op: "mint", npo_id: npo.id });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `https://bg.test/signup?redirect=${encodeURIComponent("/platform/partner-keys")}`
    );
    expect(await keys_in_db()).toHaveLength(0);
  });
});

describe("mint", () => {
  test("returns the key and event secret once, uncached, minted by the staff user", async () => {
    const npo = await seed();

    const res = await hit("POST", { op: "mint", npo_id: npo.id });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      id: expect.any(String),
      key: expect.stringMatching(/^spk_/),
      prefix: body.key.slice(0, 8),
      last4: body.key.slice(-4),
      event_secret: expect.stringMatching(/^whsec_/),
    });
    const [row] = await keys_in_db();
    expect(row).toMatchObject({ id: body.id, minted_by: STAFF.id });
    expect(await find_live_key(test_db.current!.db as any, body.key)).toEqual({
      id: body.id,
      npo_id: npo.id,
    });
    expect_unleaked(body.key);
    expect_unleaked(body.event_secret);
  });

  test("a later mint returns a key and no event secret", async () => {
    const npo = await seed();
    await hit("POST", { op: "mint", npo_id: npo.id });

    const body = await (
      await hit("POST", { op: "mint", npo_id: npo.id })
    ).json();

    expect(body.key).toMatch(/^spk_/);
    expect(body).toHaveProperty("event_secret", null);
  });

  test("an unknown nonprofit is 404 and creates nothing", async () => {
    const res = await hit("POST", { op: "mint", npo_id: 999_999 });

    expect(res.status).toBe(404);
    expect(await keys_in_db()).toHaveLength(0);
  });
});

describe("rotate", () => {
  test("kills the old key and returns a working new one, no event secret", async () => {
    const npo = await seed();
    const old = await (
      await hit("POST", { op: "mint", npo_id: npo.id })
    ).json();

    const res = await hit("POST", { op: "rotate", npo_id: npo.id });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).not.toHaveProperty("event_secret");
    const db = test_db.current!.db as any;
    expect(await find_live_key(db, old.key)).toBeNull();
    expect(await find_live_key(db, body.key)).toEqual({
      id: body.id,
      npo_id: npo.id,
    });
    const revoked = (await keys_in_db()).find((k) => k.id === old.id);
    expect(revoked?.revoked_by).toBe(STAFF.id);
    expect_unleaked(body.key);
  });

  test("a nonprofit that never minted is 409 and creates nothing", async () => {
    const npo = await seed();

    const res = await hit("POST", { op: "rotate", npo_id: npo.id });

    expect(res.status).toBe(409);
    expect(await keys_in_db()).toHaveLength(0);
  });
});

describe("revoke", () => {
  test("revokes the key, returns no secret, and a second revoke is 404", async () => {
    const npo = await seed();
    const minted = await (
      await hit("POST", { op: "mint", npo_id: npo.id })
    ).json();

    const res = await hit("POST", {
      op: "revoke",
      npo_id: npo.id,
      key_id: minted.id,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: minted.id, revoked: true });
    expect(
      await find_live_key(test_db.current!.db as any, minted.key)
    ).toBeNull();
    const [row] = await keys_in_db();
    expect(row!.revoked_by).toBe(STAFF.id);

    const again = await hit("POST", {
      op: "revoke",
      npo_id: npo.id,
      key_id: minted.id,
    });
    expect(again.status).toBe(404);
  });

  test("a key of another nonprofit is 404 and stays live", async () => {
    const npo = await seed();
    const other = (await seed_npo(test_db.current!.db, {
      registration_number: "EIN-OTHER",
    }))!;
    const minted = await (
      await hit("POST", { op: "mint", npo_id: npo.id })
    ).json();

    const res = await hit("POST", {
      op: "revoke",
      npo_id: other.id,
      key_id: minted.id,
    });

    expect(res.status).toBe(404);
    expect(
      await find_live_key(test_db.current!.db as any, minted.key)
    ).not.toBeNull();
  });
});

describe("refusals", () => {
  // a real nonprofit, so a refusal that let a request through would mint
  test.each([
    ["an unknown op", (id: number) => ({ op: "delete", npo_id: id })],
    ["a missing npo_id", () => ({ op: "mint" })],
    ["a string npo_id", (id: number) => ({ op: "mint", npo_id: String(id) })],
    ["revoke without key_id", (id: number) => ({ op: "revoke", npo_id: id })],
  ])("%s is 400 and nothing is written", async (_, body) => {
    const npo = await seed();

    const res = await hit("POST", body(npo.id));

    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await keys_in_db()).toHaveLength(0);
  });

  test("a body that is not json is 400", async () => {
    const request = new Request(URL_, { method: "POST", body: "op=mint" });
    const res = (await handler.queryRoute(request, {
      requestContext: new RouterContextProvider(),
      generateMiddlewareResponse: (query) => query(request),
    })) as Response;
    expect(res.status).toBe(400);
    expect(await keys_in_db()).toHaveLength(0);
  });

  test("GET is 405", async () => {
    const res = await hit("GET");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
