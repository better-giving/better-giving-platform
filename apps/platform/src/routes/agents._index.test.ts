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
const { tool_inputs } = await import("./agents/engine");
const v = await import("valibot");

/** one call per tool that its validator accepts, keyed by the tool's name */
const VALID_ARGS: Record<string, Record<string, unknown>> = {
  find_nonprofit: { query: "ACME", ein: "12-3456789" },
  quote_donation: {
    recipient_id: 7,
    amount: 10,
    currency: "USD",
    frequency: "one-time",
    tip_percent: "10",
    cover_processing_fee: true,
    program_id: crypto.randomUUID(),
  },
  donate: {
    quote_token: "token",
    donor: { email: "a@b.co", first_name: "Ada", last_name: "Lovelace" },
  },
  donation_status: { donation_id: crypto.randomUUID() },
};

interface IProp {
  type?: string;
  format?: string;
  oneOf?: IProp[];
  properties?: Record<string, IProp>;
  additionalProperties?: boolean;
}
interface IListedTool {
  name: string;
  inputSchema: IProp;
}

async function listed_tools(): Promise<IListedTool[]> {
  const response = await post({ jsonrpc: "2.0", id: 9, method: "tools/list" });
  const body = await response.json();
  return body.result.tools;
}
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
  // a take samples Math.random to sweep ended windows; unsampled unless a test says
  vi.spyOn(Math, "random").mockReturnValue(0.5);
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

  test("tools/list advertises the four donation tools", async () => {
    const names = (await listed_tools()).map((t) => t.name);
    expect(names).toEqual([
      "find_nonprofit",
      "quote_donation",
      "donate",
      "donation_status",
    ]);
    expect(Object.keys(VALID_ARGS)).toEqual(names);
  });

  test("each advertised input schema says what its validator enforces", async () => {
    for (const tool of await listed_tools()) {
      const validator = tool_inputs[tool.name as keyof typeof tool_inputs];
      const valid = VALID_ARGS[tool.name]!;
      const accepts = (args: unknown) => v.safeParse(validator, args).success;
      const at = (path: string) => `${tool.name}.${path}`;
      expect(accepts(valid), at("(valid)")).toBe(true);

      const objects: [string, IProp, (o: object) => unknown][] = [
        ["(args)", tool.inputSchema, (o) => o],
        ...Object.entries(tool.inputSchema.properties ?? {})
          .filter(([, p]) => p.type === "object")
          .map(
            ([k, p]) =>
              [k, p, (o: object) => ({ ...valid, [k]: o })] as [
                string,
                IProp,
                (o: object) => unknown,
              ]
          ),
      ];
      for (const [path, schema, wrap] of objects) {
        const base = path === "(args)" ? valid : (valid[path] as object);
        expect(schema.additionalProperties, at(path)).toBe(
          accepts(wrap({ ...base, unknown_arg: 1 })) ? undefined : false
        );
        for (const [k, p] of Object.entries(schema.properties ?? {})) {
          const str =
            p.type === "string" ? p : p.oneOf?.find((b) => b.type === "string");
          if (!str) continue;
          const rejects_free_text = !accepts(
            wrap({ ...base, [k]: "free text" })
          );
          expect(rejects_free_text, at(k)).toBe(str.format !== undefined);
          if (str.format === "uuid") {
            expect(
              accepts(wrap({ ...base, [k]: crypto.randomUUID() })),
              at(k)
            ).toBe(true);
          }
        }
      }
    }
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

/** takes one use through the endpoint, then fills the window it opened */
async function fill_window(ip?: string) {
  await ping(ip);
  await test_db.current!.db.update(rate_limit_windows).set({ count: 60 });
}

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
        message: "Request limit reached. Try again in 45 seconds.",
        data: { retry_after_s: 45 },
      },
    });
    expect(mocks.find_nonprofit).not.toHaveBeenCalled();
  });

  test("another address keeps its own allowance", async () => {
    await fill_window("192.0.2.1");
    expect((await ping("192.0.2.1")).status).toBe(429);

    expect((await ping("198.51.100.7")).status).toBe(200);
  });

  test("the next minute starts a fresh allowance", async () => {
    await fill_window();
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
