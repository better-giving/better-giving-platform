import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NPO_PUBLIC_KEYS } from "$/pg/queries/npo";
import { npos } from "$/pg/schema/npo";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

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

const { action, loader } = await import("./api.npos.$id");
const { create_test_db } = await import("$/pg/test-utils/pglite");

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

describe("GET /api/npos/:id", () => {
  it("answers an anonymous caller without the npo's private fields", async () => {
    const [npo] = await test_db
      .current!.db.insert(npos)
      .values({
        registration_number: "EIN-1",
        name: "Public Name",
        slug: "public-name",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
        // an unset target is `undefined`, which JSON.stringify drops off the wire
        target_smart: true,
      })
      .returning();

    for (const id of [String(npo.id), "public-name"]) {
      const res = (await loader({
        request: new Request(`https://x/api/npos/${id}`),
        params: { id },
      } as any)) as Response;
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ id: npo.id, name: "Public Name" });
      expect(Object.keys(body).sort()).toEqual([...NPO_PUBLIC_KEYS].sort());
      expect(res.headers.get("cache-control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=300"
      );
    }
  });

  const get = (id: string) =>
    loader({
      request: new Request(`https://x/api/npos/${encodeURIComponent(id)}`),
      params: { id },
    } as any) as Promise<Response>;

  // before: a thrown text/plain 400 carrying the issue message
  it.each(["!!bad", "0", "a..b"])(
    "answers the malformed id %s with an invalid_request json error that says what an id is",
    async (id) => {
      const res = await get(id);

      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toBe("application/json");
      const body = await res.json();
      expect(body.error.code).toBe("invalid_request");
      expect(body.error.message).toBe(
        "must be a nonprofit id: a positive integer, or a slug of letters, numbers, -, ., _ and ~"
      );
    }
  );

  // before: an empty-bodied 404
  it("answers an unknown or inactive npo with a not_found json error", async () => {
    await test_db.current!.db.insert(npos).values({
      registration_number: "EIN-2",
      name: "Gone",
      slug: "gone-npo",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      active: false,
    });

    for (const id of ["999999", "no-such-npo", "gone-npo"]) {
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        error: { code: "not_found", message: "No nonprofit has this id." },
      });
    }
  });

  // before: react-router's 405 `{"message":"Unexpected Server Error"}`, no allow
  it("answers a write method with method_not_allowed naming GET and HEAD", async () => {
    const res = action();

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(await res.json()).toEqual({
      error: {
        code: "method_not_allowed",
        message: "This endpoint answers GET and HEAD only.",
      },
    });
  });
});
