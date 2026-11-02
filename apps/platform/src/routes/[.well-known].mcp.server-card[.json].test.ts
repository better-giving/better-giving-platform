import { fileURLToPath } from "node:url";
import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, test } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";
import { loader } from "./[.well-known].mcp.server-card[.json]";
import { MCP_SERVER_INFO } from "./agents/tools";

describe("/.well-known/mcp/server-card.json", () => {
  test("describes the server, branded, with urls at the request origin", async () => {
    const res = (await loader({
      ...doc_args(
        new Request(
          "https://preview.better.giving/.well-known/mcp/server-card.json"
        )
      ),
      params: {},
      context: {},
    } as never)) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({
      name: MCP_SERVER_INFO.name,
      title: "Better Giving donations",
      description: expect.stringContaining("nonprofit"),
      icons: [{ src: "https://preview.better.giving/logo.png" }],
      remotes: [
        {
          type: "streamable-http",
          url: "https://preview.better.giving/agents/mcp",
        },
      ],
    });
  });

  test("is routed at its well-known path, and /index.md at the homepage twin", async () => {
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
    const id = (path: string) => matchRoutes(tree, path)?.at(-1)?.route.id;
    expect(id("/.well-known/mcp/server-card.json")).toBe(
      "routes/[.well-known].mcp.server-card[.json]"
    );
    expect(id("/index.md")).toBe("routes/[index.md]");
  });
});
