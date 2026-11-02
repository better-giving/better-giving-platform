import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the names sweep for the three controls the system owns — the button, the
 * empty state, and the form action row. every other gate in this system works
 * by making an off-system spelling compile to nothing — `--color-*`,
 * `--radius-*` and `--text-*` are reset to `initial`, so `gray-500`,
 * `rounded-lg` and `text-8xl` match no rule. that is exactly why it cannot
 * catch what is here: a `btn-xl`, a doubled `btn`, an icon-only button with no
 * accessible name, an empty state that says the wrong one of yet/found, a
 * hand-rolled dialog footer. each produces no error, no warning and no
 * compiled rule — they render, they look plausible in review, and not existing
 * IS the failure mode.
 *
 * hence the `node` vitest project: the rest of the suite runs in browser mode,
 * which has no `node:fs`.
 */

const sources = sources_of(import.meta.url);

const line_of = (text: string, i: number) =>
  text.slice(0, i).split("\n").length;

/** every class string in the corpus, with where it came from. unlike the other
 *  sweeps this one spans lines: a long class string gets wrapped into a
 *  template literal by the formatter, and a wrapped one is precisely where a
 *  doubled `btn` hides from a per-line scan. */
const class_values = sources.flatMap((x) =>
  [...x.text.matchAll(/class(?:es|Name)=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
    (m) => ({
      file: x.file,
      n: line_of(x.text, m.index),
      value: m[1] ?? m[2] ?? "",
    })
  )
);

/** class-string tokens, each stripped of its responsive/state variant prefix
 *  and of the quotes a ternary branch inside a template literal carries. */
const tokens = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.split(":").pop() ?? t).replace(/["'`]/g, ""));

describe("the button size and variant sets", () => {
  /** the closed set, as drawn by components.css and utilities.css. */
  const SET = new Set([
    "btn-sm",
    "btn-md",
    "btn-lg",
    "btn-field",
    "btn-icon",
    "btn-primary",
    "btn-secondary",
    "btn-ghost",
    "btn-outline",
    "btn-destructive",
    "btn-success",
    "btn-warning",
    "btn-inverse",
    "btn-form-primary",
    "btn-donate",
  ]);

  test("a button writes no `btn-*` name outside the set", () => {
    // an off-set name compiles to nothing and renders as a bare `.btn` — the
    // md tier in the default variant, which is a plausible-looking button.
    const offenders = class_values.flatMap(({ file, n, value }) => {
      const t = tokens(value);
      if (!t.includes("btn")) return [];
      const bad = t.filter((x) => x.startsWith("btn-") && !SET.has(x));
      return bad.length ? [`${file}:${n} ${bad.join(" ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  test("`btn-md` is only ever written responsively", () => {
    // btn-md is byte-identical to bare .btn, so `btn btn-md` is the size scale
    // spelled twice and reads as a deliberate tier choice. the name exists for
    // one job — stepping *down* from a larger tier (`btn-lg md:btn-md`) — so a
    // bare one is always the copied-call-site tell, never that job.
    const offenders = class_values.flatMap(({ file, n, value }) => {
      const raw = value.split(/\s+/).filter(Boolean);
      if (!raw.some((t) => t.replace(/["'`]/g, "") === "btn")) return [];
      return raw.some((t) => t.replace(/["'`]/g, "") === "btn-md")
        ? [`${file}:${n}`]
        : [];
    });
    expect(offenders).toEqual([]);
  });

  test("a button on a brand fill is `btn-inverse`, not its fill spelled out", () => {
    // `bg-primary-fg text-primary` beside `btn` paints the same button with no
    // press and no ring that reads on blue, and grows a hover rung by accretion.
    const offenders = class_values
      .filter(({ value }) => {
        const t = tokens(value);
        return (
          t.includes("btn") && t.some((x) => x.startsWith("bg-primary-fg"))
        );
      })
      .map(({ file, n }) => `${file}:${n}`);
    expect(offenders).toEqual([]);
  });

  test("`btn` is spelled once", () => {
    // duplicate class names are inert in css, so this costs nothing at runtime
    // and is invisible in review — which is how five of them accumulated. it
    // is here because it is the tell for a call site copied from another one
    // rather than composed, and those are what the size scale drifts through.
    const offenders = class_values
      .filter(
        ({ value }) => tokens(value).filter((x) => x === "btn").length > 1
      )
      .map(({ file, n }) => `${file}:${n}`);
    expect(offenders).toEqual([]);
  });
});

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

describe("icon-only controls", () => {
  test("an icon is not an accessible name", () => {
    // buttons AND links: an icon-only anchor announces as "link" and nothing
    // else, which is the same defect one element down. widening the tag set
    // found fourteen of them after the fifteen buttons were named.
    //
    // empty, and an entry added back here is a control a screen reader
    // announces by its role alone. the `Button` component's `icon` prop is
    // unconstructible without an `aria-label`, so every call site it takes
    // over is closed structurally rather than by this sweep.
    const exempt: string[] = [];
    const offenders = sources.flatMap(({ file, text }) => {
      if (exempt.includes(file)) return [];
      return [
        ...text.matchAll(/<(?:button|a|Link|NavLink|ExtLink)\b/g),
      ].flatMap((m) => {
        const end = tag_end(text, m.index);
        if (end < 0) return [];
        const attrs = text.slice(m.index, end);
        if (attrs.endsWith("/>")) return [];
        if (/aria-label|aria-labelledby|title=/.test(attrs)) return [];
        const tag = /^<([A-Za-z]+)/.exec(text.slice(m.index))?.[1] ?? "";
        const close = text.indexOf(`</${tag}>`, end);
        if (close < 0) return [];
        const inner = text.slice(end, close).trim();
        // the only child is one self-closing element and nothing else: an
        // icon, and no text node anywhere to name the control.
        if (!/^<[A-Za-z][\w.]*[\s/]/.test(inner)) return [];
        if (tag_end(inner, 0) !== inner.length || !inner.endsWith("/>"))
          return [];
        // a lone child can carry the name itself: an image through `alt`, an
        // icon through an `aria-label`/`title` that svg exposes as role=img.
        // both compute into the control's own name, so neither is a finding.
        if (/\balt=|aria-label|title=/.test(inner)) return [];
        return [`${file}:${line_of(text, m.index)}`];
      });
    });
    expect(offenders).toEqual([]);
  });

  test("a disclosure states whether it is open", () => {
    // `DrawerIcon` is the system's open/closed chevron, so a raw `<button>`
    // that renders one IS a disclosure. WCAG 4.1.2 wants its *value*, and a
    // name that changes with the state ("Show…"/"Hide…") is not the same
    // thing — assistive tech surfaces expanded/collapsed as a property users
    // query and navigate by. the ark triggers are exempt by construction:
    // zag writes `aria-expanded` onto them, and none of them is a `<button>`
    // element in source.
    const offenders = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/<button\b/g)].flatMap((m) => {
        const end = tag_end(text, m.index);
        if (end < 0) return [];
        const close = text.indexOf("</button>", end);
        if (close < 0) return [];
        if (!text.slice(end, close).includes("DrawerIcon")) return [];
        if (/aria-expanded/.test(text.slice(m.index, end))) return [];
        return [`${file}:${line_of(text, m.index)}`];
      })
    );
    expect(offenders).toEqual([]);
  });
});

/** every `EmptyState`/`EmptyRow` in the corpus, with the line that carries the
 *  claim. when a `heading` is present it is the headline and the child is the
 *  sentence under it; with no heading the child IS the headline. only literal
 *  text — an interpolated child is a runtime string the sweep cannot read, and
 *  four of these name their filter that way on purpose. */
const empty_states = sources.flatMap((x) =>
  [
    ...x.text.matchAll(
      /<Empty(?:State|Row)\b([^>]*)>([\s\S]*?)<\/Empty(?:State|Row)>/g
    ),
  ].map((m) => {
    const heading = /heading="([^"]*)"/.exec(m[1])?.[1];
    const child = m[2].replace(/\s+/g, " ").trim();
    return {
      file: x.file,
      n: line_of(x.text, m.index),
      attrs: m[1],
      headline: heading ?? (/[<>{}]/.test(child) ? null : child),
    };
  })
);

describe("the empty state", () => {
  test("says `yet` or `found`, and nothing else", () => {
    // the two say different things to the person reading: `yet` is a
    // collection that has never held anything, `found` is a filter or a search
    // that came back empty. a bare noun ("No grant items", "No data") is the
    // third convention this replaced, and a trailing period is the fourth
    // spelling of the same sentence. which of the two is true stays the call
    // site's call; that it is one of them is not.
    const offenders = empty_states
      .filter((e) => e.headline && !/^No .+ (yet|found)$/.test(e.headline))
      .map((e) => `${e.file}:${e.n} ${JSON.stringify(e.headline)}`);
    expect(offenders).toEqual([]);
  });

  test("the caller does not re-specify the rhythm", () => {
    // the component owns its padding. two utilities of equal specificity
    // resolve by stylesheet order rather than class-string order, so a second
    // `py-*` from a caller renders right on some builds and wrong on others.
    // margin is the caller's, as everywhere else.
    const offenders = empty_states
      .filter((e) => /classes=\{?"[^"]*\bp[xytblr]?-/.test(e.attrs))
      .map((e) => `${e.file}:${e.n}`);
    expect(offenders).toEqual([]);
  });

  test("an empty table row is not written out by hand", () => {
    // a `<td colSpan>` holding a "no rows" sentence is `EmptyRow`. nineteen
    // copies of it drifted into two class orders and three rhythms before one
    // of them started naming the wrong noun entirely.
    const offenders = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/<td\b[^>]*colSpan[^>]*>([\s\S]*?)<\/td>/g)]
        .filter((m) => /\bNo\b[\s\S]{0,60}?\b(yet|found)\b/i.test(m[1]))
        .map((m) => `${file}:${line_of(text, m.index)}`)
    );
    expect(offenders).toEqual([]);
  });
});

/** every `<Actions>` in the corpus with the `classes` it was handed. the
 *  component joins that string onto its own row class, so a geometry token in
 *  there lands in the same class attribute as the one the utility already
 *  set — and the sweep over `class_values` cannot see it, because the attribute
 *  it reads is only the caller's half. */
const action_rows = sources.flatMap((x) =>
  [...x.text.matchAll(/<Actions\b([^>]*)>/g)].map((m) => ({
    file: x.file,
    n: line_of(x.text, m.index),
    attrs: m[1],
    classes: /classes=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(m[1]),
  }))
);

describe("the form action row", () => {
  /** the closed set, as drawn by utilities.css. `actions` itself carries no
   *  suffix, so it is not in here — this is the set of names that may follow
   *  the prefix. */
  const SET = new Set(["actions-split", "actions-band"]);

  test("the row writes no `actions-*` name outside the set", () => {
    // same failure as an off-set `btn-*`: the name compiles to nothing, the
    // element keeps whatever the rest of its class string said, and the row
    // looks approximately right in review.
    const offenders = class_values.flatMap(({ file, n, value }) => {
      const bad = tokens(value).filter(
        (t) => t.startsWith("actions-") && !SET.has(t)
      );
      return bad.length ? [`${file}:${n} ${bad.join(" ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  test("the row is not handed geometry it already owns", () => {
    // `actions` and `actions-split` are two complete rows, not a base and a
    // modifier. a `justify-*`, `gap-*`, `items-*`, `flex` or `grid` written
    // beside one is the same declaration twice at equal specificity, which
    // resolves by stylesheet source order rather than class-string order — so
    // it renders one way here and the other way after an unrelated edit
    // reorders the sheet.
    const owned = /^(flex|grid|gap(-[xy])?-|justify-|items-)/;
    const from_class = class_values.flatMap(({ file, n, value }) => {
      const t = tokens(value);
      if (!t.includes("actions") && !t.includes("actions-split")) return [];
      const bad = t.filter((x) => owned.test(x));
      return bad.length ? [`${file}:${n} ${bad.join(" ")}`] : [];
    });
    const from_prop = action_rows.flatMap((r) => {
      const bad = tokens(r.classes?.[1] ?? r.classes?.[2] ?? "").filter((x) =>
        owned.test(x)
      );
      return bad.length ? [`${r.file}:${r.n} ${bad.join(" ")}`] : [];
    });
    expect([...from_class, ...from_prop].sort()).toEqual([]);
  });

  test("the two rows are never written together", () => {
    // one of them wins by source order and the other is decoration, and which
    // is which is not visible at the call site.
    const offenders = class_values
      .filter(({ value }) => {
        const t = tokens(value);
        return t.includes("actions") && t.includes("actions-split");
      })
      .map(({ file, n }) => `${file}:${n}`);
    expect(offenders).toEqual([]);
  });

  test("the dialog footer band is not typed out by hand", () => {
    // the band is a tinted strip with a top border, and its properties are
    // cheap to re-type by hand — the name is the only place they are authored.
    // bare tokens on purpose: a `hover:bg-gray-*` on a menu item is a
    // different thing entirely and is not a finding.
    const offenders = class_values
      .filter(({ value }) => {
        const raw = value.split(/\s+/).filter(Boolean);
        return (
          raw.includes("bg-gray-2") &&
          raw.includes("border-t") &&
          !raw.includes("actions-band")
        );
      })
      .map(({ file, n }) => `${file}:${n}`);
    expect(offenders).toEqual([]);
  });
});
