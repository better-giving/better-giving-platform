import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { ui_root } from "../../ui/scripts/registry.ts";
import { add, diff, list } from "../src/cli.mjs";

const registry = join(ui_root, "registry");
const cli = join(import.meta.dirname, "../src/cli.mjs");
const tmp: string[] = [];
// inside the package so node resolution finds react, react-router and lucide-react
const mk = () => {
  const d = mkdtempSync(join(import.meta.dirname, "../.tmp-"));
  tmp.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("cli", () => {
  test("list reads the index", async () => {
    const items = await list({ registry });
    expect(items.map((i: { name: string }) => i.name)).toContain("button");
  });

  test("add resolves registry dependencies and reports npm packages", async () => {
    const dir = mk();
    const r = await add({ registry, dir, names: ["button"] });
    expect(r.items).toEqual(["fonts", "tokens", "button"]);
    for (const p of [
      "styles/index.css",
      "styles/colors.css",
      "components/button.tsx",
      "components/load-text.tsx",
    ])
      expect(existsSync(join(dir, p)), p).toBe(true);
    const woff = readFileSync(
      join(dir, "styles/fonts/quicksand-latin-wght-normal.woff2")
    );
    expect(woff.subarray(0, 4).toString()).toBe("wOF2");
    expect(r.dependencies).toMatchObject({
      react: "19.2.9",
      tailwindcss: "4.3.1",
    });
  });

  test("add refuses to overwrite without --force, and writes nothing", async () => {
    const dir = mk();
    await add({ registry, dir, names: ["button"] });
    writeFileSync(join(dir, "components/button.tsx"), "mine");
    writeFileSync(join(dir, "components/new.txt"), "x");
    await expect(
      add({ registry, dir, names: ["button", "input"] })
    ).rejects.toThrow(/would overwrite/);
    expect(readFileSync(join(dir, "components/button.tsx"), "utf8")).toBe(
      "mine"
    );
    expect(existsSync(join(dir, "components/form/input.tsx"))).toBe(false);
    await add({ registry, dir, names: ["button"], force: true });
    expect(readFileSync(join(dir, "components/button.tsx"), "utf8")).not.toBe(
      "mine"
    );
  });

  test("diff reports same, changed and missing", async () => {
    const dir = mk();
    await add({ registry, dir, names: ["tooltip"] });
    writeFileSync(join(dir, "components/popup.ts"), "edited");
    rmSync(join(dir, "components/tooltip.tsx"));
    const rows = await diff({ registry, dir, names: ["tooltip"] });
    const by = Object.fromEntries(rows.map((r) => [r.path, r.status]));
    expect(by["components/popup.ts"]).toBe("changed");
    expect(by["components/tooltip.tsx"]).toBe("missing");
    expect(by["styles/theme.css"]).toBe("same");
  });

  test("unknown item and unsupported schema are readable errors", async () => {
    await expect(add({ registry, dir: mk(), names: ["nope"] })).rejects.toThrow(
      /unknown item "nope"/
    );
    const bad = mk();
    writeFileSync(
      join(bad, "index.json"),
      JSON.stringify({ schemaVersion: 99, items: [] })
    );
    await expect(list({ registry: bad })).rejects.toThrow(/schema 99/);
  });

  test("bin runs end to end and exits non-zero on conflicts", () => {
    const dir = mk();
    const run = () =>
      spawnSync(
        "node",
        [cli, "add", "tooltip", "--registry", registry, "--dir", dir],
        { encoding: "utf8" }
      );
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("pnpm add");
    const second = run();
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("would overwrite");
  });

  test("bin runs when launched through a symlink, as a package bin shim does", () => {
    const link = join(mk(), "bg-design");
    symlinkSync(cli, link);
    const r = spawnSync("node", [link, "list", "--registry", registry], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("button");
  });
});

describe("fresh app smoke", () => {
  let tsc: string;
  beforeAll(() => {
    tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  });

  test("tokens + button + input land in an empty app and typecheck", async () => {
    const app = mk();
    await add({
      registry,
      dir: join(app, "src/ui"),
      names: ["tokens", "button", "input"],
    });
    writeFileSync(
      join(app, "src/use.tsx"),
      `import { Button } from "./ui/components/button";
import { Field } from "./ui/components/form/field";
export const X = () => <Field name="a" label="A"><Button variant="primary">Go</Button></Field>;
`
    );
    writeFileSync(
      join(app, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          jsx: "react-jsx",
          module: "preserve",
          moduleResolution: "bundler",
          target: "es2022",
          lib: ["dom", "es2022"],
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
        },
        include: ["src"],
      })
    );
    const r = spawnSync("node", [tsc, "-p", app], { encoding: "utf8" });
    expect(r.stdout + r.stderr).not.toMatch(/error TS/);
    expect(r.status).toBe(0);
  });
});
