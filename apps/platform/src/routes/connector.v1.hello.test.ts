import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";
import { action, loader } from "./connector.v1.hello";

const hello = (ip?: string) =>
  loader({
    request: new Request("https://bg.test/connector/v1/hello", {
      headers: ip ? { "x-forwarded-for": ip } : {},
    }),
    params: {},
    context: {},
  } as any) as Response;

beforeEach(() => {
  reset_rate_limits();
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "   ");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /connector/v1/hello", () => {
  test("returns the contract, no-store, and not a redirect", async () => {
    const res = hello("203.0.113.4");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      service: "better-giving",
      contract: 1,
      release: "dev",
      name: "Better Giving",
      actions: [
        "hello",
        "exchange",
        "disconnect",
        "list_campaigns",
        "get_campaign",
        "create_campaign",
        "update_campaign_settings",
        "update_campaign_blocks",
        "publish_campaign",
        "end_campaign",
        "get_donation_page",
        "get_block_catalog",
        "list_forms",
        "get_form",
        "create_form",
        "update_form",
        "get_results",
        "list_donations",
        "list_donors",
        "get_donor",
        "list_recurring_gifts",
      ],
    });
  });

  test("release is the trimmed commit sha", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "  abcdef  ");

    const res = hello("203.0.113.5");

    expect(await res.json()).toMatchObject({ release: "abcdef" });
  });

  test("the 121st GET from one address is 429 and another address still passes", async () => {
    let res = hello("203.0.113.8");
    for (let i = 1; i < 120; i++) res = hello("203.0.113.8");
    expect(res.status).toBe(200);

    const limited = hello("203.0.113.8");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(limited.headers.get("content-type")).toBe(
      "application/problem+json"
    );
    expect(await limited.json()).toEqual({ code: "rate_limited", status: 429 });

    expect(hello("203.0.113.9").status).toBe(200);
  });

  test("a missing address shares one bucket and does not limit a real address", () => {
    let res = hello();
    for (let i = 1; i < 120; i++) res = hello();
    expect(res.status).toBe(200);
    expect(hello().status).toBe(429);
    expect(hello("203.0.113.10").status).toBe(200);
  });
});

describe("POST /connector/v1/hello", () => {
  test("is unknown_action", async () => {
    const res = (await action({
      request: new Request("https://bg.test/connector/v1/hello", {
        method: "POST",
      }),
      params: {},
      context: {},
    } as any)) as Response;

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(405);
    expect(await res.json()).toEqual({ code: "unknown_action", status: 404 });
  });
});
