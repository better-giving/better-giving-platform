import type { LoaderFunction } from "react-router";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO, tools } from "./agents/tools";

export const loader: LoaderFunction = ({ request }) => {
  const { origin } = new URL(request.url);
  return Response.json(
    {
      name: MCP_SERVER_INFO.name,
      title: "Better Giving donations",
      description:
        "Find a nonprofit on Better Giving, quote a one-time USD donation, and hand the donor a Stripe-hosted checkout link.",
      version: MCP_SERVER_INFO.version,
      protocolVersion: MCP_PROTOCOL_VERSION,
      endpoint: { url: `${origin}/agents/mcp`, transport: "streamable-http" },
      documentation: `${origin}/agents`,
      skill: `${origin}/agents/skill.md`,
      llms_txt: `${origin}/llms.txt`,
      authentication: {
        type: "optional-bearer",
        description:
          "Anonymous calls are allowed. An agent token sent as `Authorization: Bearer <token>` gets its own hourly checkout limit; otherwise the limit is per client address.",
      },
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    },
    { headers: { "cache-control": "public, max-age=300" } }
  );
};
