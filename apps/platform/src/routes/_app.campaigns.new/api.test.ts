import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { user } from "$/pg/schema/auth";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const session_mock = vi.hoisted(() => ({
  user: undefined as { id: string; role: string } | undefined,
}));

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
  (await import("$/auth/test-utils")).make_auth_mock({
    session: session_mock,
  })
);

const { loader, action } = await import("./api");
const { to_auth } = await import("#/.server/auth");
const { create_test_db } = await import("$/pg/test-utils/pglite");

const USER_ID = "u1";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.mocked(to_auth).mockClear();
  session_mock.user = undefined;
  const db = test_db.current!.db;
  await db.delete(user_npo_memberships);
  await db.delete(npos);
  await db.delete(user);
  await db.insert(user).values({
    id: USER_ID,
    name: "Ada Admin",
    email: "ada@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Ada",
    last_name: "Admin",
  });
});

async function npo(name: string, ein: string) {
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({
      registration_number: ein,
      name,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  return row!;
}

async function member(npo_id: number) {
  await test_db.current!.db.insert(user_npo_memberships).values({
    user_id: USER_ID,
    npo_id,
  });
}

function call(which: "loader" | "action", url: string) {
  const request = new Request(url, {
    method: which === "action" ? "POST" : "GET",
  });
  const fn = which === "action" ? action : loader;
  return fn({ request, params: {} } as any) as Promise<Response>;
}

describe("/campaigns/new", () => {
  it.each(["loader", "action"] as const)(
    "%s sends an unsigned visitor to sign-in",
    async (which) => {
      const res = await call(which, "https://x/campaigns/new");
      expect(to_auth).toHaveBeenCalled();
      expect(res.status).toBe(401);
    }
  );

  it.each(["loader", "action"] as const)(
    "%s sends a signed-in user who administers no nonprofit to the marketplace",
    async (which) => {
      session_mock.user = { id: USER_ID, role: "admin" };
      const res = await call(which, "https://x/campaigns/new?npo=9");
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/marketplace");
    }
  );

  it.each(["loader", "action"] as const)(
    "%s opens Campaigns → New for the nonprofit named in ?npo=",
    async (which) => {
      const first = await npo("First", "EIN-NEW-1");
      const named = await npo("Named", "EIN-NEW-2");
      await member(first.id);
      await member(named.id);
      session_mock.user = { id: USER_ID, role: "user" };

      const res = await call(which, `https://x/campaigns/new?npo=${named.id}`);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        `/admin/${named.id}/campaigns/new`
      );
    }
  );

  it.each(["loader", "action"] as const)(
    "%s uses the first membership when ?npo= is not one of theirs",
    async (which) => {
      const low = await npo("Low", "EIN-NEW-LOW");
      const high = await npo("High", "EIN-NEW-HIGH");
      await member(high.id);
      await member(low.id);
      session_mock.user = { id: USER_ID, role: "user" };

      const res = await call(which, "https://x/campaigns/new?npo=999999");

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        `/admin/${low.id}/campaigns/new`
      );
    }
  );
});
