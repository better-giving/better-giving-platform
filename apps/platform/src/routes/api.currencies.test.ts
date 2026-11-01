import { describe, expect, test, vi } from "vitest";

const rates = vi.hoisted(() => ({ row: null as unknown }));
vi.mock("$/pg/queries/country", () => ({
  currency_rates_get: async () => rates.row,
}));
vi.mock("$/kit/stripe", () => ({
  stripe: {
    countrySpecs: {
      retrieve: async () => ({ supported_payment_currencies: ["usd", "eur"] }),
    },
  },
}));
const reported = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error: reported }));

const { loader } = await import("./api.currencies");

const get = (country?: string) =>
  loader({
    request: new Request("https://x/api/currencies", {
      headers: country ? { "x-vercel-ip-country": country } : {},
    }),
  } as any);

describe("GET /api/currencies", () => {
  test("answers the supported currencies with their rates, cached per visitor country", async () => {
    rates.row = { rates: { USD: 1, EUR: 0.5, JPY: 150 } };
    const res = await get("FR");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600"
    );
    expect(res.headers.get("vary")).toBe("x-vercel-ip-country");
    expect(await res.json()).toEqual({
      pref: { code: "EUR", rate: 0.5, min: 1 },
      all: [
        { code: "USD", rate: 1, min: 2 },
        { code: "EUR", rate: 0.5, min: 1 },
      ],
    });
  });

  // before: a thrown text/plain 500 "Currency rates not found"
  test("answers missing rates with a reported internal_error json error", async () => {
    rates.row = null;
    const res = await get();

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
    expect(reported).toHaveBeenCalledOnce();
  });
});
