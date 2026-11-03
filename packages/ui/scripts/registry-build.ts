// `pnpm --filter @better-giving/ui registry:build` — rewrites registry/ from source.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { build_registry, ui_root } from "./registry.ts";

const dir = join(ui_root, "registry");
rmSync(dir, { recursive: true, force: true });
const { out } = build_registry();
for (const [path, body] of Object.entries(out)) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}
console.log(
  `registry: wrote ${Object.keys(out).length} files (${readdirSync(join(dir, "items")).length} items)`
);
