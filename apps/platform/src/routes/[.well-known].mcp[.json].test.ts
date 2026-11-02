import { describe, expect, test } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import { loader as bare_loader } from "./[.well-known].mcp";
import { loader } from "./[.well-known].mcp[.json]";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO, tools } from "./agents/tools";

const card_at = (load: typeof loader, path: string) =>
  load({
    ...doc_args(new Request(`https://preview.better.giving${path}`)),
    params: {},
    context: {},
  } as never) as Promise<Response>;

describe("/.well-known/mcp.json", () => {
  test("/.well-known/mcp answers the same card, byte for byte", async () => {
    const [json, bare] = await Promise.all([
      card_at(loader, "/.well-known/mcp.json"),
      card_at(bare_loader, "/.well-known/mcp"),
    ]);

    expect(bare.status).toBe(200);
    for (const h of ["content-type", "cache-control"]) {
      expect(bare.headers.get(h), h).toBe(json.headers.get(h));
    }
    expect(await bare.text()).toBe(await json.text());
  });

  test("describes the MCP server with urls at the request origin", async () => {
    const res = await card_at(loader, "/.well-known/mcp.json");

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
      openapi: "https://preview.better.giving/openapi.json",
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
