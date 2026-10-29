import { createHash } from "node:crypto";
import type { ActionFunction, LoaderFunction } from "react-router";
import { client_ip, limit_shared } from "#/.server/auth/rate-limit";
import {
  AgentDonationError,
  create_quote,
  donate,
  donation_status,
  find_nonprofit,
} from "./agents/engine";
import {
  GUIDE,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  tools,
} from "./agents/tools";

function jsonrpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function rpc_error(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
  init?: ResponseInit
) {
  return Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    },
    init
  );
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
    `Request limit reached. Try again in ${s} seconds.`,
    { retry_after_s: s },
    { status: 429, headers: { "retry-after": String(s) } }
  );
}

async function call_tool(name: string, args: unknown, request: Request) {
  switch (name) {
    case "find_nonprofit":
      return find_nonprofit(args, request);
    case "quote_donation":
      return create_quote(args);
    case "donate":
      return donate(args, request);
    case "donation_status":
      return donation_status(args);
    default:
      throw new AgentDonationError("tool_not_found", `Unknown tool: ${name}`);
  }
}

export const loader: LoaderFunction = () =>
  new Response(GUIDE, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const refused = await rate_limited(request);
  if (refused) return refused;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return rpc_error(null, -32700, "Parse error");
  }
  if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpc_error(body?.id ?? null, -32600, "Invalid Request");
  }

  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 204 });
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
    return rpc_error(body.id, -32601, "Method not found");
  }

  try {
    const result = await call_tool(
      body.params?.name,
      body.params?.arguments ?? {},
      request
    );
    return jsonrpc(body.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    });
  } catch (error) {
    if (error instanceof AgentDonationError) {
      return jsonrpc(body.id, {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              code: error.code,
              message: error.message,
            }),
          },
        ],
        structuredContent: { code: error.code, message: error.message },
      });
    }
    throw error;
  }
};
