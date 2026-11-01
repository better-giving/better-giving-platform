import { beforeEach, describe, expect, test, vi } from "vitest";

const reported = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error: reported }));

const { public_api_route, read_only } = await import("./public-api");

const request = new Request("https://bg.test/api/things?q=x", {
  method: "GET",
});
const internal_error = {
  error: {
    code: "internal_error",
    message: "Better Giving hit an error and could not complete this request.",
  },
};

const upstream = (status: number, url: string) => {
  const res = new Response("upstream body", { status });
  Object.defineProperty(res, "url", { value: url });
  return res;
};

beforeEach(() => reported.mockReset());

describe("public_api_route", () => {
  test("passes the handler's response through untouched", async () => {
    const res = await public_api_route(async () => Response.json({ a: 1 }))({
      request,
    });

    expect(await res.json()).toEqual({ a: 1 });
    expect(reported).not.toHaveBeenCalled();
  });

  test("a thrown upstream Response is reported with its host and path only", async () => {
    const res = await public_api_route(async () => {
      throw upstream(429, "https://api.up.example/v1/quote?token=SECRET&s=Z");
    })({ request });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(internal_error);
    expect(reported).toHaveBeenCalledOnce();
    const [error, ctx] = reported.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("upstream answered 429 api.up.example/v1/quote");
    expect(ctx).toEqual({
      where: "public-api",
      method: "GET",
      path: "/api/things",
    });
    expect(JSON.stringify([error.message, ctx])).not.toContain("SECRET");
  });

  test("a thrown upstream Response without a url is reported by status alone", async () => {
    await public_api_route(async () => {
      throw upstream(502, "");
    })({ request });

    expect(reported.mock.calls[0][0].message).toBe("upstream answered 502");
  });

  test("a thrown error is reported as itself and answered internal_error", async () => {
    const boom = new Error("db down");
    const res = await public_api_route(async () => {
      throw boom;
    })({ request });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(internal_error);
    expect(reported.mock.calls[0][0]).toBe(boom);
  });
});

describe("read_only", () => {
  test("answers 405 method_not_allowed naming GET and HEAD", async () => {
    const res = read_only();

    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect((await res.json()).error.code).toBe("method_not_allowed");
  });
});
