import { modal_box } from "@better-giving/ui/helpers";
import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the names sweep for the modal size set. tailwind v4 is a jit over source
 * text, so an off-system spelling produces no rule and no error — the failure
 * mode is a class that simply does not exist, and only a filesystem sweep
 * catches it.
 *
 * hence the `node` vitest project: the rest of the suite runs in browser mode,
 * which has no `node:fs`.
 *
 * a modal's footer row is not here: it is the same row a page form ends with,
 * so it is gated with the other controls in `controls-conformance`.
 */

// colors.css is copied in from the design registry (packages/ui/bg-design.json),
// so its prose is not ours to reword — its --overlay comment names the drawer
// and `size="none"`. it holds no modal call, so leaving it out of the corpus
// keeps a real `size="none"` call written in any other css file caught.
const REGISTRY_COPIES = ["packages/ui/src/styles/colors.css"];
const corpus = sources_of(import.meta.url).filter(
  (x) => !REGISTRY_COPIES.includes(x.file)
);

/** every scanned file whose text contains `needle`, repo-relative, sorted. */
function files_with(needle: string): string[] {
  return corpus.filter((x) => x.text.includes(needle)).map((x) => x.file);
}

const line_of = (text: string, i: number) =>
  text.slice(0, i).split("\n").length;

describe("modal size set", () => {
  test("`fixed-center` is spelled only where it is defined and spent", () => {
    const owners = [
      // spends it — one full literal string per tier
      "packages/ui/src/helpers/modal-box.ts",
      // defines it
      "packages/ui/src/styles/utilities.css",
    ];
    // the one centered box that is not a modal *content* box: an
    // aspect-ratio-driven media viewport whose height is already bounded by
    // its own 80vh crop surface. it has no width cap to collapse onto, and any
    // tier's `sm:max-w-*` would clip or letterbox the crop area.
    const exempt = ["apps/platform/src/components/img-editor/img-cropper.tsx"];

    expect(files_with("fixed-center")).toEqual([...exempt, ...owners].sort());
  });

  test("every tier bounds its own height", () => {
    const unbounded = Object.entries(modal_box)
      .filter(([, cls]) => !cls.includes("max-h-[90dvh]"))
      .map(([tier]) => tier);
    expect(unbounded).toEqual([]);
  });

  test("the geometry escape hatch stays at one call site", () => {
    expect(files_with('size="none"')).toEqual([
      // an edge-anchored drawer, not a centered content box
      "apps/platform/src/layout/dashboard/sidebar/sidebar-opener/toggleable-sidebar.tsx",
    ]);
  });

  test("no tier carries a surface — geometry only", () => {
    // a surface baked into the base would beat or lose to the call site's own
    // by stylesheet source order, not by class-string order.
    const surfaced = Object.entries(modal_box)
      .filter(([, cls]) => /(^|\s)(bg-|text-|border(\s|$))/.test(cls))
      .map(([tier]) => tier);
    expect(surfaced).toEqual([]);
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

/** the components declared in `text` that render a `<Modal>` themselves. a
 *  modal reaches its trigger through one of these more often than directly —
 *  the trigger writes `<Prompt …/>` and the dialog is a level down — so a
 *  needle set of `<Modal` alone reads green on the exact shape it is here to
 *  catch. top-level declarations only; a wrapper imported from another file is
 *  a cross-file question no text sweep can answer. */
function modal_renderers(text: string): string[] {
  const heads = [
    ...text.matchAll(
      /^(?:export )?(?:default )?(?:function|const) ([A-Z][\w]*)\b/gm
    ),
  ];
  return heads
    .filter((m, i) =>
      text.slice(m.index, heads[i + 1]?.index ?? text.length).includes("<Modal")
    )
    .map((m) => m[1]);
}

/** the two spellings that reach a `<button>` by name. the house `Button` also
 *  has link forms (`to`/`href`), which render an `<a>` — a modal written inside
 *  one is the same defect, so no attempt is made to tell them apart. any *other*
 *  component that renders a button is the cross-file question `modal_renderers`
 *  documents and stays uncovered. */
const BUTTONS = ["button", "Button"];

describe("the modal and its trigger", () => {
  test("a modal is never written inside the button that opens it", () => {
    // `Modal` portals to document.body, so the dom nesting is fine — react is
    // the problem. react propagates events through the *react* tree, not the
    // dom one, so a click anywhere in the portaled dialog still bubbles to the
    // react parent. written inside its own trigger, that parent is the
    // `<button>`: closing the dialog re-fires the trigger's `onClick` and
    // reopens it, and every click inside the dialog does the same. nothing
    // errors and nothing looks wrong in the dom — it reviews as correct.
    // trigger and dialog are siblings under a fragment instead.
    const offenders = corpus.flatMap(({ file, text }) => {
      if (!BUTTONS.some((t) => text.includes(`<${t}`))) return [];
      const needles = ["<Modal", ...modal_renderers(text).map((n) => `<${n}`)];
      return BUTTONS.flatMap((tag) =>
        [...text.matchAll(new RegExp(`<${tag}\\b`, "g"))].flatMap((m) => {
          const end = tag_end(text, m.index);
          if (end < 0 || text.slice(m.index, end).endsWith("/>")) return [];
          const close = text.indexOf(`</${tag}>`, end);
          if (close < 0) return [];
          const inner = text.slice(end, close);
          const hit = needles.find((n) => inner.includes(n));
          return hit ? [`${file}:${line_of(text, m.index)} ${hit}`] : [];
        })
      );
    });
    expect(offenders).toEqual([]);
  });
});
