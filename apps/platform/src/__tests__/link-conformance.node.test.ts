import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the names sweep for the link primitive. `link` is ink, hover ink and focus,
 * spelled once in packages/ui/src/styles/utilities.css; before it existed the
 * treatment was spelled per site, six ways across 139 of them, and every
 * spelling was on-system — so nothing but this sweep separates a link from a
 * seventh way of writing one.
 *
 * hence the `node` vitest project: the rest of the suite runs in browser mode,
 * which has no `node:fs`.
 */

const sources = sources_of(import.meta.url);

const utilities = sources.find(
  (x) => x.file === "packages/ui/src/styles/utilities.css"
);

/** `<a` / `<Link` / `<NavLink` / `<ExtLink` and everything up to its `>`, so a
 *  className reads the same here whether it is a string, a template or the
 *  `({ isActive }) => …` callback a NavLink takes. quotes and braces are
 *  tracked because a `>` inside either is not the end of the tag. */
function link_tags(text: string) {
  const out: { n: number; body: string }[] = [];
  const re = /<(?:a|Link|NavLink|ExtLink)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: the exec loop idiom
  while ((m = re.exec(text)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote && text[i - 1] !== "\\") quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({
      n: text.slice(0, m.index).split("\n").length,
      body: text.slice(m.index, i),
    });
  }
  return out;
}

/** a class constant declared beside the component rather than on the tag. the
 *  tag scan cannot see one, and it is where the two largest hand-spellings
 *  live — a whole footer and a whole marketing nav each. */
function link_consts(text: string) {
  const lines = text.split("\n");
  return lines.flatMap((line, i) => {
    if (!/^const \w*link\w*\s*=/i.test(line.trim())) return [];
    // through to the end of the declaration: the marketing nav's is an arrow
    // whose template literal sits on the next line.
    const end = lines.findIndex((l, j) => j >= i && l.trimEnd().endsWith(";"));
    return [
      { n: i + 1, body: lines.slice(i, (end < 0 ? i : end) + 1).join(" ") },
    ];
  });
}

/** the class text of a tag: its `className=` value, whatever form it takes,
 *  and nothing else. a `to` or an `href` beside it is a url, and a url that
 *  happens to read `with-border` is not an edge. */
function class_text(body: string): string {
  const at = body.search(/\bclass(?:Name|es)?=/);
  if (at < 0) return body;
  let i = body.indexOf("=", at) + 1;
  if (body[i] === '"' || body[i] === "'") {
    const end = body.indexOf(body[i], i + 1);
    return body.slice(i + 1, end < 0 ? undefined : end);
  }
  if (body[i] !== "{") return body.slice(i);
  let depth = 0;
  const start = i;
  for (; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) break;
  }
  return body.slice(start + 1, i);
}

const tokens = (value: string) =>
  value
    .replace(/[`"'{}$?()]/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);

const bare = (c: string) => c.split(":").pop() ?? c;

const hover_spellings = (text: string) =>
  [
    ...text.matchAll(
      /hover:(text-[a-z0-9-]+(?:\/\d+)?|underline|no-underline)/g
    ),
  ]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);

/** a link that paints a surface of its own — a menu row, a tile, a tab. its
 *  ink shift is one part of a treatment that also moves a fill or an edge, so
 *  it is not the text link this recipe is for, and `link`'s brand ink at rest
 *  would be wrong on every one of them. a `card` link is a tile by name: the
 *  card has no edge to firm, so its hover is a fill shift (`hover:bg-panel`)
 *  beside the ink. */
const paints_surface = (text: string) =>
  text.includes("data-highlighted") ||
  tokens(text)
    .map(bare)
    .some(
      (c) =>
        c === "card" ||
        c.startsWith("bg-") ||
        c === "border" ||
        /^border-/.test(c)
    );

/**
 * links whose ink is deliberately not the brand colour, by file and by the
 * spelling each keeps. semantic ink on a coloured ground, or a nav whose
 * current item is its ink: converting either would break a pairing the ledger
 * has measured, or erase a state the recipe has no rung for.
 */
const exempt: Record<string, string[]> = {
  // the contrast-ink ladder on a --primary fill, measured in
  // packages/brand/design-system.md → "`--primary-fg` alpha steps". the ramp
  // carries no second rung for ink on a brand ground, so these two keep the
  // treatments they have.
  "apps/platform/src/components/footer/footer.tsx": ["text-primary-fg"],
  "apps/platform/src/components/chrome/announcement-banner.tsx": ["underline"],
  // the one pillar tile filled with --primary, in a row of tinted ones: its
  // link inherits that band's contrast ink, while the tile beside it takes
  // `link` on the ordinary ground.
  "apps/platform/src/routes/_landing._index/pillars.tsx": ["underline"],
  // the error ink of a destructive row action, in a table of otherwise ordinary
  // links
  "apps/platform/src/routes/admin.$id.forms/table.tsx": [
    "text-destructive-subtle-fg",
  ],
  "apps/platform/src/routes/dashboard.forms/table.tsx": [
    "text-destructive-subtle-fg",
  ],
  // a nav that marks its current item by ink alone: `link` paints every item
  // the brand colour and the current one stops being visible. the state table
  // in packages/brand/design-system.md carries the blank.
  "apps/platform/src/components/header/marketing-header.tsx": ["text-primary"],
  // campaign identity name rests in gray-12 and shifts to primary on hover.
  // `link` would paint the name brand blue at rest, which the page spec rejects.
  "apps/platform/src/routes/org.$org.$campaign/page.tsx": ["text-primary"],
};

const recipe =
  utilities?.text.match(/@utility link \{\n([\s\S]*?)\n\}/)?.[1] ?? "";

describe("the link recipe", () => {
  test("carries ink, hover ink and focus, and nothing else", () => {
    // not size, not weight, not spacing, not display: those are the caller's,
    // the same split the type roles keep by holding no colour. a display or a
    // font-weight baked in here is a decision every one of the 139 call sites
    // would then have to cancel.
    const decls = [...recipe.matchAll(/([a-z-]+):\s*([^;]+);/g)].map(
      (m) => `${m[1]}: ${m[2]}`
    );
    expect(decls).toEqual([
      "color: var(--primary)",
      "color: var(--primary-hover)",
      "outline: 2px solid var(--ring)",
      "outline-offset: 2px",
    ]);
    // the house focus trigger, and the only one: `:focus` here would ring a
    // link on a pointer press that no control in components.css rings.
    expect(recipe).toContain("&:focus-visible {");
    expect(recipe).not.toMatch(/&:focus\s*\{/);
  });

  test("both rungs are the ramp's own tokens", () => {
    // step 9 at rest, step 10 hovered — the state ladder's filled row. a
    // color-mix or an alpha of --primary here would be a value nobody
    // generated and nobody re-measures when the ramp moves.
    expect(recipe).not.toMatch(/color-mix|oklch\(|#[0-9a-f]{3}/i);
  });
});

describe("a link does not hand-spell its own hover", () => {
  test("the classifier separates a text link from a row and a button", () => {
    // the shapes the sweep has to tell apart, as the tree writes them.
    const cases: [string, boolean][] = [
      // text links: the six spellings the recipe replaces
      ['<Link className="text-primary hover:text-primary">', true],
      ['<ExtLink className="text-primary hover:text-primary/80">', true],
      ['<a className="text-primary hover:underline">', true],
      ['<NavLink className="font-medium hover:text-primary">', true],
      ['<Link className="text-gray-11 hover:text-gray-12">', true],
      ['<a className="text-primary underline hover:no-underline">', true],
      // rows, tiles and tabs: the ink moves with a fill or an edge
      [
        '<a className="hover:bg-gray-3 px-3 py-2 rounded text-gray-11 hover:text-gray-12">',
        false,
      ],
      [
        '<Link className="card flex items-center hover:bg-panel hover:text-primary">',
        false,
      ],
      ['<Link className="card flex items-center hover:text-primary">', false],
      [
        `<Link className={\`px-3 py-1 rounded \${active ? "bg-primary text-primary-fg" : "text-gray-11 hover:text-gray-12"}\`}>`,
        false,
      ],
      // a link already on the recipe
      ['<Link className="link text-sm font-medium">', false],
      // a button styled as a link is not a link: it submits, and its own
      // recipe is `.btn-ghost` or a bare glyph
      ['<button className="text-primary hover:text-primary">', false],
      ['<button type="submit" className="text-xs hover:underline">', false],
    ];
    const got = cases.filter(([src, want]) => {
      const t = link_tags(src)[0];
      const cls = t ? class_text(t.body) : "";
      const flagged =
        !!t && hover_spellings(cls).length > 0 && !paints_surface(cls);
      return flagged !== want;
    });
    expect(got).toEqual([]);
  });

  test("no link spells a hover of its own", () => {
    // `link` IS the ink and the hover ink, so a `hover:text-*` beside it is the
    // hand-spelling the name replaced — and two same-layer utilities resolve by
    // stylesheet source order, not by class-string order, so which one paints
    // is a coin flip either way.
    const offenders = sources.flatMap((x) =>
      [...link_tags(x.text), ...link_consts(x.text)].flatMap(({ n, body }) => {
        const cls = class_text(body);
        if (paints_surface(cls)) return [];
        const spellings = hover_spellings(cls);
        const allowed = exempt[x.file] ?? [];
        const bad = spellings.filter((s) => !allowed.includes(s));
        return bad.length
          ? [`${x.file}:${n} hover:${bad.join(" hover:")}`]
          : [];
      })
    );
    expect(offenders).toEqual([]);
  });

  test("every exemption is still a link that needs one", () => {
    // an exemption outlives the site it was written for: the file gets deleted,
    // the link gets swept, and the entry stays behind granting cover to the
    // next hand-spelled one written there.
    const stale = Object.entries(exempt).flatMap(([file, spellings]) => {
      const src = sources.find((x) => x.file === file);
      if (!src) return [`${file}: no such file`];
      const found = [...link_tags(src.text), ...link_consts(src.text)].flatMap(
        ({ body }) => hover_spellings(class_text(body))
      );
      return spellings
        .filter((s) => !found.includes(s))
        .map((s) => `${file}: hover:${s} is no longer spelled here`);
    });
    expect(stale).toEqual([]);
  });
});
