import { describe, expect, test } from "vitest";
import { loader } from "./[.well-known].mcp[.json]";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO, tools } from "./agents/tools";

describe("/.well-known/mcp.json", () => {
  test("describes the MCP server with urls at the request origin", async () => {
    const res = (await loader({
      request: new Request(
        "https://preview.better.giving/.well-known/mcp.json"
      ),
      params: {},
      context: {},
    } as never)) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const card = await res.json();
    expect(card).toMatchObject({
      name: "better-giving",
      version: MCP_SERVER_INFO.version,
      protocolVersion: MCP_PROTOCOL_VERSION,
      endpoint: {
        url: "https://preview.better.giving/agents/mcp",
        transport: "streamable-http",
      },
      documentation: "https://preview.better.giving/agents",
      skill: "https://preview.better.giving/agents/skill.md",
      llms_txt: "https://preview.better.giving/llms.txt",
      authentication: { type: "optional-bearer" },
    });
    expect(card.tools).toEqual(
      tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }))
    );
  });
});
