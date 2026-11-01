import { describe, expect, test, vi } from "vitest";

const quote = vi.hoisted(() => ({
  pc: 0 as unknown,
  res: null as Response | null,
}));
vi.mock("$/kit/finnhub", () => ({
  finnhub: async () => quote.res ?? Response.json(quote),
}));
const reported = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error: reported }));

import { loader } from "./api.tickers.$symbol.estimate";

const estimate = (symbol = "ZZZZ") =>
  loader({
    request: new Request(`https://x/api/tickers/${symbol}/estimate`),
    params: { symbol },
  } as any) as Promise<Response>;

describe("api.tickers.$symbol.estimate loader", () => {
  test.each([0, -3])("answers 404 when the unit price is %s", async (pc) => {
    quote.pc = pc;
    const res = await estimate();

    expect(res.status).toBe(404);
  });

  test("answers a not_found json error naming the caller's symbol, cached like a price", async () => {
    quote.pc = 0;
    const res = await estimate("ZZ\nZZ");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=30, stale-while-revalidate=60"
    );
    await expect(res.json()).resolves.toEqual({
      error: { code: "not_found", message: "no price for ZZ\nZZ" },
    });
  });

  test("answers the minimum units for a priced ticker", async () => {
    quote.pc = 25;
    const res = await estimate();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    await expect(res.text()).resolves.toBe('{"min":2,"usdpu":25}');
  });

  // before: finnhub's own failing response was rethrown and passed through
  test("answers an upstream failure with a reported internal_error, not finnhub's body", async () => {
    quote.res = new Response("finnhub says no", { status: 429 });
    Object.defineProperty(quote.res, "url", {
      value: "https://finnhub.io/api/v1/quote?token=SECRET&symbol=ZZZZ",
    });
    try {
      const res = await estimate();

      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("no-store");
      await expect(res.json()).resolves.toEqual({
        error: {
          code: "internal_error",
          message:
            "Better Giving hit an error and could not complete this request.",
        },
      });
      expect(reported).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "upstream answered 429 finnhub.io/api/v1/quote",
        }),
        expect.objectContaining({ path: "/api/tickers/ZZZZ/estimate" })
      );
    } finally {
      quote.res = null;
    }
  });
});
