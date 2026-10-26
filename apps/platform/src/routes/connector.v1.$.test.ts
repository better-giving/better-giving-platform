import path from "node:path";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import { createStaticHandler, type RouteObject } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { reset_rate_limits } from "#/.server/auth/rate-limit";

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("connector router test touched db");
      },
    }
  ),
}));

const app_dir = path.resolve(import.meta.dirname, "..");
Object.assign(globalThis, { __reactRouterAppDirectory: app_dir });
const { default: config } = await import("#/routes");

const is_connector = (e: RouteConfigEntry): boolean =>
  e.file.includes("connector.v1") || !!e.children?.some(is_connector);

const to_route = async (e: RouteConfigEntry): Promise<RouteObject> => {
  const mod = e.file.includes("connector.v1")
    ? await import(/* @vite-ignore */ path.join(app_dir, e.file))
    : {};
  const children = await Promise.all(
    (e.children ?? []).filter(is_connector).map(to_route)
  );
  return {
    id: e.id,
    path: e.path,
    index: e.index,
    loader: mod.loader,
    action: mod.action,
    ...(children.length > 0 ? { children } : {}),
  } as RouteObject;
};

const routes: RouteObject[] = [
  {
    id: "root",
    path: "",
    children: await Promise.all(
      (await config).filter(is_connector).map(to_route)
    ),
  },
];

const handler = createStaticHandler(routes);

beforeEach(() => {
  reset_rate_limits();
});

const hit = async (
  method: string,
  pathname: string,
  authorization?: string
) => {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  const res = await handler.queryRoute(
    new Request(`https://bg.test${pathname}`, { method, headers })
  );
  if (!(res instanceof Response)) {
    throw new Error(`${method} ${pathname} did not return a response`);
  }
  return res;
};

describe("unserved connector actions", () => {
  test.each([
    ["POST", "/connector/v1/hello"],
    ["GET", "/connector/v1/exchange"],
    ["GET", "/connector/v1/disconnect"],
    ["GET", "/connector/v1"],
    ["POST", "/connector/v1"],
    ["GET", "/connector/v1/no-such"],
    ["PUT", "/connector/v1/forms"],
    ["POST", "/connector/v1/forms/some-id"],
    ["GET", "/connector/v1/campaigns/some-id/blocks"],
    ["POST", "/connector/v1/campaigns/some-id/settings"],
    ["GET", "/connector/v1/programs"],
    ["POST", "/connector/v1/campaigns/some-id/unpublish"],
    ["GET", "/connector/v1/campaigns/some-id/publish"],
    ["PATCH", "/connector/v1/campaigns/some-id/end"],
    ["PATCH", "/connector/v1/donation-page/blocks"],
    ["POST", "/connector/v1/donation-page/reset"],
    ["PUT", "/connector/v1/campaigns"],
    ["PUT", "/connector/v1/donations"],
    ["POST", "/connector/v1/donations"],
  ])("%s %s is unknown_action and not 405", async (method, pathname) => {
    const res = await hit(method, pathname);

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(405);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ code: "unknown_action", status: 404 });
  });
});

describe("served connector routes without a key", () => {
  test.each([
    ["GET", "/connector/v1/campaigns"],
    ["POST", "/connector/v1/campaigns"],
    ["GET", "/connector/v1/campaigns/some-id"],
    ["PATCH", "/connector/v1/campaigns/some-id/settings"],
    ["PATCH", "/connector/v1/campaigns/some-id/blocks"],
    ["POST", "/connector/v1/campaigns/some-id/publish"],
    ["POST", "/connector/v1/campaigns/some-id/end"],
    ["GET", "/connector/v1/donation-page"],
    ["GET", "/connector/v1/blocks/catalog"],
    ["GET", "/connector/v1/forms"],
    ["GET", "/connector/v1/forms/some-id"],
    ["POST", "/connector/v1/forms"],
    ["PATCH", "/connector/v1/forms/some-id"],
    ["GET", "/connector/v1/results"],
    ["GET", "/connector/v1/donations"],
    ["GET", "/connector/v1/donors"],
    ["GET", "/connector/v1/donors/some-id"],
    ["GET", "/connector/v1/recurring"],
  ])(
    "%s %s is key_refused, not 405, and not a redirect",
    async (method, pathname) => {
      const res = await hit(method, pathname);

      expect(res.status).toBe(401);
      expect(res.status).not.toBe(405);
      expect(res.status >= 300 && res.status < 400).toBe(false);
      expect(await res.json()).toEqual({ code: "key_refused", status: 401 });
    }
  );
});

describe("connector routes do not redirect", () => {
  const paths = [
    "/connector/v1/hello",
    "/connector/v1/hello/",
    "/connector/v1/exchange",
    "/connector/v1/exchange/",
    "/connector/v1/disconnect",
    "/connector/v1/disconnect/",
    "/connector/v1/missing",
    "/connector/v1/missing/",
    "/connector/v1/programs",
    "/connector/v1/programs/",
  ];

  test.each(
    paths.flatMap((pathname) =>
      (["GET", "POST"] as const).flatMap((method) =>
        [undefined, "Bearer nope"].map(
          (authorization) => [method, pathname, authorization] as const
        )
      )
    )
  )("%s %s (%s)", async (method, pathname, authorization) => {
    const res = await hit(method, pathname, authorization);
    expect(res.status >= 300 && res.status < 400).toBe(false);
    expect(res.status).not.toBe(405);
  });
});
