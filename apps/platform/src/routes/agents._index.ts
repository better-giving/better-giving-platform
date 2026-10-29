import type { ActionFunction, LoaderFunction } from "react-router";
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

function rpc_error(id: unknown, code: number, message: string, data?: unknown) {
  return Response.json({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
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
