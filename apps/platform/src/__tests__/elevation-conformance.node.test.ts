import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the sweep for depth picked by eye rather than spent by name.
 *
 * the elevation set (`packages/ui/src/styles/theme.css`) is the card rung, the
 * floating level, a recessed pair, two marketing lifts and one handle
 * affordance (flush and modal are written with no shadow), and a call
 * site spends exactly one of those names. `--shadow-*` and `--inset-shadow-*`
 * are reset to `initial` beside it, so `shadow-md` and `shadow-2xl` match no
 * rule — that is the structural half of the gate, and it ships with the app.
 *
 * ## what the structural reset cannot catch, which is why this file exists
 *
 * - **`shadow-[…]` never consults the theme.** an arbitrary value is compiled
 *   straight out of the bracket, so a hand-tuned `shadow-[0_2px_8px_#0003]`
 *   survives a closed namespace intact and paints a depth nothing else in the
 *   product has. resetting the namespace harder does not reach it; only reading
 *   the source does.
 * - **a stripped utility is silent.** `shadow-lg` after the reset produces no
 *   rule, no warning and no error — the element simply renders flat, which
 *   looks plausible in review. the reset stops the drift; it cannot tell anyone
 *   the class was written.
 * - **`shadow-none` still compiles**, from a literal rather than from the
 *   scale, so no reset reaches it. with the namespace closed there is nothing
 *   left for it to switch off but a named level, and a level that has to be
 *   cancelled at the call site is the wrong level for that call site.
 * - **a color modifier is a second decision.** `shadow-lift-cta
 *   shadow-primary/40` compiles fine — the lift's own tint is simply
 *   overwritten by a hand-picked one. the tint lives inside the token; a
 *   `shadow-<color>/<alpha>` written beside a name is the pair the lift
 *   tokens exist to retire.
 * - **the `z-*` namespace is deliberately NOT reset**, so `z-10` and every
 *   other sibling-stacking value still compiles, as it should. the six named
 *   steps start at `--z-index-subbar: 20`, so 20-and-up is the elevation range
 *   and a raw number in it is a layer ordering itself against the ladder by
 *   luck — the `z-51` that used to shove a combobox over a dialog.
 *
 * `drop-shadow-*` is a sibling namespace, stays open, and is not a finding
 * here: `routes/unlock-us-donations/hero.tsx` lays white copy over a
 * photograph, where a filter follows the glyph outlines and a box-shadow
 * cannot. every needle below is anchored so the `-` in `drop-shadow` excludes
 * it structurally, rather than by a name on an exemption list.
 *
 * hence the `node` vitest project: the rest of the suite runs in browser mode,
 * which has no `node:fs`.
 */

/** comments blanked, newlines kept so line numbers still land. unlike the other
 *  sweeps this one reads raw text rather than `className=` attributes: a class
 *  string also reaches the DOM through a plain TS table (`helpers/modal-box.ts`
 *  spells `z-modal` that way), and a bracket value is exactly the kind of thing
 *  that gets hoisted into one. the cost of reading everything is that the
 *  elevation set's own prose names every needle in this file — the token
 *  comments in `theme.css` quote `shadow-lg`, `shadow-2xl` and
 *  `shadow-primary/25` to record what each token replaced — so the comments go
 *  before the search does. */
const uncommented = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^([ \t]*)\/\/.*$/gm, "$1");

const sources = sources_of(import.meta.url, uncommented);

const line_of = (text: string, i: number) =>
  text.slice(0, i).split("\n").length;

/** every match of `needle`, as `path:line class`. the needles below all open
 *  with `(?<![-\w])`, which is what keeps `drop-shadow-lg` and `rotate-z-360`
 *  out without either of them being named anywhere. */
const findings = (needle: RegExp) =>
  sources.flatMap(({ file, text }) =>
    [...text.matchAll(needle)].map(
      (m) => `${file}:${line_of(text, m.index)} ${m[0]}`
    )
  );

describe("depth is spent by name", () => {
  test("no stock shadow utility", () => {
    // every one of these is a rung of a scale this system does not have. the
    // named set is `shadow-card`, `shadow-floating`, the two recessed tokens,
    // the two marketing lifts and `shadow-handle`; flush is written by writing no
    // shadow at all, which is why `shadow-none` is in here rather than exempt
    // from it.
    expect(
      findings(/(?<![-\w])shadow-(?:xs|sm|md|lg|xl|2xl|inner|none)(?![-\w])/g)
    ).toEqual([]);
  });

  test("no arbitrary shadow value", () => {
    // the one case the namespace reset provably cannot reach: a bracket value
    // is compiled from its own text and never looks at the theme, so it
    // survives a closed namespace and paints a depth that is in the product
    // and in no ledger.
    expect(findings(/(?<![-\w])shadow-\[[^\]]*\]/g)).toEqual([]);
  });

  test("the retired card lift is gone", () => {
    // `--shadow-lift-card` was deleted when a card took the card rung on every
    // ground. with the namespace closed a stray `shadow-lift-card` compiles to
    // nothing, so a card would render with its edge and without its shadow
    // and still look plausible — only reading the source reports it.
    expect(findings(/(?<![-\w])shadow-lift-card(?![-\w])/g)).toEqual([]);
  });

  test("no shadow color written beside a name", () => {
    // `shadow-<color>/<alpha>` is the spelling the lift tokens folded
    // in. written beside a named lift it silently replaces that lift's own
    // tint, so the class string says one thing and the paint says another —
    // and the second opacity is the one that drifts.
    expect(findings(/(?<![-\w])shadow-[a-z][\w-]*\/\d+/g)).toEqual([]);
  });
});

describe("the stacking ladder", () => {
  test("no raw z-index in the elevation range", () => {
    // the ladder's floor is `--z-index-subbar: 20`. below it is sibling
    // stacking inside one component — a different problem, no ladder, and
    // `z-0`/`z-10` stay legal. at 20 and up a raw number is a layer competing
    // with the six named steps on a value nobody re-derives.
    const offenders = findings(/(?<![-\w])z-(\d+)(?![-\w%])/g).filter(
      (f) => Number(f.split(" z-")[1]) >= 20
    );
    expect(offenders).toEqual([]);
  });

  test("no arbitrary z-index", () => {
    // same hole as `shadow-[…]`, and the same reason it has to be read rather
    // than compiled away: `z-[51]` is how a combobox in a dialog was shoved
    // one rung over it before the ladder ordered the two.
    expect(findings(/(?<![-\w])z-\[[^\]]*\]/g)).toEqual([]);
  });
});
