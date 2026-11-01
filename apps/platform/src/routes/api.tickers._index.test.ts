import { describe, expect, test, vi } from "vitest";

const fuse = vi.hoisted(() => ({ fails: false }));
vi.mock("fuse.js", async (actual) => {
  const Real = (await actual<typeof import("fuse.js")>()).default;
  return {
    default: class extends Real<unknown> {
      override search(
        ...args: Parameters<InstanceType<typeof Real>["search"]>
      ) {
        if (fuse.fails) throw new Error("index broke");
        return super.search(...args);
      }
    },
  };
});
const reported = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error: reported }));

const { loader } = await import("./api.tickers._index");

const list = (qs = "") =>
  loader({ request: new Request(`https://x/api/tickers${qs}`) } as any);

describe("GET /api/tickers", () => {
  test("answers the first ten tickers when no query is sent, cached for an hour", async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=3600"
    );
    const body = await res.json();
    expect(body).toHaveLength(10);
    expect(body[0]).toEqual({ symbol: "LNTO", name: "LELANTOS HOLDINGS INC" });
  });

  test("answers a query with the best matches first", async () => {
    const res = await list("?q=aapl");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=3600"
    );
    const body = await res.json();
    expect(body.length).toBeLessThanOrEqual(10);
    expect(body[0]).toEqual({ symbol: "AAPL", name: "APPLE INC" });
  });

  test("answers a thrown search with a reported internal_error json error", async () => {
    fuse.fails = true;
    try {
      const res = await list("?q=aapl");

      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        error: {
          code: "internal_error",
          message:
            "Better Giving hit an error and could not complete this request.",
        },
      });
      expect(reported).toHaveBeenCalledOnce();
    } finally {
      fuse.fails = false;
    }
  });
});
