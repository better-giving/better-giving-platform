import { createHash } from "node:crypto";
import type { ActionFunction, LoaderFunction } from "react-router";
import { client_ip, limit_shared } from "#/.server/auth/rate-limit";
import { report_error } from "#/errors/report";
import {
  AgentDonationError,
  create_quote,
  donate,
  donation_status,
  find_nonprofit,
} from "./agents/engine";
import { jsonrpc, method_not_allowed, rpc_error } from "./agents/rpc";
import {
  GUIDE,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  tools,
} from "./agents/tools";

/** a tool result the model reads and can act on, not a protocol failure */
function tool_error(id: unknown, code: string, message: string) {
  return jsonrpc(id, {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code, message }) }],
    structuredContent: { code, message },
  });
}

const REQUEST_QUOTA = { max: 60, window_s: 60 };

/** per client address, whatever bearer it sends: the bearer is shared by
 * every agent holding it, so it can't tell one caller from another */
async function rate_limited(request: Request): Promise<Response | null> {
  const ip = client_ip(request.headers) ?? "unknown";
  const key = `agents-mcp:ip:${createHash("sha256").update(ip).digest("hex")}`;
  let limit: Awaited<ReturnType<typeof limit_shared>>;
  try {
    limit = await limit_shared(key, REQUEST_QUOTA);
  } catch (err) {
    // fail open: a limiter outage shouldn't refuse requests the rest of the
    // endpoint could still serve
    console.error("agents request limit unavailable", err);
    return null;
  }
  if (limit.ok) return null;
  const s = limit.retry_after_s;
  return rpc_error(
    null,
    -32029,
    `Request limit reached. Try again in ${s} ${s === 1 ? "second" : "seconds"}.`,
    { code: "rate_limited", retry_after_s: s },
    { status: 429, headers: { "retry-after": String(s) } }
  );
}

type ToolName = (typeof tools)[number]["name"];

const run_tool: Record<
  ToolName,
  (args: unknown, request: Request) => Promise<unknown>
> = {
  find_nonprofit,
  quote_donation: (args) => create_quote(args),
  donate,
  donation_status: (args) => donation_status(args),
};

const is_tool = (name: string): name is ToolName =>
  Object.hasOwn(run_tool, name);

export const loader: LoaderFunction = () =>
  new Response(GUIDE, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      vary: "Accept",
    },
  });

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== "POST") {
    return method_not_allowed(request.method, "GET, POST");
  }
  const refused = await rate_limited(request);
  if (refused) return refused;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return rpc_error(null, -32700, "Parse error", { code: "parse_error" });
  }
  try {
    return await respond(body, request);
  } catch (error) {
    report_error(error, { where: "agents mcp", method: body?.method });
    return rpc_error(
      body?.id ?? null,
      -32603,
      "Better Giving hit an error and could not complete this request.",
      { code: "internal_error" },
      { status: 500 }
    );
  }
};

async function respond(body: any, request: Request): Promise<Response> {
  if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpc_error(body?.id ?? null, -32600, "Invalid Request", {
      code: "invalid_request",
    });
  }

  if (body.method.startsWith("notifications/") && !Object.hasOwn(body, "id")) {
    return new Response(null, { status: 202 });
  }
  if (body.method === "ping") return jsonrpc(body.id, {});
  if (body.method === "initialize") {
    return jsonrpc(body.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: MCP_SERVER_INFO,
      instructions: GUIDE,
    });
  }
  if (body.method === "tools/list") return jsonrpc(body.id, { tools });
  if (body.method !== "tools/call") {
    return rpc_error(body.id, -32601, "Method not found", {
      code: "method_not_found",
    });
  }

  const name: unknown = body.params?.name;
  if (typeof name !== "string") {
    return rpc_error(
      body.id,
      -32602,
      "params.name must be a tool name string.",
      { code: "invalid_params" }
    );
  }
  if (!is_tool(name)) {
    return rpc_error(body.id, -32602, `Unknown tool: ${name}`, {
      code: "tool_not_found",
    });
  }

  const given: unknown = body.params.arguments;
  const args = given === undefined ? {} : given;
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return tool_error(body.id, "invalid_input", "arguments must be an object.");
  }

  try {
    const result = await run_tool[name](args, request);
    return jsonrpc(body.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  } catch (error) {
    if (error instanceof AgentDonationError) {
      return tool_error(body.id, error.code, error.message);
    }
    report_error(error, { where: "agents mcp", tool: name });
    return tool_error(
      body.id,
      "internal_error",
      "Better Giving hit an error and could not complete this call. Try again shortly."
    );
  }
}
