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
import { RPC_ERROR_CODES } from "./agents/rpc";

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

const report_error = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error }));

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
  // a take samples Math.random to sweep; unsampled unless a test says otherwise
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
    expect(text).toContain("error.data.code");
    expect(text).toContain("invalid_input");
    const errors = text.slice(text.indexOf("## Errors")).split("\n## ")[0];
    expect(errors).toContain("## Errors");
    for (const code of RPC_ERROR_CODES) {
      expect(errors, code).toContain(`\`${code}\``);
    }
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

const call = (id: number, params: object) =>
  post({ jsonrpc: "2.0", id, method: "tools/call", params });

describe("MCP errors", () => {
  test("a successful call's body is the tool output and nothing else", async () => {
    mocks.donation_status.mockResolvedValue({ status: "settled" });

    const response = await call(13, {
      name: "donation_status",
      arguments: { donation_id: "d" },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '{"jsonrpc":"2.0","id":13,"result":{"content":[{"type":"text","text":"{\\"status\\":\\"settled\\"}"}],"structuredContent":{"status":"settled"}}}'
    );
  });

  test("an unknown tool is a JSON-RPC invalid-params error", async () => {
    const response = await call(4, { name: "refund", arguments: {} });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: {
        code: -32602,
        message: "Unknown tool: refund",
        data: { code: "tool_not_found" },
      },
    });
  });

  test.each([
    ["missing", { arguments: {} }],
    ["not a string", { name: 7, arguments: {} }],
  ])(
    "a tool name that is %s is a JSON-RPC invalid-params error",
    async (_, params) => {
      const response = await call(5, params);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        jsonrpc: "2.0",
        id: 5,
        error: {
          code: -32602,
          message: "params.name must be a tool name string.",
          data: { code: "invalid_params" },
        },
      });
    }
  );

  test("arguments its validator rejects are a tool error the model can correct", async () => {
    const real =
      await vi.importActual<typeof import("./agents/engine")>(
        "./agents/engine"
      );
    mocks.donation_status.mockImplementation(real.donation_status);

    const response = await call(6, {
      name: "donation_status",
      arguments: { donation_id: "not-a-uuid" },
    });

    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "invalid_input" },
    });
    expect(result.structuredContent.message).toEqual(expect.any(String));
    expect(JSON.parse(result.content[0].text)).toEqual(
      result.structuredContent
    );
  });

  test.each([
    ["a string", "donation_id=1"],
    ["an array", [1]],
    ["null", null],
  ])("arguments that are %s are a tool error", async (_, args) => {
    const response = await call(7, {
      name: "donation_status",
      arguments: args,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 7,
      result: {
        isError: true,
        structuredContent: {
          code: "invalid_input",
          message: "arguments must be an object.",
        },
      },
    });
    expect(mocks.donation_status).not.toHaveBeenCalled();
  });

  test("an engine failure is reported and answered as a generic tool error", async () => {
    const failure = new Error("connection to db-7.internal refused");
    mocks.find_nonprofit.mockRejectedValue(failure);

    const response = await call(8, {
      name: "find_nonprofit",
      arguments: { query: "ACME" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const { result } = await response.json();
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { code: "internal_error" },
    });
    expect(JSON.stringify(result)).not.toContain("db-7.internal");
    expect(report_error).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ tool: "find_nonprofit" })
    );
  });

  test("a failure outside a tool is a JSON-RPC internal error, never an HTML 500", async () => {
    mocks.find_nonprofit.mockRejectedValue(new Error("engine down"));
    report_error.mockImplementationOnce(() => {
      throw new Error("sentry unreachable");
    });

    const response = await call(12, {
      name: "find_nonprofit",
      arguments: { query: "ACME" },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 12,
      error: {
        code: -32603,
        message:
          "Better Giving hit an error and could not complete this request.",
        data: { code: "internal_error" },
      },
    });
    expect(report_error).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "sentry unreachable" }),
      expect.objectContaining({ where: "agents mcp" })
    );
  });

  test.each(["PUT", "DELETE", "PATCH"])(
    "%s is refused with a JSON-RPC error",
    async (method) => {
      const response = (await action({
        request: new Request("https://better.giving/agents", {
          method,
          headers: { "x-forwarded-for": "192.0.2.1" },
        }),
        params: {},
        context: {} as any,
      } as any)) as Response;

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, POST");
      expect(response.headers.get("content-type")).toContain(
        "application/json"
      );
      await expect(response.json()).resolves.toEqual({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: `Method ${method} not allowed. Send JSON-RPC requests with POST.`,
          data: { code: "method_not_allowed" },
        },
      });
    }
  );

  test("a body that is not JSON is a parse error", async () => {
    const response = (await action({
      request: new Request("https://better.giving/agents/mcp", {
        method: "POST",
        headers: { "x-forwarded-for": "192.0.2.1" },
        body: "{not json",
      }),
      params: {},
      context: {} as any,
    } as any)) as Response;

    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
        data: { code: "parse_error" },
      },
    });
  });

  test("a body that is not a JSON-RPC request is an invalid request", async () => {
    const response = await post({ id: 10, method: "ping" });

    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 10,
      error: {
        code: -32600,
        message: "Invalid Request",
        data: { code: "invalid_request" },
      },
    });
  });

  // MCP 2025-06-18 Streamable HTTP: an accepted notification is a 202 with no
  // body, and JSON-RPC never answers one
  test.each([
    "notifications/initialized",
    "notifications/cancelled",
    "notifications/unheard-of",
  ])("the notification %s is accepted with an empty 202", async (method) => {
    const response = await post({
      jsonrpc: "2.0",
      method,
      params: { requestId: 1 },
    });

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("");
  });

  test("an unknown method is method-not-found", async () => {
    const response = await post({
      jsonrpc: "2.0",
      id: 11,
      method: "resources/list",
    });

    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 11,
      error: {
        code: -32601,
        message: "Method not found",
        data: { code: "method_not_found" },
      },
    });
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
        data: { code: "rate_limited", retry_after_s: 45 },
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
