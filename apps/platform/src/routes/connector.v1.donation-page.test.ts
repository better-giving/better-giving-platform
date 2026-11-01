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
const report_error = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error }));

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
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      code: "internal_error",
      status: 500,
      detail: "Better Giving hit an error and could not complete this request.",
      error: {
        code: "internal_error",
        message:
          "Better Giving hit an error and could not complete this request.",
      },
    });
    expect(report_error).toHaveBeenCalledOnce();
    expect(report_error).toHaveBeenCalledWith(new Error("db down"), {
      where: "connector",
      method: "GET",
      path: "/connector/v1/donation-page",
    });
  });
});
