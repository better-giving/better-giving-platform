import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DOCS_PATH, doc_href } from "./docs";

type Entry = { file: string; path?: string; children?: Entry[] };

/** the url path each route module serves, as the app's own `src/routes.ts`
 * (fs-routes) derives it from the file name */
const served_paths = async () => {
  // fs-routes reads the app directory off a global the react-router cli sets
  (globalThis as Record<string, unknown>).__reactRouterAppDirectory =
    fileURLToPath(new URL("../src", import.meta.url));
  const { default: config } = await import("../src/routes");
  const out = new Map<string, string>();
  const walk = (entries: Entry[], parent: string) => {
    for (const e of entries) {
      const path = [parent, e.path].filter(Boolean).join("/");
      out.set(e.file, `/${path}`);
      walk(e.children ?? [], path);
    }
  };
  walk((await config) as Entry[], "");
  return out;
};

describe("DOCS_PATH", () => {
  test("is the url the api.docs route file serves", async () => {
    const served = await served_paths();
    expect(served.get("routes/api.docs.ts")).toBe(DOCS_PATH);
  });

  test("is the path a document link points at", () => {
    expect(
      doc_href("https://a.example/docs/u/x y.pdf", "https://bg.test")
    ).toBe(
      "https://bg.test/api/docs?ref=https%3A%2F%2Fa.example%2Fdocs%2Fu%2Fx%20y.pdf"
    );
  });
});
