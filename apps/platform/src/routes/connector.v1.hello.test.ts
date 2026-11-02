import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";

const gate = vi.hoisted(() => ({ throws: false }));
vi.mock("$/connector/gate", async (actual) => {
  const real = await actual<typeof import("$/connector/gate")>();
  return {
    ...real,
    reserve_ip: (...args: Parameters<typeof real.reserve_ip>) => {
      if (gate.throws) throw new Error("limiter down");
      return real.reserve_ip(...args);
    },
  };
});
const reported = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error: reported }));

const { action, loader } = await import("./connector.v1.hello");

const hello = (ip?: string) =>
  loader({
    request: new Request("https://bg.test/connector/v1/hello", {
      headers: ip ? { "x-forwarded-for": ip } : {},
    }),
    params: {},
    context: {},
  } as any) as Promise<Response>;

beforeEach(() => {
  reported.mockClear();
  reset_rate_limits();
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "   ");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /connector/v1/hello", () => {
  test("returns the contract, no-store, and not a redirect", async () => {
    const res = await hello("203.0.113.4");

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
        "create_photo_upload_link",
      ],
    });
  });

  test("release is the trimmed commit sha", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "  abcdef  ");

    const res = await hello("203.0.113.5");

    expect(await res.json()).toMatchObject({ release: "abcdef" });
  });

  test("the 121st GET from one address is 429 and another address still passes", async () => {
    let res = await hello("203.0.113.8");
    for (let i = 1; i < 120; i++) res = await hello("203.0.113.8");
    expect(res.status).toBe(200);

    const limited = await hello("203.0.113.8");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(limited.headers.get("content-type")).toBe(
      "application/problem+json"
    );
    expect(await limited.json()).toEqual({
      code: "rate_limited",
      status: 429,
      error: {
        code: "rate_limited",
        message: "Too many requests. Wait a moment, then retry.",
      },
    });

    expect((await hello("203.0.113.9")).status).toBe(200);
  });

  test("a missing address shares one bucket and does not limit a real address", async () => {
    let res = await hello();
    for (let i = 1; i < 120; i++) res = await hello();
    expect(res.status).toBe(200);
    expect((await hello()).status).toBe(429);
    expect((await hello("203.0.113.10")).status).toBe(200);
  });

  test("a throw is a reported internal_error problem, not react-router's 500", async () => {
    gate.throws = true;
    const res = await hello("203.0.113.11").finally(() => {
      gate.throws = false;
    });

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect((await res.json()).code).toBe("internal_error");
    expect(reported).toHaveBeenCalledOnce();
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
    expect(await res.json()).toEqual({
      code: "unknown_action",
      status: 404,
      error: {
        code: "unknown_action",
        message: "This connector action does not exist.",
      },
    });
  });
});
