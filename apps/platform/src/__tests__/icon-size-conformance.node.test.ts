import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the glyph-size sweep, over two closed ladders: `icon-xs|sm|md|lg|xl|2xl` for
 * a glyph sized against the text beside it, `pictogram-sm|md|lg` for one sized
 * against the surface it heads. both are bound by `@utility` in
 * packages/ui/src/styles/utilities.css and tabled in
 * packages/brand/design-system.md; `size={n}` is the spelling they replaced.
 * both spell the same box, so a site that goes back to the prop renders
 * correctly, reviews correctly, and is off the ladder — nothing but this sweep
 * separates the two.
 *
 * the corpus is apps/platform/src + packages/ui/src. apps/docs/src is on the
 * same stylesheet and spends the same steps, but `sources_of` does not reach
 * it and widening it is its own slice — until then a ladder value written
 * there fails nothing.
 *
 * hence the `node` vitest project: the rest of the suite runs in browser mode,
 * which has no `node:fs`.
 */

/** comments blanked, newlines kept so line numbers still land. an apostrophe
 *  in a `//` line otherwise opens a string the attribute scan never closes. */
const uncommented = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^([ \t]*)\/\/.*$/gm, "$1");

const sources = sources_of(import.meta.url, uncommented);

const STEPS = new Set([
  "icon-xs",
  "icon-sm",
  "icon-md",
  "icon-lg",
  "icon-xl",
  "icon-2xl",
  "pictogram-sm",
  "pictogram-md",
  "pictogram-lg",
]);

interface Sized {
  name: string;
  n: number;
  size: number;
}

/** every component tag carrying a literal numeric `size` prop OF ITS OWN. a
 *  nested `<Icon size={20} />` inside a render-prop belongs to that element,
 *  so a brace group holding a tag is skipped rather than searched — otherwise
 *  a `<Combo adornment={…}>` answers for the glyph its callback returns. */
function sized_tags(text: string): Sized[] {
  const out: Sized[] = [];
  // capitalized, or a member expression: `<DrawerIcon`, `<card.icon`. a
  // lucide glyph reached through data is still a call site.
  const re = /<([A-Z][\w.]*|[a-z]\w*\.[\w.]+)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: the exec loop idiom
  while ((m = re.exec(text)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    let own = "";
    let brace = "";
    let i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (depth) brace += c;
        else own += c;
        if (c === quote && text[i - 1] !== "\\") quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        if (depth) brace += c;
        else own += c;
        continue;
      }
      if (c === "{") {
        depth++;
        brace += c;
        continue;
      }
      if (c === "}") {
        depth--;
        brace += c;
        if (depth === 0) {
          own += /<[A-Za-z]/.test(brace) ? "{}" : brace;
          brace = "";
        }
        continue;
      }
      if (depth) {
        brace += c;
        continue;
      }
      if (c === ">") break;
      own += c;
    }
    const size = own.match(/(?:^|\s)size=\{\s*(\d+)\s*\}/);
    if (size)
      out.push({
        name: m[1],
        n: text.slice(0, m.index).split("\n").length,
        size: Number(size[1]),
      });
  }
  return out;
}

/** a numeric `size` here is not a glyph box, so the prop assertion does not
 *  apply. */
const not_a_glyph: Record<string, string[]> = {
  // the social row's marks are raster/svg assets in an <img>, and the number
  // is its `width`. they sit off the ladder on purpose, at seven sizes tuned
  // to each mark's own optical weight.
  "apps/platform/src/components/org-page/socials.tsx": ["SocialsIcon"],
};

/** components declaring a numeric `size` of their own and forwarding it to a
 *  lucide glyph. `Copier` takes one number or a `{ copy, check }` pair for the
 *  two glyphs it swaps between, so a caller here is setting a prop, not
 *  writing a box. */
const forwards_size = ["Copier"];

/** the one glyph neither ladder can claim: its box is `h-lh`, which a step
 *  would override, and matching the line it sits on is the whole point of the
 *  site. a computed className is not a reason to be here — a template literal
 *  reaches one. */
const unreachable: Record<string, string[]> = {
  "apps/platform/src/components/donation/common/method-benefits.tsx": [
    "LightbulbIcon",
  ],
  // registry-owned (packages/ui/bg-design.json, item `checklist`): the
  // verdict band's glyph is a 20px box set by the registry's own markup, which
  // this repo may not edit
  "packages/ui/src/components/checklist.tsx": ["Icon"],
};

/** every `class`/`className`/`classes` value in a file, plus every `@apply`,
 *  with the line each sits on. a step reaches the DOM through one of those and
 *  never through a table, and reading only them keeps prose out of the search:
 *  `icon-only` is a word in a `describe` title, not a class anyone wrote. */
function class_values(text: string): { n: number; body: string }[] {
  const out: { n: number; body: string }[] = [];
  const re = /\bclass(?:Name|es)?\s*=|@apply\b/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: the exec loop idiom
  while ((m = re.exec(text)) !== null) {
    let i = m.index + m[0].length;
    const n = text.slice(0, m.index).split("\n").length;
    if (m[0] === "@apply") {
      const end = text.indexOf(";", i);
      out.push({ n, body: text.slice(i, end < 0 ? undefined : end) });
      continue;
    }
    const open = text[i];
    if (open === '"' || open === "'") {
      const end = text.indexOf(open, i + 1);
      out.push({ n, body: text.slice(i + 1, end < 0 ? undefined : end) });
      continue;
    }
    if (open !== "{") continue;
    // brace-balanced, so a `classes={{ container: "icon-md" }}` and a template
    // literal holding a ternary both come back whole.
    let depth = 0;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) break;
    }
    out.push({ n, body: text.slice(m.index + m[0].length, i + 1) });
  }
  return out;
}

const allowed = (file: string, name: string) =>
  forwards_size.includes(name) || (unreachable[file] ?? []).includes(name);

const glyphs = sources.flatMap(({ file, text }) =>
  sized_tags(text)
    .filter((t) => !(not_a_glyph[file] ?? []).includes(t.name))
    .map((t) => ({ file, ...t }))
);

describe("a glyph box is spent by name", () => {
  test("no glyph writes a numeric size prop", () => {
    // every size either ladder covers has a name, so the prop has no remaining
    // job here — which makes the whole spelling the offence, not a list of
    // values.
    const offenders = glyphs
      .filter((g) => !allowed(g.file, g.name))
      .map((g) => `${g.file}:${g.n} <${g.name} size={${g.size}}>`);
    expect(offenders).toEqual([]);
  });

  test("no class spends a glyph name off either ladder", () => {
    // a name outside the nine draws nothing: tailwind emits no rule for it,
    // so it paints nothing, errors nowhere and reads correctly in review.
    // that is a retired step and a typo both, and renumbering a ladder is
    // when they arrive — nothing else here would see one.
    const offenders = sources.flatMap(({ file, text }) =>
      class_values(text).flatMap(({ n, body }) =>
        [...body.matchAll(/(?<![-\w])(?:icon|pictogram)-[\w-]+/g)]
          .filter((m) => !STEPS.has(m[0]))
          .map((m) => `${file}:${n} ${m[0]}`)
      )
    );
    expect(offenders).toEqual([]);
  });
});
