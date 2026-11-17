import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * the registry's style layer stopped importing `fonts.css` in 2.0.0: an app
 * imports it itself. missing, every page renders in a system font, no test
 * fails and the build is green, so this walks the `@import` graph from the
 * stylesheet platform ships and asks it for the faces.
 */

const repo = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);
const entry = resolve(repo, "apps/platform/src/index.css");
const ui = resolve(repo, "packages/ui");

const ui_exports: Record<string, string> = JSON.parse(
  readFileSync(resolve(ui, "package.json"), "utf8")
).exports;

const strip_comments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** a css `@import` specifier to a file on disk, or null for one that is not a
 *  local file (`tailwindcss`, a url, a `@plugin`) */
function resolve_import(spec: string, from: string): string | null {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return resolve(dirname(from), spec);
  }
  const pkg = "@better-giving/ui";
  if (spec === pkg || spec.startsWith(`${pkg}/`)) {
    const target = ui_exports[`.${spec.slice(pkg.length)}`];
    return target ? resolve(ui, target) : null;
  }
  return null;
}

function graph(file: string, seen = new Set<string>()): Map<string, string> {
  const files = new Map<string, string>();
  if (seen.has(file) || !existsSync(file)) return files;
  seen.add(file);
  const css = strip_comments(readFileSync(file, "utf8"));
  files.set(file, css);
  for (const [, spec] of css.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const next = resolve_import(spec as string, file);
    if (next) for (const [f, t] of graph(next, seen)) files.set(f, t);
  }
  return files;
}

const files = graph(entry);
const faces = [...files].flatMap(([file, css]) =>
  [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(([, body]) => ({
    file,
    family: body?.match(/font-family:\s*"?([^";]+?)"?\s*;/)?.[1],
    urls: [...(body ?? "").matchAll(/url\(\s*["']?([^)"']+)/g)].map(
      (m) => m[1] as string
    ),
  }))
);

describe("platform's stylesheet loads the web fonts", () => {
  test.each([
    "Red Hat Round Text",
    "Red Hat Round Display",
    "Red Hat Round Mono",
  ])("declares an @font-face for %s", (family) => {
    expect(faces.filter((f) => f.family === family).length).toBeGreaterThan(0);
  });

  test("every face's file exists beside the stylesheet that declares it", () => {
    const missing = faces.flatMap((f) =>
      f.urls
        .filter((u) => !u.startsWith("data:"))
        .filter((u) => !existsSync(resolve(dirname(f.file), u)))
    );
    expect(missing).toEqual([]);
  });
});
