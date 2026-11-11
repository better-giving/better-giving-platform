import { describe, expect, test } from "vitest";
import { sources_of } from "./conformance/walk";

/**
 * the sweep for a ramp step spent off its job.
 *
 * every colour comes off a radix 12-step scale, and radix gives each step one
 * job (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale,
 * and packages/brand/design-system.md → "Resting surfaces"):
 *
 * | step | job |
 * | --- | --- |
 * | 1 / 2 | app background / subtle background — the page, a card |
 * | 3 / 4 / 5 | a component's fill at rest / hovered / pressed or selected |
 * | 6 | the edge of something you can't operate — a card, a header, a divider |
 * | 7 / 8 | the edge of something you can operate / hovered, and the focus ring |
 * | 9 / 10 | a solid fill / hovered |
 * | 11 / 12 | low- / high-contrast text |
 *
 * the semantic names sit on those steps already (`bg-card` 2, `bg-panel` 3,
 * `border-hairline` 6, `bg-secondary-hover` accent-4 …), so what drifts is a
 * step spelled at a call site — `text-gray-9`, `border-gray-3`,
 * `hover:bg-gray-3` — which compiles, paints, reads fine in review and is the
 * wrong rung for what the element is. the colour reset can't catch it: every
 * step is a real utility.
 *
 * ## the rules, kept to what holds without per-screen judgement
 *
 * - **ink is step 11 or 12.** `text-<scale>-1…10` is a background, border or
 *   solid step read as text.
 * - **an edge is step 6 or up.** a `border`/`divide`/`outline`/`ring` on
 *   steps 1–5 is a fill read as a line — on the step-2 card a step-3 line is
 *   under what apca can measure.
 * - **a hover or highlight is step 4 (5 pressed).** a hover onto steps 1–3, or
 *   onto the tokens that sit there (`secondary`, `panel`, `card`,
 *   `background`, `surface`, `popover`, `band`, the three `*-subtle` bands),
 *   paints the resting rung, so
 *   the state is a step short or invisible. a disabled or busy state holding
 *   its fill under the pointer is not a hover and stays out.
 *
 * what it leaves to the screen — a solid step as a surface, a control drawn
 * with the non-interactive step 6, a field edge that isn't `--input` — needs
 * to know what the element is, which a class string doesn't say. the ledger
 * lists those for the screen walk.
 */

/** blanks block and whole-line comments, keeping line numbers. a string
 * literal is matched first and left whole, so a `/*` written inside one
 * doesn't open a comment that swallows the class strings after it. */
const uncommented = (text: string) =>
  text.replace(
    /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$/gm,
    (m) => (/^["'`]/.test(m) ? m : m.replace(/[^\n]/g, " "))
  );

const sources = sources_of(import.meta.url, uncommented);

const line_of = (text: string, i: number) =>
  text.slice(0, i).split("\n").length;

/** class tokens out of every string literal and `@apply` line, where written. */
const class_tokens = sources
  .filter(({ file }) => !file.includes("/__tests__/"))
  .flatMap(({ file, text }) =>
    [...text.matchAll(/"([^"\n]*)"|`([^`]*)`|@apply ([^;]*);/g)].flatMap((m) =>
      (m[1] ?? m[2] ?? m[3] ?? "")
        .split(/\s+/)
        .filter(Boolean)
        // a ternary branch inside a template literal keeps its quotes
        .map((t) => ({
          file,
          n: line_of(text, m.index),
          t: t.replace(/["'`]/g, ""),
        }))
    )
  );

const SCALE = "(?:gray|accent|success|warning|destructive)";

interface IRule {
  name: string;
  off: (token: string) => boolean;
}

const variants = (t: string) => t.split(":").slice(0, -1);
const utility = (t: string) => t.slice(t.lastIndexOf(":") + 1);

const RULES: IRule[] = [
  {
    name: "ink on a background, border or solid step",
    off: (t) =>
      new RegExp(`^text-${SCALE}-([1-9]|10)(/\\d+)?$`).test(utility(t)),
  },
  {
    name: "an edge on a fill step",
    off: (t) =>
      new RegExp(
        `^(border(-[xytblrse])?|divide|outline|ring|inset-ring)-${SCALE}-[1-5](/\\d+)?$`
      ).test(utility(t)),
  },
  {
    name: "a hover or highlight on the resting step",
    off: (t) => {
      const v = variants(t);
      const state = v.some(
        (x) =>
          x === "hover" ||
          x === "data-highlighted" ||
          x === "data-[highlighted]"
      );
      const held = v.some((x) => /disabled|busy/.test(x));
      return (
        state &&
        !held &&
        new RegExp(
          `^bg-(${SCALE}-[1-3]|secondary|panel|card|background|surface|popover|band|(?:destructive|success|warning)-subtle)(/\\d+)?$`
        ).test(utility(t))
      );
    },
  },
];

const findings = class_tokens.flatMap(({ file, n, t }) =>
  RULES.filter((r) => r.off(t)).map((r) => `${file}:${n} ${t} — ${r.name}`)
);

describe("each ramp step does its radix job", () => {
  test("the rules read the spellings they are written for", () => {
    const cases: [string, boolean][] = [
      ["text-gray-11", false],
      ["text-gray-12", false],
      ["text-gray-10", true],
      ["placeholder:text-gray-9", true],
      ["text-accent-11", false],
      ["text-accent-9", true],
      ["border-gray-6", false],
      ["border-b-gray-3", true],
      ["divide-gray-3", true],
      ["border-hairline", false],
      ["inset-ring-gray-9", false],
      ["hover:bg-gray-4", false],
      ["hover:bg-gray-3", true],
      ["data-highlighted:bg-gray-3", true],
      ["hover:bg-secondary", true],
      ["hover:bg-secondary-hover", false],
      ["hover:bg-panel", true],
      ["hover:bg-card", true],
      ["hover:bg-background", true],
      ["hover:bg-surface", true],
      ["lg:hover:bg-surface", true],
      ["hover:bg-popover", true],
      ["data-highlighted:bg-popover", true],
      ["hover:bg-band", true],
      ["hover:bg-band/50", true],
      ["hover:bg-destructive-subtle", true],
      ["hover:bg-destructive-4", false],
      ["active:bg-destructive-subtle-active", false],
      ["lg:bg-surface", false],
      ["hover:bg-gray-4", false],
      ["aria-busy:hover:bg-gray-3", false],
      ["bg-gray-3", false],
      ["disabled:bg-gray-3", false],
    ];
    expect(
      cases.filter(([t, want]) => RULES.some((r) => r.off(t)) !== want)
    ).toEqual([]);
  });

  test("a comment opener inside a string doesn't blank the classes after it", () => {
    const src = [
      'const a = "w-[/*]";',
      'const b = "hover:bg-gray-3";',
      "/* a real",
      "   comment */ const c = 1;",
      "// whole line hover:bg-gray-3",
      "const d = 1;",
    ].join("\n");
    const out = uncommented(src);
    expect(out).toContain('"hover:bg-gray-3"');
    expect(out).not.toContain("a real");
    expect(out).not.toContain("whole line");
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
  });

  test("no step is spent off its job", () => {
    expect(findings).toEqual([]);
  });
});
