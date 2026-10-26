import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { user } from "$/pg/schema/auth";
import { funds as fund_table } from "$/pg/schema/fund";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const session_mock = vi.hoisted(() => ({
  user: { id: "u1", email: "ada@test.com", role: "user" } as any,
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
    user_ctx: true,
  })
);

const { action } = await import("./api");
const { create_test_db } = await import("$/pg/test-utils/pglite");

beforeAll(async () => {
  test_db.current = await create_test_db();
  await test_db.current.db.insert(user).values({
    id: "u1",
    name: "Ada Admin",
    email: "ada@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Ada",
    last_name: "Admin",
  });
  const [npo] = await test_db.current.db
    .insert(npos)
    .values({
      registration_number: "EIN-CREATE",
      name: "Create Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      fund_opt_in: true,
    })
    .returning();
  await test_db.current.db.insert(user_npo_memberships).values({
    user_id: "u1",
    npo_id: npo!.id,
  });
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

describe("fund creation", () => {
  it("does not insert a fund; the action redirects to Campaigns → New", async () => {
    const [npo] = await test_db.current!.db.select().from(npos);
    const fd = new FormData();
    fd.append("name", JSON.stringify("Save The Whales"));
    const res = (await action({
      request: new Request(`http://localhost/campaigns/new?npo=${npo!.id}`, {
        method: "POST",
        body: fd,
      }),
      params: {},
      context: new Map() as any,
    } as any)) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/admin/${npo!.id}/campaigns/new`);
    const rows = await test_db
      .current!.db.select()
      .from(fund_table)
      .where(eq(fund_table.name, "Save The Whales"));
    expect(rows).toEqual([]);
  });
});
