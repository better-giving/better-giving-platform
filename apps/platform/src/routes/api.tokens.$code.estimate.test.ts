import { describe, expect, test, vi } from "vitest";

vi.mock("$/kit/coingecko", () => ({ coingecko: vi.fn() }));
vi.mock("$/kit/nowpayments", () => ({ np: {} }));

const { loader } = await import("./api.tokens.$code.estimate");

describe("GET /api/tokens/:code/estimate", () => {
  // before: a thrown text/plain "not found"
  test("answers an unlisted token code with a not_found json error", async () => {
    const res = await loader({
      request: new Request("https://x/api/tokens/NOPE/estimate"),
      params: { code: "NOPE" },
    } as any);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: "No token has this code." },
    });
  });
});
