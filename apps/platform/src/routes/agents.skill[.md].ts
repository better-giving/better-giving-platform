import type { LoaderFunction } from "react-router";
import { GUIDE, MCP_PROTOCOL_VERSION, MCP_URL, tools } from "./agents/tools";

interface ISchema {
  type?: string;
  format?: string;
  const?: unknown;
  enum?: readonly unknown[];
  oneOf?: readonly ISchema[];
  minimum?: number;
  properties?: Readonly<Record<string, ISchema>>;
  required?: readonly string[];
  anyOf?: readonly { required: readonly string[] }[];
}

function type_label(s: ISchema): string {
  if (s.oneOf) return s.oneOf.map(type_label).join(" | ");
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  let label = s.type ?? "any";
  if (s.format) label += ` (${s.format})`;
  if (s.minimum !== undefined) label += `, minimum ${s.minimum}`;
  return label;
}

function argument_lines(s: ISchema, indent = ""): string[] {
  const required = new Set(s.required);
  return Object.entries(s.properties ?? {}).flatMap(([name, prop]) => [
    `${indent}- \`${name}\`${required.has(name) ? " (required)" : ""}: ${type_label(prop)}`,
    ...argument_lines(prop, `${indent}  `),
  ]);
}

function tool_section(tool: (typeof tools)[number]): string {
  const schema: ISchema = tool.inputSchema;
  const lines = [
    `### \`${tool.name}\``,
    "",
    tool.description,
    "",
    "Arguments:",
    "",
  ];
  lines.push(...argument_lines(schema));
  if (schema.anyOf) {
    const names = schema.anyOf.flatMap((group) => group.required);
    lines.push(
      "",
      `Requires at least one of ${names.map((n) => `\`${n}\``).join(", ")}.`
    );
  }
  return lines.join("\n");
}

export const loader: LoaderFunction = ({ request }) => {
  const { origin } = new URL(request.url);
  const mcp_url = `${origin}/agents/mcp`;
  // one server throughout: a preview host names its own endpoint, not production's
  const body = `${GUIDE.replaceAll(MCP_URL, mcp_url)}
## Tools

${tools.map(tool_section).join("\n\n")}

## Endpoint

JSON-RPC 2.0 over HTTP POST (MCP Streamable HTTP, JSON responses) at
\`${mcp_url}\`. \`initialize\` returns protocol version
\`${MCP_PROTOCOL_VERSION}\`; then call \`tools/list\` and \`tools/call\`.
`;
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
};
