import { describe, expect, test } from "vitest";
import { action, loader } from "./agents.mcp";

const request = (method: string) =>
  new Request("https://better.giving/agents/mcp", { method });

const refusal = (method: string) => ({
  jsonrpc: "2.0",
  id: null,
  error: {
    code: -32600,
    message: `Method ${method} not allowed. Send JSON-RPC requests with POST.`,
    data: { code: "method_not_allowed" },
  },
});

describe("/agents/mcp", () => {
  // MCP Streamable HTTP: a GET is an SSE stream or a 405, and an SDK client
  // reads any other status as a transport error
  test("GET is a JSON-RPC 405 allowing POST only", async () => {
    const response = (await loader({
      request: request("GET"),
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toEqual(refusal("GET"));
  });

  test.each(["PUT", "DELETE", "PATCH"])(
    "%s is a JSON-RPC 405 allowing POST only",
    async (method) => {
      const response = (await action({
        request: request(method),
        params: {},
        context: {},
      } as never)) as Response;

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      await expect(response.json()).resolves.toEqual(refusal(method));
    }
  );
});
