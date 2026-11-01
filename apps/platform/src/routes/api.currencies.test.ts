import { describe, expect, test, vi } from "vitest";

vi.mock("$/pg/queries/country", () => ({
  currency_rates_get: async () => null,
}));
vi.mock("$/kit/stripe", () => ({ stripe: {} }));
const reported = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error: reported }));

const { loader } = await import("./api.currencies");

describe("GET /api/currencies", () => {
  // before: a thrown text/plain 500 "Currency rates not found"
  test("answers missing rates with a reported internal_error json error", async () => {
    const res = await loader({
      request: new Request("https://x/api/currencies"),
    } as any);

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
    expect(reported).toHaveBeenCalledOnce();
  });
});
