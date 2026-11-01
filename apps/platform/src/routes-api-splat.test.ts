import { fileURLToPath } from "node:url";
import { matchRoutes, type RouteObject } from "react-router";
import { beforeAll, describe, expect, test } from "vitest";

type Entry = { id?: string; path?: string; children?: Entry[] };

// the same tree react-router builds from `src/routes.ts`; no build needed
// because matching reads only paths and ids, never the route modules
let tree: RouteObject[];

const to_objects = (entries: Entry[]): RouteObject[] =>
  entries.map((e) => ({
    id: e.id,
    path: e.path,
    ...(e.children ? { children: to_objects(e.children) } : {}),
  })) as RouteObject[];

beforeAll(async () => {
  // flatRoutes reads the app directory from this global, which the
  // react-router vite plugin sets in a real run
  (
    globalThis as { __reactRouterAppDirectory?: string }
  ).__reactRouterAppDirectory = fileURLToPath(new URL(".", import.meta.url));
  const config: Entry[] = await (await import("./routes")).default;
  tree = [{ id: "root", path: "/", children: to_objects(config) }];
});

const matched_id = (path: string) => matchRoutes(tree, path)?.at(-1)?.route.id;

// before: no route matched an unknown /api/... url and the root's html 404 rendered
describe("an unknown url under /api", () => {
  test.each([
    ["/api/no-such-endpoint"],
    ["/api/npos/1/extra"],
    ["/api/tickers/AAPL/estimate/extra"],
    ["/api/a/b/c/d"],
  ])("%s reaches the api splat", (path) => {
    expect(matched_id(path)).toBe("routes/api.$");
  });

  test.each([
    ["/api/npos/1", "routes/api.npos.$id"],
    ["/api/npos", "routes/api.npos._index"],
    ["/api/tickers/AAPL/estimate", "routes/api.tickers.$symbol.estimate"],
  ])("%s still reaches its own route, not the splat", (path, id) => {
    expect(matched_id(path)).toBe(id);
  });
});
