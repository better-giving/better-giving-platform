import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { rate_limit_windows } from "$/pg/schema/rate-limit";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({
  current: null as TestDb | null,
  down: false,
}));

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        if (test_db.down) throw new Error("db unreachable");
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));

const mocks = vi.hoisted(() => ({
  create_quote: vi.fn(),
  donate: vi.fn(),
  donation_status: vi.fn(),
  find_nonprofit: vi.fn(),
}));

vi.mock("./agents/engine", async (importOriginal) => {
  const original = await importOriginal<typeof import("./agents/engine")>();
  return { ...original, ...mocks };
});

const { action, loader } = await import("./agents._index");
const { create_test_db } = await import("$/pg/test-utils/pglite");

const post = (body: object, ip = "192.0.2.1") =>
  action({
    request: new Request("https://better.giving/agents", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as any,
  } as any) as Promise<Response>;

const ping = (ip?: string) =>
  post({ jsonrpc: "2.0", id: "p", method: "ping" }, ip);

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await test_db.current!.db.delete(rate_limit_windows);
  // Date only: pglite keeps its own timers
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-01T00:00:15.000Z"));
});

afterEach(() => {
  test_db.down = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("/agents MCP endpoint", () => {
  test("GET serves Laira's hosted-checkout guide", async () => {
    const response = (await loader!({
      request: new Request("https://better.giving/agents"),
      params: {},
      context: {} as any,
    } as any)) as Response;

    expect(response.headers.get("content-type")).toContain("text/markdown");
    const text = await response.text();
    expect(text).toContain("Laira skill");
    expect(text).toContain("Stripe-hosted checkout link");
    expect(text).toContain("not_on_better_giving");
    expect(text).toContain("onboarding_url");
  });

  test("initialize advertises MCP tools", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
      },
    });
  });

  test("tools/call returns structured tool output", async () => {
    mocks.find_nonprofit.mockResolvedValue({
      items: [{ id: 7, name: "ACME" }],
    });

    const response = await post({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "find_nonprofit", arguments: { query: "ACME" } },
    });

    await expect(response.json()).resolves.toMatchObject({
      id: 2,
      result: {
        structuredContent: { items: [{ id: 7, name: "ACME" }] },
      },
    });
    expect(mocks.find_nonprofit).toHaveBeenCalledWith(
      { query: "ACME" },
      expect.any(Request)
    );
  });
});

describe("per-address request limit", () => {
  test("the 61st request in a minute is refused before any tool runs", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await ping()).status).toBe(200);
    }

    const refused = await post({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "find_nonprofit", arguments: { query: "ACME" } },
    });

    expect(refused.status).toBe(429);
    // 00:00:15 → the window ends at 00:01:00
    expect(refused.headers.get("retry-after")).toBe("45");
    await expect(refused.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32029,
        message: "Rate limited: too many requests. Retry after 45 seconds.",
        data: { retry_after_s: 45 },
      },
    });
    expect(mocks.find_nonprofit).not.toHaveBeenCalled();
  });

  test("another address keeps its own allowance", async () => {
    for (let i = 0; i < 60; i++) await ping("192.0.2.1");
    expect((await ping("192.0.2.1")).status).toBe(429);

    expect((await ping("198.51.100.7")).status).toBe(200);
  });

  test("the next minute starts a fresh allowance", async () => {
    for (let i = 0; i < 60; i++) await ping();
    expect((await ping()).status).toBe(429);

    vi.setSystemTime(new Date("2027-01-01T00:01:00.000Z"));

    expect((await ping()).status).toBe(200);
  });

  test("an unreachable limiter lets the request through and logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.find_nonprofit.mockResolvedValue({ items: [] });
    test_db.down = true;

    const response = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "find_nonprofit", arguments: { query: "ACME" } },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 3,
      result: { structuredContent: { items: [] } },
    });
    expect(log).toHaveBeenCalledWith(
      "agents request limit unavailable",
      expect.any(Error)
    );
  });
});
