import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// reading the registry's css the same way in every guard that parses it
// (colors.test.ts, contrast.test.ts). test-only: nothing exports this.
const require = createRequire(import.meta.url);

export const strip_comments = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

/** `@better-giving/ui` css entry (`colors.css`, `themes/default.css`), comments
 * kept: the ramp's source hex lives in one */
export const read_css = (entry: string) =>
  readFileSync(require.resolve(`@better-giving/ui/${entry}`), "utf8");

/** the light half: the block whose selector list opens with `:root` */
export function light_block(css: string, label: string): string {
  const m = css.match(/(?:^|\n):root\s*(?:,[^{]*)?{([^}]*)}/s);
  if (!m) throw new Error(`${label}: no :root block`);
  return m[1];
}

/** one custom-property declaration per match: [1] the name without `--`, [2]
 * the value. anchored on the line start, so a `--x:` inside another
 * declaration's value or a selector can't match. a commented-out declaration
 * would match, so `decls_in` strips comments first. */
export const decl_re = (name = "[a-z0-9-]+") =>
  new RegExp(
    `^[ \\t]*--(${name})[ \\t]*:\\s*([^;}]+?)\\s*(?:;|(?![\\s\\S]))`,
    "gm"
  );

export const decls_in = (css: string) =>
  [...strip_comments(css).matchAll(decl_re())].map(
    (m) => [m[1], m[2].replace(/\s+/g, " ")] as const
  );

/** every declaration in the text, whichever block it sits in */
export const count_decls = (css: string) => decls_in(css).length;
