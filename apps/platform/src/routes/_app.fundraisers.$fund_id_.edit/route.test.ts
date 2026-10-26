import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seed_fund, seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { user_fund_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const session = vi.hoisted(() => ({ user: null as any }));

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
vi.mock("#/.server/auth", async () => ({
  ...(await import("$/auth/test-utils")).make_auth_mock(),
  get_session: vi.fn(async () => session),
}));
vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((_d: unknown, msg: string) => ({ toast: msg })),
  dataWithError: vi.fn((_d: unknown, msg: string) => ({ error: msg })),
}));

import { fund_get_or_slug } from "$/pg/queries/fund";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "./route";

const location = (r: Response) => [
  r.status,
  r.headers.get("location"),
  r.headers.get("cache-control"),
];
const MOVED = "public, max-age=3600, s-maxage=86400";
const call = (path: string, fund_id: string) =>
  loader({
    params: { fund_id },
    request: new Request(`https://x${path}`),
  } as never);

describe("old /fundraisers/:fund_id/edit url", () => {
  it("301s to /campaigns/:fund_id/edit, keeping the id and query", async () => {
    expect(
      location(await call("/fundraisers/fund-live/edit", "fund-live"))
    ).toEqual([301, "/campaigns/fund-live/edit", MOVED]);
    expect(
      location(await call("/fundraisers/fund-live/edit?tab=2", "fund-live"))
    ).toEqual([301, "/campaigns/fund-live/edit?tab=2", MOVED]);
  });
});

describe("saving the editor left open on the old url", () => {
  const FUND_ID = "7f1c3b1e-6a55-4c1e-9d7e-3f2a1b0c9d8e";

  beforeAll(async () => {
    test_db.current = await create_test_db();
  }, 30_000);

  afterAll(async () => {
    await test_db.current?.client.close();
  });

  it("runs the campaign editor's action and saves the change", async () => {
    const db = test_db.current!.db;
    const owner_npo = await seed_npo(db);
    const creator = await seed_user(db, "creator@test.com");
    await seed_fund(db, {
      id: FUND_ID,
      name: "Original",
      npo_owner: owner_npo.id,
      creator_id: creator.id,
    });
    await db
      .insert(user_fund_memberships)
      .values({ user_id: creator.id, fund_id: FUND_ID });
    session.user = { ...creator, role: "user" };

    const res = await action({
      params: { fund_id: FUND_ID },
      request: new Request(`https://x/fundraisers/${FUND_ID}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      context: {},
    } as never);

    expect(res).toEqual({ toast: "Campaign updated" });
    expect((await fund_get_or_slug(FUND_ID))?.name).toBe("Renamed");
  });
});
