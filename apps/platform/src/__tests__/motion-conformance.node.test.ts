import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the sweep for speed picked by eye rather than spent by name.
 *
 * the motion set (`packages/ui/src/styles/theme.css`) is three speeds bound to
 * `duration-fast|base|slow` by @utility, tailwind's three curves with a role
 * each, and the two `--default-transition-*` keys that make the common case
 * unwritten. unlike every other foundation in this ledger it has **no
 * structural half**: there is no `--duration-*` theme namespace to reset, so
 * `duration-200` compiles no matter what the token file says, and this file is
 * the entire gate rather than the part the compiler cannot reach.
 *
 * ## what it reads for
 *
 * - **a raw duration.** `duration-200` and `duration-[250ms]` are a speed
 *   re-picked at a call site. the three named steps are the three values the
 *   product actually runs at; a fourth arrives silently, renders plausibly, and
 *   is in no ledger.
 * - **`ease-in-out` written out loud.** `--default-transition-timing-function`
 *   is bound to it, so the class is a no-op wherever it appears. worse than
 *   redundant: once it is scattered through the tree an explicit `ease-out`
 *   stops being legible as "this one enters", which is the whole distinction
 *   the keyframes are paired on. the house curve is written by writing nothing,
 *   the same way flush is written by writing no shadow.
 * - **an arbitrary curve.** `ease-[cubic-bezier(…)]` never consults the theme,
 *   so it survives any amount of closing and paints a motion nothing else in
 *   the product has.
 * - **an easing or a speed with no transition to modify.** this one is a real
 *   bug rather than drift: `ease-in-out` on an element with no `transition-*`
 *   modifies nothing and renders as a snap. two sites carried it — a static
 *   grid wrapper on the campaign page, and the cpf toggle's track, whose twin
 *   in `tip-field.tsx` had the `transition-colors` it was missing. neither
 *   produced an error, a warning or a visibly broken screen.
 *
 * the needles are anchored with `(?<![-\w])`, which is what keeps
 * `--duration-fast`, `transition-duration`, `--marquee-duration` and
 * `var(--ease-in)` out of the results without any of them being named on an
 * exemption list — a custom property is not a utility, and a raw
 * `transition: … var(--duration-slow) …` string is the correct spelling for the
 * two sites that cannot reach a utility.
 *
 * hence the `node` vitest project: the rest of the suite runs in browser mode,
 * which has no `node:fs`.
 */

/** comments blanked, newlines kept so line numbers still land. the motion set's
 *  own prose quotes `duration-200` and `ease-in-out` to record what the ladder
 *  replaced, so the comments go before the search does. */
const uncommented = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^([ \t]*)\/\/.*$/gm, "$1");

const sources = sources_of(import.meta.url, uncommented);

const line_of = (text: string, i: number) =>
  text.slice(0, i).split("\n").length;

const findings = (needle: RegExp) =>
  sources.flatMap(({ file, text }) =>
    [...text.matchAll(needle)].map(
      (m) => `${file}:${line_of(text, m.index)} ${m[0]}`
    )
  );

describe("speed is spent by name", () => {
  test("no raw duration value", () => {
    // `--duration-*` is not a theme namespace — `duration-<number>` is a bare
    // value parsed at the call site — so there is no reset that makes this
    // fail to compile. the three steps are `duration-fast|base|slow`, and a
    // transition that wants the house speed writes no duration at all.
    expect(findings(/(?<![-\w])duration-(?:\d|\[)[^\s"'`]*/g)).toEqual([]);
  });

  test("the house curve is written by writing nothing", () => {
    // `--default-transition-timing-function` is bound to `--ease-in-out`, so
    // the class changes nothing wherever it is written. leaving it out is what
    // keeps an explicit `ease-out` / `ease-in` meaning "this one enters" /
    // "this one leaves" — the pairing the `--animate-*` keyframes run on.
    expect(findings(/(?<![-\w])ease-in-out(?![-\w])/g)).toEqual([]);
  });

  test("no arbitrary easing", () => {
    // the one case a closed namespace provably cannot reach: a bracket value
    // is compiled from its own text and never looks at the theme.
    expect(findings(/(?<![-\w])ease-\[[^\]]*\]/g)).toEqual([]);
  });
});

/** every quoted string in the tree, as `path:line "…"`. a class string is read
 *  whole rather than line by line because it wraps: the motion utility and the
 *  `transition-*` it modifies routinely sit on different lines of the same
 *  attribute. */
const strings = sources.flatMap(({ file, text }) =>
  [...text.matchAll(/"[^"]*"|'[^']*'|`[^`]*`/g)].map((m) => ({
    at: `${file}:${line_of(text, m.index)}`,
    str: m[0],
  }))
);

describe("a modifier needs something to modify", () => {
  test("no easing or duration without a transition", () => {
    // `ease-in-out` on an element with no `transition-*` modifies nothing and
    // renders as a snap — silently, with no error and no obviously broken
    // screen. `animate-*` is the other thing an easing can legitimately sit
    // beside, so a string carrying one is not a finding. `ease-in-out` is not
    // in the needle because it cannot reach here — the test above rejects it
    // wherever it is written, inert or not.
    const motion =
      /(?<![-\w])(?:ease-(?:in|out)|duration-(?:fast|base|slow))(?![-\w])/;
    const offenders = strings
      .filter(({ str }) => motion.test(str))
      .filter(({ str }) => !/transition|animate-/.test(str))
      .map(({ at, str }) => `${at} ${str}`);
    expect(offenders).toEqual([]);
  });
});
