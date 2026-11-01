import { describe, expect, test, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

const page = { items: [{ id: 1, name: "A" }], page: 1, pages: 1 };
const search = vi.hoisted(() => ({ fails: false }));
vi.mock("#/.server/npos", () => ({
  search_npos: async () => {
    if (search.fails) throw new Error("db unreachable");
    return page;
  },
}));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

const { action, loader } = await import("./api.npos._index");

const list = (qs: string) =>
  loader({
    ...doc_args(new Request(`https://x/api/npos?${qs}`)),
  } as any) as Promise<Response>;

describe("GET /api/npos", () => {
  // before: a text/plain 400 carrying the issue message
  test("answers a page below 1 with an invalid_request json error", async () => {
    const res = await list("page=0");

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { error } = await res.json();
    expect(error.code).toBe("invalid_request");
    expect(error.message).toMatch(/\S/);
  });

  test("answers a valid search with the page, unchanged", async () => {
    const res = await list("page=1");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    await expect(res.text()).resolves.toBe(JSON.stringify(page));
  });

  // before: a cacheable `200 {"items": []}`, read as "nothing matches"
  test("answers a database failure with an uncached internal_error", async () => {
    search.fails = true;
    const res = await list("page=1").finally(() => {
      search.fails = false;
    });

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { error } = await res.json();
    expect(error.code).toBe("internal_error");
  });

  test("answers a write method with method_not_allowed", async () => {
    const res = action();

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
});
