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
import { describe, expect, test, vi } from "vitest";
import { report_error } from "#/errors/report";
import * as entry from "./entry.server";
import * as pricing from "./routes/_landing.pricing/route";

vi.mock("#/errors/report", async (original) => ({
  ...(await original<typeof import("#/errors/report")>()),
  report_error: vi.fn(),
}));

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

// over react's default progressiveChunkSize (12,800 bytes)
const BIG_STORY = `Long story ${"word ".repeat(3_000)}end of story`;

const page_module = (handle?: object, story = "Deferred story") => ({
  default: Page,
  handle,
  meta: () => [{ title: "Acme Fund" }],
  headers: () => ({ "cache-control": "public, max-age=60", vary: "Cookie" }),
  loader: () => ({
    name: "Acme",
    story: new Promise<string>((r) => setTimeout(() => r(story), 20)),
  }),
});

function ShellThrows(): never {
  throw new Error("shell render failed");
}

function BoundaryThrows(): never {
  throw new Error("boundary render failed");
}

function RecoverablePage() {
  return h(
    "main",
    null,
    h("p", null, "Outside the boundary"),
    h(
      Suspense,
      { fallback: h("p", null, "Boundary fallback") },
      h(BoundaryThrows)
    )
  );
}

const opted_module = (default_: () => unknown, loader?: () => unknown) => ({
  default: default_,
  handle: { markdown: true },
  meta: () => [{ title: "Edge" }],
  headers: () => ({ vary: "Cookie" }),
  loader,
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
    big: {
      id: "big",
      parentId: "root",
      path: "big",
      module: page_module({ markdown: true }, BIG_STORY),
    },
    "shell-throws": {
      id: "shell-throws",
      parentId: "root",
      path: "shell-throws",
      module: opted_module(ShellThrows),
    },
    recoverable: {
      id: "recoverable",
      parentId: "root",
      path: "recoverable",
      module: opted_module(RecoverablePage),
    },
    "opted-404": {
      id: "opted-404",
      parentId: "root",
      path: "opted-404",
      module: opted_module(
        () => h("main", null, h("p", null, "Never rendered")),
        () => {
          throw new Response("no such fund", { status: 404 });
        }
      ),
    },
    "no-main": {
      id: "no-main",
      parentId: "root",
      path: "no-main",
      module: opted_module(() => h("div", null, h("p", null, "No landmark"))),
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
      big: entry_route("big", "big", "root"),
      "shell-throws": entry_route(
        "shell-throws",
        "shell-throws",
        "root",
        false
      ),
      recoverable: entry_route("recoverable", "recoverable", "root", false),
      "opted-404": entry_route("opted-404", "opted-404", "root"),
      "no-main": entry_route("no-main", "no-main", "root", false),
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
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("---\n\n# Acme Fund\n\n## Acme");
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

  test("a deferred boundary larger than react's chunk size lands inline", async () => {
    const md = await (await serve("/big", "text/markdown")).text();
    expect(md).toContain("Long story word");
    expect(md).toContain("end of story");
    expect(md).not.toContain("Loading story");
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
    expect(md).toMatch(
      /^---\ntitle: "Pricing \| [^\n]*\n(.*\n)*---\n\n# Pricing \| /
    );
    expect(md).toContain("Free. Forever.");
    expect(md).not.toMatch(/\]\(\//);
  });

  test("a shell error re-render lists Accept in Vary once", async () => {
    const res = await serve("/shell-throws", "text/markdown");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("vary")?.match(/accept/gi)).toHaveLength(1);
  });

  test("an error inside a suspense boundary is reported and the page still converts", async () => {
    vi.mocked(report_error).mockClear();
    const res = await serve("/recoverable", "text/markdown");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(await res.text()).toContain("Outside the boundary");
    expect(report_error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boundary render failed" })
    );
  });

  test("an opted-in page whose loader throws a 404 stays html", async () => {
    const res = await serve("/opted-404", "text/markdown");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(await res.text()).not.toContain("Never rendered");
  });

  test("an opted-in page with no main element answers with its html", async () => {
    const res = await serve("/no-main", "text/markdown");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(await res.text()).toContain("No landmark");
  });

  test("a 404 stays html", async () => {
    const res = await serve("/missing", "text/markdown");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html");
  });
});
