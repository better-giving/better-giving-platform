import { describe, expect, test, vi } from "vitest";

vi.mock("$/connector/http", async (actual) => ({
  ...(await actual<typeof import("$/connector/http")>()),
  open_key: async () => ({ id: "k1", npo_id: 1, allowed_by: "u1" }),
}));
vi.mock("$/connector/reads", () => ({
  get_donation_page: async () => {
    throw new Error("db down");
  },
}));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

const { loader } = await import("./connector.v1.donation-page");

describe("GET /connector/v1/donation-page", () => {
  test("an unexpected throw answers problem JSON, not a bare 500", async () => {
    const res = await loader({
      request: new Request("https://bg.test/connector/v1/donation-page"),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "internal_error" });
  });
});
