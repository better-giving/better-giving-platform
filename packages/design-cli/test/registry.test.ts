import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { build_registry, ui_root } from "../../ui/scripts/registry.ts";

const committed = (p: string) =>
  readFileSync(join(ui_root, "registry", p), "utf8");

describe("generator", () => {
  const built = build_registry();

  test("committed registry matches what the source generates", () => {
    for (const [path, body] of Object.entries(built.out))
      expect(
        committed(path),
        `${path} is stale: pnpm --filter @better-giving/ui registry:build`
      ).toBe(body);
  });

  test("index lists every item with the documented fields and a schema version", () => {
    expect(built.index.schemaVersion).toBe(1);
    expect(built.index.items.map((i) => i.name)).toEqual([
      "fonts",
      "tokens",
      "button",
      "input",
      "dialog",
      "tooltip",
    ]);
    for (const i of built.index.items) {
      expect(typeof i.description).toBe("string");
      expect(i.files.length).toBeGreaterThan(0);
      expect(Array.isArray(i.registryDependencies)).toBe(true);
      for (const v of Object.values(i.dependencies))
        expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  test("file bodies are the source files, not copies kept by hand", () => {
    const button = built.items.button.files.find(
      (f) => f.path === "components/button.tsx"
    );
    expect(button?.content).toBe(
      readFileSync(join(ui_root, "src/components/button.tsx"), "utf8")
    );
    const idx = built.items.tokens.files.find(
      (f) => f.path === "styles/index.css"
    );
    expect(idx?.content).toContain('@import "./colors.css";');
    expect(idx?.content).not.toContain("@better-giving/brand");
  });

  test("fonts ship as base64 binaries", () => {
    const woff = built.items.fonts.files.find((f) => f.path.endsWith(".woff2"));
    expect(woff?.encoding).toBe("base64");
  });
});
