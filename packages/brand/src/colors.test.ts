import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { colors } from "./colors.ts";
import { oklch_to_hex } from "./oklch.ts";

// drift guard: colors.ts must always agree with colors.css, which the design
// registry owns (copied into packages/ui; see packages/ui/bg-design.json).
// parses :root the same way a human eye would — a literal oklch() token, or a
// var() alias followed to the literal it points at. color-mix() and --radius
// fall out on their own: neither has one literal behind it.
const require = createRequire(import.meta.url);

// the light half of each file: the block whose selector list opens with `:root`
function light_block(path: string): string {
  const css = readFileSync(path, "utf8");
  const m = css.match(/(?:^|\n):root\s*(?:,[^{]*)?{([^}]*)}/s);
  if (!m) throw new Error(`${path}: no :root block`);
  return m[1];
}

// the roles (colors.css) alias the scales (themes/default.css); both are the
// registry's.
const root_block = [
  light_block(require.resolve("@better-giving/ui/colors.css")),
  light_block(require.resolve("@better-giving/ui/themes/default.css")),
].join("\n");

// comments go before the split so a trailing /* #hex */ can't be read as part
// of the next declaration.
const decls = new Map<string, string>();
for (const decl of root_block.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
  const m = decl.match(/^\s*--([a-z0-9-]+)\s*:\s*([\s\S]+)$/i);
  if (m) decls.set(m[1], m[2].trim().replace(/\s+/g, " "));
}

const key_of = (name: string) => name.replace(/-/g, "_");

// name -> the token it aliases, one hop. the pairs the mirror has to keep equal.
const aliases = new Map<string, string>();
for (const [name, value] of decls) {
  const m = value.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/);
  if (m) aliases.set(name, m[1]);
}

function hex_of(name: string, seen: readonly string[] = []): string | null {
  if (seen.includes(name)) {
    throw new Error(`--${name}: var() cycle through ${seen.join(" -> ")}`);
  }
  const target = aliases.get(name);
  if (target) return hex_of(target, [...seen, name]);
  const value = decls.get(name);
  if (value === undefined) {
    throw new Error(
      `--${seen.at(-1)}: var(--${name}) has no :root declaration`
    );
  }
  const m = value.match(/^oklch\(([^)]+)\)$/);
  if (!m) {
    // only two shapes legitimately have no hex twin. anything else reaching
    // here would drop out of BOTH this guard and the generator by the same
    // silence, and set-equality would still pass — so the shape itself is what
    // has to fail, not the comparison.
    const excluded =
      value.startsWith("color-mix(") ||
      value.startsWith("color(") ||
      /^-?[\d.]+(rem|px|em|%|s|ms)?$/.test(value);
    if (excluded) return null;
    throw new Error(
      `--${name}: ${value} is neither oklch(), a var() alias, a color-mix() nor a plain length`
    );
  }
  const parts = m[1].trim().split(/\s+/);
  const nums = parts.map(Number);
  // alpha (`/ 50%`) or `none` must not silently parse as opaque — the email
  // mirror has no alpha channel, so anything but a plain 3-channel token
  // needs a human decision, not a wrong hex.
  if (parts.length !== 3 || nums.some((n) => Number.isNaN(n))) {
    throw new Error(
      `--${name}: oklch(${parts.join(" ")}) isn't a plain 3-channel token`
    );
  }
  const [L, C, h] = nums;
  return oklch_to_hex(L, C, h);
}

const css_tokens = new Map<string, string>();
for (const name of decls.keys()) {
  const hex = hex_of(name);
  if (hex !== null) css_tokens.set(key_of(name), hex);
}

describe("colors.ts matches colors.css", () => {
  it("has the same token set", () => {
    expect(Object.keys(colors).sort()).toEqual([...css_tokens.keys()].sort());
  });

  it.each([...css_tokens.entries()])(
    "%s converts to the value in colors.ts",
    (key, hex) => {
      expect(colors[key as keyof typeof colors]).toBe(hex);
    }
  );
});

// the reason the mirror resolves var() at all: a semantic token authored as an
// alias onto a ramp step still has to reach the email templates, which can only
// be handed hex.
describe("var() aliases mirror their target", () => {
  it("finds aliases to check", () => {
    expect(aliases.size).toBeGreaterThan(0);
  });

  it.each([...aliases.entries()])("--%s mirrors --%s", (name, target) => {
    const key = key_of(name) as keyof typeof colors;
    const target_key = key_of(target) as keyof typeof colors;
    // a target with no single literal (color-mix()) mirrors nothing, and
    // neither does the alias — the pair is absent together or equal together.
    if (colors[target_key] === undefined) {
      expect(colors[key]).toBeUndefined();
      return;
    }
    expect(colors[key]).toBe(colors[target_key]);
  });
});

// the generated ramp is transcription, not authorship: each step's oklch() must
// still be the sRGB hex the palette tool emitted, recorded beside it.
const ramp_steps = [
  ...root_block.matchAll(
    /--((?:accent|destructive|success|warning|gray)-\d+):\s*(oklch\([^)]+\));\s*\/\* (#[0-9a-f]{6}) \*\//g
  ),
];

describe("the ramp round-trips to its source hex", () => {
  it("finds all 60 steps", () => {
    expect(ramp_steps.length).toBe(60);
  });

  it.each(ramp_steps.map((m) => [m[1], m[2], m[3]]))(
    "--%s is %s, which is %s",
    (name, _value, hex) => {
      expect(hex_of(name)).toBe(hex);
    }
  );
});
