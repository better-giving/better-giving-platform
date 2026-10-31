import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the sweep for a brand fill that never declared its ink.
 *
 * `bg-primary` is a color utility and can only set one property. an element
 * that carries it and nothing else paints the brand fill and then lets
 * everything inside inherit the *page's* foreground — dark ink on a dark
 * brand ground — while `--ring` and `--border` keep the values they were
 * given against the page, where `--ring` IS `--primary` and so paints an
 * invisible focus outline on the very control the band exists to hold.
 * `surface-primary` (utilities.css) is the name that sets all four.
 *
 * no other gate reaches this. the closed-set gates work by making an
 * off-system spelling compile to nothing — `--color-*`, `--radius-*` and
 * `--text-*` are reset to `initial`, so `gray-500` and `rounded-lg` match no
 * rule. here the class is real, it compiles, it paints, and the defect is the
 * *second* declaration that was never written. nothing errors, nothing warns,
 * and the band looks plausible in review until someone tabs to the button.
 *
 * hence the `node` vitest project: the rest of the suite runs in browser mode,
 * which has no `node:fs`.
 *
 * ## the rule is narrow on purpose, and carries no exemption list
 *
 * one full-strength, unprefixed `bg-primary` on an element with content and no
 * ink of its own. every narrowing below exists so that a shape which is
 * *correct on its own merits* is dropped by the predicate rather than by a
 * name on a list — a list is where a real defect eventually hides, because
 * nobody re-derives why an entry is on it.
 *
 * - **alpha steps are out.** `bg-primary/10` and `bg-primary/50` are tints,
 *   not the brand ground, and their contrast story is a different one. the
 *   icon chips that carry them pair with `text-primary`, which is a declared,
 *   deliberate ink on a 10% tint.
 * - **variant-prefixed fills are out.** `data-[state=checked]:bg-primary` on a
 *   toggle track or a radio control is a third story again: the fill only
 *   exists in one state, and what sits on it is a `bg-panel` dot or a
 *   `Switch.Thumb` that takes no `currentColor` at all. those controls draw
 *   their focus ring with `outline-offset-2`, so it lands on the page ground
 *   rather than on the fill, and the ring collapse this file is about cannot
 *   reach them.
 * - **any `text-*` token satisfies the ink half**, not `text-primary-fg`
 *   specifically. the question is whether the element declared an ink, not
 *   which one.
 *
 * ## what it deliberately does not cover
 *
 * extend it knowingly rather than assuming coverage it never had.
 *
 * - **`text-*` is tailwind's shared prefix** for size, alignment and wrapping
 *   as well as color, so a band spelling `bg-primary text-center` satisfies
 *   the ink half without declaring an ink. enumerating the color half of that
 *   namespace would be an exemption list wearing a different hat, so it is
 *   left open.
 * - **an off-token ink still counts as an ink.** a band spelling
 *   `bg-primary text-white` passes here — `text-white` is the literal value of
 *   `--primary-fg` written as a raw color. that is a real finding, but it is
 *   the *raw-color* sweep's finding, not this one's.
 * - **it reads one file at a time.** two shapes escape, the same blind spot
 *   `modal-conformance` documents: a class string handed to a component
 *   (`<Section classes="bg-primary py-24" />`) lands on that component's own
 *   root in another file, and the tag here is self-closing; and a class bundle
 *   hoisted into a `const` and spent as `className={bundle}` has no tag beside
 *   it at all.
 *
 *   the first shape is the one that hides a whole band: the class string and
 *   the element it lands on sit in different files, so neither file on its own
 *   shows a brand ground with no ink. only reading both together does.
 */

const sources = sources_of(import.meta.url);

const line_of = (text: string, i: number) =>
  text.slice(0, i).split("\n").length;

/** index just past the `>` that closes the tag opening at `start`, skipping
 *  quotes and nested `{}`/`()` — otherwise an `onClick={() => …}` ends the tag
 *  at its own arrow. */
function tag_end(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{" || c === "(") depth++;
    else if (c === "}" || c === ")") depth--;
    else if (c === ">" && depth === 0) return i + 1;
  }
  return -1;
}

/** the class-string tokens exactly as written, variant prefixes intact, minus
 *  the quotes a ternary branch inside a template literal carries. */
const raw_tokens = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/["'`]/g, ""));

describe("a --primary fill declares its own ink", () => {
  test("`bg-primary` on an element with content also names an ink", () => {
    // the carve-out is the predicate itself, not a list. a small fill that
    // holds text — a status pill, a selected tab, a filter chip — names its
    // ink on the same node and passes. a dot, a slider range or a skeleton
    // block holds nothing and is self-closing or empty, so it passes too. a
    // tint and a state-variant fill are dropped by the narrowings above. what
    // is left is a full-strength brand ground with content inside it and no
    // ink of its own, which is a band: it wants `surface-primary`, which sets
    // the fill, the foreground, and rebinds --ring and --border for
    // everything inside.
    const offenders = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/<([A-Za-z][\w.]*)/g)].flatMap((m) => {
        const end = tag_end(text, m.index);
        if (end < 0) return [];
        const attrs = text.slice(m.index, end);
        const cls = /class(?:Name|es)=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(attrs);
        if (!cls) return [];
        const value = cls[1] ?? cls[2] ?? "";
        const t = raw_tokens(value);
        if (!t.includes("bg-primary")) return [];
        if (t.some((x) => x.startsWith("text-"))) return [];
        // content inside it. a self-closing tag has none, and neither does an
        // element whose span is empty.
        if (attrs.endsWith("/>")) return [];
        const close = text.indexOf(`</${m[1]}>`, end);
        if (close < 0) return [];
        if (text.slice(end, close).trim() === "") return [];
        return [`${file}:${line_of(text, m.index)}`];
      })
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * the surface model: ground -> card -> well -> field
 * (packages/brand/design-system.md, "Resting surfaces"). an in-flow
 * container is `bg-card` + `rounded-card` + `shadow-card` with no edge —
 * `card` and `solo-card` carry all three; a floating layer is that fill and
 * corner with `shadow-floating`; a well is `bg-panel` at the control corner,
 * inside a card; a field is the one surface that keeps its edge.
 *
 * these read every string literal, not only `className=` values: the
 * floating layers and the callouts are as often a `const` or a ternary branch
 * as an attribute.
 *
 * ## what stays out, and why
 *
 * each of these is dropped by the predicate, not by a list, because each one
 * is right on its own merits:
 *
 * - **a control keeps its edge.** a field, a dropzone, a copy button and a
 *   `.btn-secondary` rest on `bg-surface`, the control fill, which is not a
 *   container fill here — WCAG 1.4.11 wants a control's boundary findable.
 * - **a semantic callout keeps its edge.** `bg-warning-subtle` /
 *   `bg-destructive-subtle` / the green success notice name a state, and
 *   their tinted fills are not container fills.
 * - **a dashed slot keeps its edge.** a dashed border with no fill is an
 *   empty slot to drop or create into; with no container fill it never meets
 *   the predicate.
 * - **an image keeps its frame.** a logo's border on an `object-*` box is the
 *   picture's edge, not a container's.
 * - **a line is not a container's edge.** a side border (`border-b`,
 *   `border-t`) is a divider, and dividers are `border-hairline` — which the
 *   divider test below holds to, with its own two named exemptions.
 * - **the embed's outer box keeps its border**, at its own call site
 *   (`donate-widget.$id`), on `rounded-card` with no container fill: it sits
 *   on a nonprofit's page, not on the ground.
 * - **a photograph's frame is not a card.** a `bg-card rounded-card` box
 *   carrying `shadow-lift-media` frames a hero image and spends the media
 *   lift instead of the card rung.
 *
 * the named exemptions below are the shapes the predicate cannot tell apart
 * from a container by their classes alone.
 */
describe("the surface model", () => {
  // comments blanked first, newlines kept: prose quotes class names in
  // backticks, and a doc comment naming `shadow-floating` is not a layer.
  const string_literals = (text: string) =>
    [
      ...text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/^([ \t]*)\/\/.*$/gm, "$1")
        .matchAll(/"([^"\n]*)"|`([^`]*)`/g),
    ].map((m) => ({
      i: m.index,
      value: m[1] ?? m[2] ?? "",
    }));

  // the sweeps spell their own needles out, in cases and exemption notes.
  const literals = sources
    .filter(({ file }) => !file.includes("/__tests__/"))
    .flatMap(({ file, text }) =>
      string_literals(text).map(({ i, value }) => ({
        file,
        n: line_of(text, i),
        t: raw_tokens(value),
      }))
    );

  test("a floating layer is a card with no edge", () => {
    // a lone `shadow-floating` is a pinned header's IntersectionObserver
    // toggling the lift once it sticks; the element's own class string is
    // read where it is written. pinned chrome, and a panel dropped from it
    // across the full width, is square: it meets the window's edge, so the
    // corner is asked only of a layer that floats free.
    const exempt = [
      // the hero Donate button lifted over the org banner: a control with a
      // shadow, not a layer
      "apps/platform/src/components/org-page/give-panel.tsx",
    ];
    const offenders = literals.flatMap(({ file, n, t }) => {
      if (exempt.includes(file)) return [];
      if (!t.includes("shadow-floating") || t.length === 1) return [];
      const pinned =
        t.includes("sticky") || t.includes("fixed") || t.includes("inset-x-0");
      const ok =
        t.includes("bg-card") &&
        (pinned || t.includes("rounded-card")) &&
        !t.some((c) => /^(border|outline)(-[\w-]+)?$/.test(c));
      return ok ? [] : [`${file}:${n}`];
    });
    expect(offenders).toEqual([]);
  });

  test("a well is not a container", () => {
    // `bg-panel` is gray-2, one rung under the card, and reads as a recess
    // only inside one. at the container's corner, at the card's inset, or
    // with the card's or a floating layer's shadow it is the pre-model
    // container spelling, which on the
    // white ground paints a gray box where a card belongs. an image letterboxed
    // on it (`object-*`) and a slider thumb riding its track are not boxes.
    const offenders = literals.flatMap(({ file, n, t }) => {
      if (!t.includes("bg-panel")) return [];
      if (t.some((c) => c.startsWith("object-"))) return [];
      const container =
        t.includes("rounded-card") ||
        t.some((c) => /^p-([6-9]|1\d)$/.test(c)) ||
        t.includes("shadow-card") ||
        t.includes("shadow-floating");
      return container ? [`${file}:${n}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  test("a container has no border", () => {
    // a container fill beside a full edge and a corner is the pre-model card,
    // inset or not: the four-class `bg-panel border rounded p-*` the card
    // sweep used to count, and its delegated-inset siblings (a bordered
    // media frame, a bordered collapsible, a bordered table shell). the
    // surface model draws none of them: a card is found by `shadow-card`,
    // and lines inside it are `--hairline`.
    const is_fill = (c: string) =>
      /^bg-(panel|card|background|gray-\d+)$/.test(c);
    const is_edge = (c: string) => c === "border" || /^border-\d$/.test(c);
    const is_corner = (c: string) =>
      c === "rounded" || c === "rounded-card" || /^rounded-[tblr]$/.test(c);
    const exempt = [
      // a warning-edged alert block. its edge is semantic, not a container's
      "apps/platform/src/pages/admin/shared/deposit-form/panel.tsx",
      // a native color input sized with --field-size: a control's box
      "apps/platform/src/routes/admin.$id.assets/qr-code.tsx",
      // a native <select>, and a control's box is components.css's
      "apps/platform/src/routes/dashboard.donations/route.tsx",
      // a role="tablist" holding its tabs at a 4px inset: a control group
      "apps/platform/src/routes/dashboard.subscriptions/route.tsx",
      // a subscription chip, whose dashed edge marks it cancelled
      "apps/platform/src/routes/admin.$id.donors_.$email/route.tsx",
    ];
    const offenders = literals.flatMap(({ file, n, t }) => {
      if (exempt.includes(file)) return [];
      const ok =
        !t.some(is_fill) ||
        !t.some(is_edge) ||
        !t.some(is_corner) ||
        t.some((c) => c.startsWith("object-"));
      return ok ? [] : [`${file}:${n}`];
    });
    expect(offenders).toEqual([]);
  });

  test("an in-flow container rests on the card shadow", () => {
    // `bg-card rounded-card` with no inset is a card whose inset is delegated
    // — a table shell, a divided list, a media frame, a collapsible. it is
    // still a card, so it carries what `card` carries: `shadow-card`, the
    // only thing that finds a borderless card on the ground. a floating layer spends
    // `shadow-floating` instead, a dialog is `z-modal` behind a scrim with
    // neither, and a photograph's frame spends `shadow-lift-media`; each is
    // dropped by the predicate.
    const offenders = literals.flatMap(({ file, n, t }) => {
      if (!t.includes("bg-card") || !t.includes("rounded-card")) return [];
      const other_level =
        t.includes("shadow-floating") ||
        t.includes("shadow-lift-media") ||
        t.includes("z-modal");
      if (other_level) return [];
      return t.includes("shadow-card") ? [] : [`${file}:${n}`];
    });
    expect(offenders).toEqual([]);
  });

  test("a divider is a hairline", () => {
    // `gray-6` is a control's edge (`--border`), not a separator. a line that
    // divides — `divide-*`, or a side border with no full edge beside it — is
    // `border-hairline` / `divide-hairline`, inside a card and between the
    // full-width sections of a marketing page alike. a full `border` in
    // `gray-6` is a control's box and stays out by the predicate.
    const bare = (c: string) => c.slice(c.lastIndexOf(":") + 1);
    const is_side = (c: string) => /^border-[tblrxy](-\d)?$/.test(c);
    const exempt = [
      // a `bg-gray-3` fill, where a gray-3 hairline would vanish into it
      "apps/platform/src/routes/_app.forms.$id.edit/snippet.tsx",
      // a divider inside a control, which takes the control's own edge colour
      "apps/platform/src/components/token-field/token-field.tsx",
    ];
    const offenders = literals.flatMap(({ file, n, t }) => {
      if (exempt.includes(file)) return [];
      const b = t.map(bare);
      if (b.includes("divide-gray-6")) return [`${file}:${n}`];
      const side_line =
        b.includes("border-gray-6") &&
        b.some(is_side) &&
        !b.some((c) => c === "border" || /^border-\d$/.test(c));
      return side_line ? [`${file}:${n}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  test("the sidebar paints nothing", () => {
    // --sidebar was deleted with the model: the dashboard nav sits on the
    // ground. the utility no longer compiles, so a stray one is silent.
    const offenders = sources
      .filter(({ text }) => /(?<![-\w])bg-sidebar(?![-\w])/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
