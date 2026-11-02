import type { LoaderFunction } from "react-router";
import {
  MCP_DESCRIPTION,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TITLE,
  mcp_icons,
} from "./agents/tools";

/** the MCP server card for the donations server, at the path registries read */
export const loader: LoaderFunction = ({ url }) => {
  const { origin } = url;
  return Response.json(
    {
      name: MCP_SERVER_INFO.name,
      title: MCP_TITLE,
      description: MCP_DESCRIPTION,
      version: MCP_SERVER_INFO.version,
      protocolVersion: MCP_PROTOCOL_VERSION,
      icons: mcp_icons(origin),
      websiteUrl: `${origin}/agents`,
      documentation: `${origin}/agents`,
      remotes: [{ type: "streamable-http", url: `${origin}/agents/mcp` }],
      capabilities: { tools: { listChanged: false } },
      authentication: { required: false, schemes: ["bearer"] },
      manifest: `${origin}/.well-known/mcp.json`,
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    }
  );
};
