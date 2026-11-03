// regenerates colors.ts from colors.css's :root tokens.
// run: pnpm --filter @better-giving/brand generate-colors
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { oklch_to_hex } from "../oklch.ts";

// colors.css is the registry's, copied into packages/ui; edit it there only via a
// registry release.
const css_path = createRequire(import.meta.url).resolve(
  "@better-giving/ui/colors.css"
);
const out_path = new URL("../colors.ts", import.meta.url);

const css = readFileSync(css_path, "utf8");
const root_matches = [...css.matchAll(/:root\s*{([^}]*)}/gs)];
if (root_matches.length !== 1) {
  throw new Error(
    `expected exactly one :root block, found ${root_matches.length}`
  );
}
const root_block = root_matches[0][1];

// comments are stripped before splitting on `;` so a trailing /* #hex */ can't
// be read as part of the next declaration.
const decls = new Map<string, string>();
for (const decl of root_block.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
  const m = decl.match(/^\s*--([a-z0-9-]+)\s*:\s*([\s\S]+)$/i);
  if (m) decls.set(m[1], m[2].trim().replace(/\s+/g, " "));
}

// the oklch() channels a token is worth. `var(--other)` resolves through to
// whatever the other one is worth, so an alias still gets an email twin — the
// app reads the custom property, mail clients can only be handed hex.
// exactly two shapes are worth nothing and say so: a color-mix(), which has no
// single literal behind it, and a non-color like --radius. every other shape
// THROWS rather than returning null — a raw hex or an rgb() would otherwise
// drop its twin silently, and the drift guard cannot catch a token that never
// entered the set on either side.
function channels(name: string, seen: readonly string[] = []): string | null {
  if (seen.includes(name)) {
    throw new Error(`--${name}: var() cycle through ${seen.join(" -> ")}`);
  }
  const value = decls.get(name);
  if (value === undefined) {
    throw new Error(
      `--${seen.at(-1)}: var(--${name}) has no :root declaration`
    );
  }
  const alias = value.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/);
  if (alias) return channels(alias[1], [...seen, name]);
  const oklch = value.match(/^oklch\(([^)]+)\)$/);
  if (oklch) return oklch[1];
  if (value.startsWith("color-mix(")) return null;
  if (/^-?[\d.]+(rem|px|em|%|s|ms)?$/.test(value)) return null;
  throw new Error(
    `--${name}: ${value} is neither oklch(), a var() alias, a color-mix() nor a ` +
      "plain length. give it an oklch() literal or the email mirror loses it."
  );
}

const entries: [string, string][] = [];
for (const name of decls.keys()) {
  const value = channels(name);
  if (value === null) continue;
  const parts = value.trim().split(/\s+/);
  const [L, C, h] = parts.map(Number);
  if (parts.length !== 3 || [L, C, h].some((n) => Number.isNaN(n))) {
    throw new Error(
      `--${name}: oklch(${parts.join(" ")}) isn't a plain 3-channel token`
    );
  }
  entries.push([name.replace(/-/g, "_"), oklch_to_hex(L, C, h)]);
}

const body = entries.map(([key, hex]) => `  ${key}: "${hex}",`).join("\n");

const out = `// GENERATED — do not hand-edit; run \`pnpm --filter @better-giving/brand generate-colors\`.
// hex twin of colors.css's light (:root) palette, for consumers that can't read
// oklch() or CSS custom properties — currently the transactional email templates.
// no dark mode: the literal oklch() tokens plus the var() aliases that resolve to
// one, converted. color-mix() has no single literal and is left out. keys are the
// css token name with hyphens as underscores.
// colors.test.ts asserts this never drifts from colors.css — keep them in lockstep.
export const colors = {
${body}
};
`;

writeFileSync(out_path, out);
