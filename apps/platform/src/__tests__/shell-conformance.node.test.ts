import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the names sweep for the shells: the scrollbar skin, the table scroller, the
 * popup content shell, the dashboard shell and the card. same reason as the other two sweeps — tailwind v4 is a
 * jit over source text, so a half-spelled skin or a re-hand-rolled shell
 * produces no error, just a surface that quietly stops matching the others.
 *
 * hence the `node` vitest project: the rest of the suite runs in browser mode,
 * which has no `node:fs`.
 */

const sources = sources_of(import.meta.url);

function files_with(needle: string): string[] {
  return sources.filter((x) => x.text.includes(needle)).map((x) => x.file);
}

/** every class string in the corpus, with where it came from. */
const class_values = sources.flatMap((x) =>
  x.text
    .split("\n")
    .flatMap((line, i) =>
      [...line.matchAll(/class(?:es|Name)=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
        (m) => ({ file: x.file, n: i + 1, value: m[1] ?? m[2] ?? "" })
      )
    )
);

const tokens = (value: string) => value.split(/\s+/).filter(Boolean);

describe("the scrollbar skin", () => {
  test("the three skin classes are spelled only in their @utility", () => {
    // they were always written as one breath, so a partial spelling is how a
    // scroller ends up thin-but-uncolored, or colored-but-native-width.
    for (const c of [
      "scrollbar-thin",
      "scrollbar-thumb-ring",
      "scrollbar-track-gray-6",
    ]) {
      expect({ [c]: files_with(c) }).toEqual({
        [c]: ["packages/ui/src/styles/utilities.css"],
      });
    }
  });
});

describe("the table scroller", () => {
  test("a horizontal scroller with the skin is spelled `table-scroll`", () => {
    // `table-scroll` IS `overflow-x-auto scrollbars`, so writing both is the
    // hand-spelling the name replaced. the exemptions below scroll sideways
    // but hold no table, and naming them for one would be a lie in the
    // markup.
    const exempt = [
      // a tab row wider than its box
      "packages/ui/src/components/tabs.tsx",
      // a row of campaign cards, swiped
      "apps/platform/src/components/org-page/swipe-row.tsx",
      // the org page's section links, under the header on narrow widths
      "apps/platform/src/components/org-page/layouts/feature.tsx",
      // a row of referral cards, scrolled by drag
      "apps/platform/src/components/referrals/hub/index.tsx",
      // a rebalance summary panel: paragraphs and a diff, no table
      "apps/platform/src/routes/platform.investments.rebalance/review/index.tsx",
    ];
    const offenders = class_values
      .filter(({ file, value }) => {
        if (exempt.includes(file)) return false;
        const t = tokens(value);
        if (!t.includes("overflow-x-auto") || !t.includes("scrollbars"))
          return false;
        // a box that scrolls both ways is not the table scroller — a table
        // scrolls sideways and grows downward, never the reverse.
        return !t.some((x) => x.startsWith("overflow-y-"));
      })
      .map(({ file, n }) => `${file}:${n}`);
    expect(offenders).toEqual([]);
  });

  test("nothing re-specifies the scroller's own axis", () => {
    // utilities of equal specificity resolve by stylesheet source order, not
    // by class-string order, so an `overflow-*` beside it silently wins. a
    // `overflow-y-*` is a legitimate second axis and is the caller's.
    const offenders = class_values.flatMap(({ file, n, value }) => {
      const t = tokens(value);
      if (!t.includes("table-scroll")) return [];
      const bad = t
        .map((x) => x.split(":").pop() ?? x)
        .filter((x) => x === "overflow-auto" || x.startsWith("overflow-x-"));
      return bad.length ? [`${file}:${n} ${bad.join(" ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});

describe("the popup content shell", () => {
  test("a tooltip or hovercard body is not re-spelled at the call site", () => {
    // `Content` carries `popup_shell`, so a class the shell already owns —
    // a fill, an edge, a shadow, a radius, a padding, a z-index, the ink —
    // on a `Content` is the call site drawing the body a second time. a
    // stray `p-2` beside the shell's `p-4` resolves by stylesheet order, not
    // by intent, which is how paddings drift and a shadow goes missing. the
    // caller keeps its width cap, its type size, its alignment, its scroller.
    const shell_owned =
      /^(bg-|outline|shadow-|rounded|z-|border|p-|px-|py-|pt-|pb-|pl-|pr-|text-gray-)/;
    const offenders = sources
      .filter((x) =>
        /from "(@better-giving\/ui|\.)\/(tooltip|hover-card)"/.test(x.text)
      )
      .flatMap((x) =>
        x.text.split("\n").flatMap((line, i) => {
          const m = line.match(
            /<Content\s+className=(?:"([^"]*)"|\{`([^`]*)`\})/
          );
          if (!m) return [];
          const bad = tokens(m[1] ?? m[2] ?? "").filter((c) =>
            shell_owned.test(c.split(":").pop() ?? c)
          );
          return bad.length ? [`${x.file}:${i + 1} ${bad.join(" ")}`] : [];
        })
      );
    expect(offenders).toEqual([]);
  });

  test("the shell is defined in one place", () => {
    expect(files_with("shadow-floating rounded-card p-4 z-floating")).toEqual([
      "packages/ui/src/components/popup.ts",
    ]);
  });
});

describe("the dashboard shell", () => {
  test("the sidebar surfaces do not re-compose their own chrome", () => {
    // donor, npo admin and platform admin used to spell the same four-element
    // shell out each — header, sidebar grid, views, footer — and had already
    // drifted on the footer's margin. the shell owns all four now; a route
    // module reaching for `AppHeader` or `Footer` beside it is that drift
    // starting over.
    const offenders = sources
      .filter((x) => /from "#\/layout\/dashboard"/.test(x.text))
      .filter((x) => /\bLayout\b/.test(x.text))
      .filter((x) => /from "#\/components\/(header|footer)"/.test(x.text))
      .map((x) => x.file);
    expect(offenders).toEqual([]);
  });

  test("the shell is defined in one place", () => {
    expect(
      files_with("md:grid-cols-[auto_1fr] border-b border-hairline")
    ).toEqual(["apps/platform/src/layout/dashboard/layout.tsx"]);
  });
});

describe("the card shell", () => {
  // a card is `card`: the fill, the resting shadow, the corner and the inset,
  // spelled once in packages/ui/src/styles/utilities.css. hand-assembling
  // them is how the inset reached 30 spellings across 131 sites — every value
  // on both sides is on-system, so nothing but this sweep separates a card
  // from a thirty-first spelling of one. the pre-model spelling (a `bg-panel`
  // fill with an edge, a corner and an inset) is no longer a card at all: a
  // container has no border, and `the surface model` in
  // surface-conformance.node.test.ts fails it on the edge alone, inset or not.
  const utilities = sources.find(
    (x) => x.file === "packages/ui/src/styles/utilities.css"
  );

  test("the recipe carries the fill, the shadow, the corner and the inset", () => {
    // and nothing else: no edge, because a container in the surface model has
    // none, and the shadow is the card rung (packages/brand/design-system.md,
    // "Resting surfaces"). a layout, a gap or a type size baked in here is a
    // decision every caller then has to cancel.
    const recipe = utilities?.text.match(/@utility card \{\s*@apply ([^;]*);/);
    expect(tokens(recipe?.[1] ?? "")).toEqual([
      "bg-card",
      "rounded-card",
      "shadow-card",
      "p-6",
    ]);
  });

  test("the single-purpose card carries the same shadow, and no edge", () => {
    const recipe = utilities?.text.match(
      /@utility solo-card \{\s*@apply ([^;]*);/
    );
    const t = tokens(recipe?.[1] ?? "");
    expect({
      missing: ["bg-card", "rounded-card", "shadow-card"].filter(
        (c) => !t.includes(c)
      ),
      edge: t.filter((c) => c.startsWith("border")),
    }).toEqual({ missing: [], edge: [] });
  });

  test("there is one card for every ground", () => {
    // the white card reads on a `bg-band` ground as well as on the page, so
    // the band variant was folded into it. a second name would be a second
    // recipe to keep in step for no visible difference.
    expect(files_with("card-on-band")).toEqual([]);
  });

  // the edge, shadow and corner are still read beside `card` below: a second
  // one there is a coin flip with the recipe's. the edge accepts the step
  // spelling too (`border-gray-6`), and the corner a side, because a
  // half-rounded panel is still a panel.
  const is_fill = (c: string) => c === "bg-panel" || c === "bg-card";
  const is_edge = (c: string) =>
    c === "border" ||
    /^border-[xytblr]$/.test(c) ||
    /^border-gray-\d+$/.test(c);
  const is_shadow = (c: string) => c.startsWith("shadow-");
  const is_corner = (c: string) =>
    c === "rounded" || c === "rounded-card" || /^rounded-[tblr]$/.test(c);
  const is_inset = (c: string) => /^p[xytblr]?-/.test(c);
  const bare = (c: string) => c.split(":").pop() ?? c;

  /** the card's fill, its own corner and an inset: the recipe spelled out. */
  function is_hand_assembled(value: string): boolean {
    const t = tokens(value).map(bare);
    // a transient layer over the page is not a card: it is the floating
    // elevation, and the popup/toast shells own their own boxes.
    if (t.some((c) => c === "shadow-floating" || c.startsWith("z-floating")))
      return false;
    return (
      t.includes("bg-card") && t.includes("rounded-card") && t.some(is_inset)
    );
  }

  test("the recipe is a card only together", () => {
    // a surface with no inset has DELEGATED it and is a different shell — a
    // table shell, a `divide-y` list, an `overflow-hidden` media frame. the
    // ledger names those as real shapes, so the sweep leaves them alone, along
    // with the shells that already have a name of their own.
    const cases: [string, boolean][] = [
      ["card flex items-center gap-x-3", false],
      ["card grid gap-6", false],
      [`\${classes} md:card grid gap-2 md:gap-4`, false],
      // the named shells' own recipes, as a call site writes them
      ["page grid gap-8", false],
      ["solo-card", false],
      ["actions-band actions", false],
      // delegated insets: a media frame, a divided list, a table shell
      ["w-full bg-card rounded-card shadow-card overflow-hidden", false],
      ["bg-card rounded-card shadow-card divide-y divide-hairline", false],
      // a floating layer
      ["bg-card rounded-card shadow-floating px-4 py-3", false],
      // a well: the control corner, not the card's
      ["bg-panel rounded p-4", false],
      // hand-assembled cards
      ["bg-card rounded-card p-6 grid gap-4", true],
      ["bg-card rounded-card shadow-card p-6", true],
      [`\${classes} md:bg-card md:rounded-card md:p-4`, true],
    ];
    expect(cases.filter(([v, want]) => is_hand_assembled(v) !== want)).toEqual(
      []
    );
  });

  test("a card is not assembled by hand", () => {
    const exempt = [
      // the registration layout: its inset is delegated to the two children
      // that fill its grid, and pt-8 is the shell's own top rule
      "apps/platform/src/routes/_app.register.$reg_id._steps/route.tsx",
      // a testimonial whose pt-24 is clearance for the avatar overlapping its
      // top edge, not an inset
      "apps/platform/src/routes/simplify-fundraising-maximize-impact/testimonials/testimonial-card.tsx",
    ];
    const offenders = class_values
      .filter(
        ({ file, value }) => !exempt.includes(file) && is_hand_assembled(value)
      )
      .map(({ file, n }) => `${file}:${n}`);
    expect(offenders).toEqual([]);
  });

  test("nothing re-spells what the card owns", () => {
    // utilities of equal specificity resolve by stylesheet source order, so a
    // second fill, edge, shadow, corner or inset beside `card` wins or loses by where
    // it landed in the emitted sheet rather than by intent — the drift the one
    // inset exists to end.
    const exempt = [
      // `pr-11` is clearance for the remove button overlapping the tile's
      // trailing edge, not a second inset
      "apps/platform/src/routes/dashboard._index.tsx",
    ];
    const offenders = class_values.flatMap(({ file, n, value }) => {
      if (exempt.includes(file)) return [];
      const t = tokens(value);
      // only the unconditional `card`. a `md:card` is a card at that width and
      // something else below it, so what the surface is at the other widths —
      // an inset included — is the caller's to spell, and the two variants
      // never both apply.
      const name = t.find((x) => x === "card");
      if (!name) return [];
      // --surface counts as a fill here and only here: beside a card it is a
      // second fill, while on its own it is a control's box. `hover:bg-panel`
      // is a card tile's hover — the tile shifts its fill rather than its
      // edge — and never applies at rest beside the card's own.
      const bad = t
        .filter((x) => x !== "hover:bg-panel")
        .filter((x) => {
          const c = bare(x);
          return (
            is_fill(c) ||
            c === "bg-surface" ||
            is_edge(c) ||
            is_shadow(c) ||
            is_corner(c) ||
            is_inset(c)
          );
        })
        .filter((x) => x !== name);
      return bad.length ? [`${file}:${n} ${bad.join(" ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
