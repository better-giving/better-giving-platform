import { fileURLToPath } from "node:url";
import { matchRoutes, type RouteObject } from "react-router";
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

// the tree react-router builds from `src/routes.ts`; flatRoutes reads the app
// directory from this global, which the vite plugin sets in a real run
const route_id_at = async (path: string) => {
  (
    globalThis as { __reactRouterAppDirectory?: string }
  ).__reactRouterAppDirectory = fileURLToPath(new URL("..", import.meta.url));
  const config = (await (
    await import("../routes")
  ).default) as {
    id?: string;
    path?: string;
  }[];
  const tree = [{ id: "root", path: "/", children: config }] as RouteObject[];
  return matchRoutes(tree, path)?.at(-1)?.route.id;
};

const loaders: Record<string, typeof loader> = {
  "routes/[.well-known].mcp": bare_loader,
  "routes/[.well-known].mcp[.json]": loader,
};

describe("/.well-known/mcp.json", () => {
  test("/.well-known/mcp and /.well-known/mcp.json are both routed and answer the same card", async () => {
    const paths = ["/.well-known/mcp", "/.well-known/mcp.json"];
    const ids = await Promise.all(paths.map(route_id_at));
    expect(ids).toEqual(Object.keys(loaders));

    const [bare, json] = await Promise.all(
      paths.map((path, i) => card_at(loaders[ids[i] as string] as never, path))
    );

    expect(bare?.status).toBe(200);
    expect(json?.status).toBe(200);
    for (const h of ["content-type", "cache-control"]) {
      expect(bare?.headers.get(h), h).toBe(json?.headers.get(h));
    }
    expect(await bare?.text()).toBe(await json?.text());
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
