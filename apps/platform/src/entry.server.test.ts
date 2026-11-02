import { createElement as h, Suspense } from "react";
import { jsx } from "react/jsx-runtime";
import {
  Await,
  createRequestHandler,
  Meta,
  Outlet,
  Scripts,
  type ServerBuild,
  useAsyncValue,
  useLoaderData,
} from "react-router";
import { describe, expect, test } from "vitest";
import * as entry from "./entry.server";
import * as pricing from "./routes/_landing.pricing/route";

const ORIGIN = "https://www.better.giving";
const BROWSER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

function Root() {
  return h(
    "html",
    null,
    h("head", null, h(Meta)),
    h(
      "body",
      null,
      h("header", null, h("nav", null, h("a", { href: "/login" }, "Log in"))),
      h(Outlet),
      h("footer", null, "Site footer"),
      h(Scripts)
    )
  );
}

function Story() {
  return h("p", null, useAsyncValue() as string);
}

function Page() {
  const { name, story } = useLoaderData() as {
    name: string;
    story: Promise<string>;
  };
  return h(
    "main",
    null,
    h("h2", null, name),
    h("a", { href: "/donate/7" }, "Donate"),
    h(
      Suspense,
      { fallback: h("p", null, "Loading story") },
      jsx(Await, { resolve: story, children: h(Story) })
    )
  );
}

const page_module = (handle?: object) => ({
  default: Page,
  handle,
  meta: () => [{ title: "Acme Fund" }],
  headers: () => ({ "cache-control": "public, max-age=60", vary: "Cookie" }),
  loader: () => ({
    name: "Acme",
    story: new Promise<string>((r) =>
      setTimeout(() => r("Deferred story"), 20)
    ),
  }),
});

const entry_route = (
  id: string,
  path: string,
  parentId?: string,
  hasLoader = true
) => ({
  id,
  path,
  parentId,
  module: `/${id}.js`,
  hasAction: false,
  hasLoader,
  hasClientAction: false,
  hasClientLoader: false,
  hasClientMiddleware: false,
  hasErrorBoundary: false,
});

const build = {
  entry: { module: entry },
  routes: {
    root: { id: "root", path: "", module: { default: Root } },
    opted: {
      id: "opted",
      parentId: "root",
      path: "opted",
      module: page_module({ markdown: true }),
    },
    plain: {
      id: "plain",
      parentId: "root",
      path: "plain",
      module: page_module(),
    },
    pricing: {
      id: "pricing",
      parentId: "root",
      path: "pricing",
      module: pricing,
    },
  },
  assets: {
    entry: { imports: [], module: "/entry.client.js" },
    routes: {
      root: entry_route("root", "", undefined, false),
      opted: entry_route("opted", "opted", "root"),
      plain: entry_route("plain", "plain", "root"),
      pricing: entry_route("pricing", "pricing", "root", false),
    },
    url: "/manifest.js",
    version: "test",
  },
  publicPath: "/",
  assetsBuildDirectory: "build",
  future: { v8_middleware: true },
  ssr: true,
  isSpaMode: false,
  prerender: [],
  routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
} as unknown as ServerBuild;

const serve = (path: string, accept?: string, method = "GET") =>
  createRequestHandler(
    build,
    "production"
  )(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: accept ? { accept } : {},
    })
  );

describe("markdown negotiation in the document entry", () => {
  test("an opted-in page answers a markdown Accept with its main content", async () => {
    const res = await serve("/opted", "text/markdown");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(res.headers.get("vary")).toBe("Cookie, Accept");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const md = await res.text();
    expect(md.startsWith("# Acme Fund\n\n## Acme")).toBe(true);
    expect(md).toContain(`[Donate](${ORIGIN}/donate/7)`);
    expect(md).toContain("Deferred story");
    for (const gone of [
      "Log in",
      "Site footer",
      "Loading story",
      "<",
      "__reactRouter",
    ]) {
      expect(md).not.toContain(gone);
    }
  });

  test.each([[BROWSER], ["*/*"], [undefined], ["text/markdown, text/html"]])(
    "the same page keeps its html for Accept %s, varied",
    async (accept) => {
      const res = await serve("/opted", accept);
      expect(res.headers.get("content-type")).toBe("text/html");
      expect(res.headers.get("vary")).toBe("Cookie, Accept");
      expect(await res.text()).toContain("<main>");
    }
  );

  test("a page that did not opt in is untouched", async () => {
    const res = await serve("/plain", "text/markdown");
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("vary")).toBe("Cookie");
    expect(await res.text()).toContain("<main>");
  });

  test("HEAD on an opted-in page reports what GET would send, with no body", async () => {
    const md = await serve("/opted", "text/markdown", "HEAD");
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(md.headers.get("vary")).toBe("Cookie, Accept");
    expect(await md.text()).toBe("");

    const html = await serve("/opted", BROWSER, "HEAD");
    expect(html.headers.get("content-type")).toBe("text/html");
    expect(html.headers.get("vary")).toBe("Cookie, Accept");
  });

  test("HEAD on a page that did not opt in is untouched", async () => {
    const res = await serve("/plain", "text/markdown", "HEAD");
    expect(res.headers.get("content-type")).toBeNull();
    expect(res.headers.get("vary")).toBe("Cookie");
  });

  test("a real opted-in page renders its content as markdown", async () => {
    const res = await serve("/pricing", "text/markdown");
    expect(res.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    const md = await res.text();
    expect(md).toMatch(/^# Pricing \| /);
    expect(md).toContain("Free. Forever.");
    expect(md).not.toMatch(/\]\(\//);
  });

  test("a 404 stays html", async () => {
    const res = await serve("/missing", "text/markdown");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html");
  });
});
