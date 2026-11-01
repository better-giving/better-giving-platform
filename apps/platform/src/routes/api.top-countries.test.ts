import { describe, expect, test, vi } from "vitest";

const countries = vi.hoisted(() => ({
  rows: [] as unknown[],
  fails: false,
}));
vi.mock("$/pg/queries/country", () => ({
  countries_query: async () => {
    if (countries.fails) throw new Error("db down");
    return countries.rows;
  },
}));
const reported = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error: reported }));

const { loader } = await import("./api.top-countries");

const get = () =>
  loader({ request: new Request("https://x/api/top-countries") } as any);

const fresh = new Date("2026-10-28T12:00:00Z");
const stale = new Date("2026-09-01T12:00:00Z");
const row = (
  name: string,
  updated_at: Date,
  total_donations_7d: string,
  total_donations: string
) => ({ name, updated_at, total_donations_7d, total_donations });

const internal_error = {
  error: {
    code: "internal_error",
    message: "Better Giving hit an error and could not complete this request.",
  },
};

describe("GET /api/top-countries", () => {
  test("answers country names, this week's donors first, cached for five minutes", async () => {
    countries.rows = [
      row("Chile", fresh, "5", "10"),
      row("Peru", fresh, "9", "20"),
      // a stale row's 7d total is last week's: it counts as 0
      row("Bolivia", stale, "99", "50"),
      row("Ecuador", fresh, "0", "100"),
    ];
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600"
    );
    expect(await res.json()).toEqual(["Peru", "Chile", "Ecuador", "Bolivia"]);
  });

  test("answers at most ten names", async () => {
    countries.rows = Array.from({ length: 12 }, (_, i) =>
      row(`C${i}`, fresh, String(100 - i), "1")
    );
    const body = await (await get()).json();

    expect(body).toHaveLength(10);
    expect(body[0]).toBe("C0");
  });

  test("answers a thrown query with a reported internal_error json error", async () => {
    countries.fails = true;
    try {
      const res = await get();

      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual(internal_error);
      expect(reported).toHaveBeenCalledOnce();
    } finally {
      countries.fails = false;
    }
  });

  // items[0] is read for the reference week: an empty table throws there
  test("answers an empty table with an internal_error json error", async () => {
    countries.rows = [];
    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(internal_error);
  });
});
