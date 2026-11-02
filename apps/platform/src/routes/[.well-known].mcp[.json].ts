import type { LoaderFunction } from "react-router";
import {
  MCP_DESCRIPTION,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TITLE,
  mcp_icons,
  server_card_url,
  tools,
} from "./agents/tools";

export const loader: LoaderFunction = ({ url }) => {
  const { origin } = url;
  return Response.json(
    {
      name: MCP_SERVER_INFO.name,
      title: MCP_TITLE,
      description: MCP_DESCRIPTION,
      icons: mcp_icons(origin),
      servers: [
        {
          url: `${origin}/agents/mcp`,
          transport: "streamable-http",
          card: server_card_url(origin),
        },
      ],
      version: MCP_SERVER_INFO.version,
      protocolVersion: MCP_PROTOCOL_VERSION,
      endpoint: { url: `${origin}/agents/mcp`, transport: "streamable-http" },
      documentation: `${origin}/agents`,
      skill: `${origin}/agents/skill.md`,
      llms_txt: `${origin}/llms.txt`,
      openapi: `${origin}/openapi.json`,
      authentication: {
        type: "optional-bearer",
        description:
          "Anonymous calls are allowed. An agent token sent as `Authorization: Bearer <token>` gets its own hourly checkout limit; otherwise the limit is per client address.",
      },
      tools: tools.map(({ name, description, inputSchema, annotations }) => ({
        name,
        description,
        inputSchema,
        annotations,
      })),
    },
    { headers: { "cache-control": "public, max-age=300" } }
  );
};
