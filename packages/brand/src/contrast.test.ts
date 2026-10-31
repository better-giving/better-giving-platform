import { readFileSync } from "node:fs";
import { APCAcontrast, alphaBlend, sRGBtoY } from "apca-w3";
import { describe, expect, it } from "vitest";
import { colors } from "./colors.ts";
import { hex_to_oklch, oklch_to_hex } from "./oklch.ts";

// contrast gate: every APCA figure design-system.md records, recomputed from
// the shipped palette. the ledger's numbers were measured by hand once; this is
// what makes them re-checkable, so moving a ramp step fails here instead of
// silently invalidating the file.
//
// input is the sRGB round-trip (colors.ts), which colors.test.ts already pins
// to colors.css — so the measurement reads a generated, guarded value.
// argument order is text/foreground first, ground second; APCA reports
// light-on-dark negative and the ledger writes every figure unsigned, so the
// sign is dropped here too. one decimal, as the ledger writes them.

type Rgb = readonly number[];

const rgb = (hex: string): Rgb =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

const lc = (text: Rgb, ground: Rgb) =>
  Math.round(Math.abs(APCAcontrast(sRGBtoY(text), sRGBtoY(ground))) * 10) / 10;

// alpha composite, unrounded: an 8-bit snap of the intermediate moves several
// of these figures by up to 0.3 Lc.
const over = (fg: Rgb, alpha: number, ground: Rgb): Rgb =>
  alphaBlend([...fg, alpha], ground, false).slice(0, 3);

const to_hex = (v: Rgb) =>
  `#${v.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

// apca bronze simple mode, from the ledger's threshold table.
const min = {
  body_preferred: 90,
  body: 75,
  content: 60,
  detail: 45,
  spot: 30,
  hairline: 15,
} as const;

type Pairing = {
  what: string;
  fg: Rgb;
  ground: Rgb;
  // the Lc design-system.md records for this pairing.
  lc: number;
  // the threshold the ledger assigns it, or null where it records a figure
  // without holding the pairing to one (a rejected alternative, an
  // illustration, a fill the ledger rules out by role rather than by measure).
  min: number | null;
  // set where the ledger records the pairing as under its threshold. carries
  // the ledger's own reason: these are allowances, not skips.
  miss?: string;
};

const p = (
  what: string,
  fg: string | Rgb,
  ground: string | Rgb,
  lc: number,
  min: number | null,
  miss?: string
): Pairing => ({
  what,
  fg: typeof fg === "string" ? rgb(fg) : fg,
  ground: typeof ground === "string" ? rgb(ground) : ground,
  lc,
  min,
  miss,
});

// the figures recorded "on gray-1" were measured when gray-1 was the page. it
// still is the ground of the embedded donation form and of the emails, and it
// is the darkest ground any of these inks sits on outside a well: --background,
// --card and --surface are white now, which only raises a dark ink's Lc. the
// white ground's own figures are the "on --card" block below.
const page = colors.gray_1;
const white = "#ffffff";
const card = colors.card;

// tailwind's `/<alpha>` modifier, composited over the ground the ledger names.
const tint = (hex: string, alpha: number, ground: string | Rgb = page) =>
  over(rgb(hex), alpha, typeof ground === "string" ? rgb(ground) : ground);

// the mobile hero's worst case: a 70% scrim over a pure-white region of a photo.
const scrim = tint(colors.primary_deep, 0.7, white);

const pairings: Pairing[] = [
  // --- the white ground: --card, and --background / --surface with it
  p("gray-12 on --card", colors.gray_12, card, 103.3, min.body_preferred),
  p("gray-11 on --card", colors.gray_11, card, 79.6, min.content),
  p("gray-6 (--border) on --card", colors.border, card, 19.3, min.hairline),
  p(
    "gray-7 control boundary on --card",
    colors.gray_7,
    card,
    25.6,
    min.spot,
    "radix's element-border rung taken as generated; the white card lifts it 1.8 and it still misses"
  ),
  p(
    "gray-3 (--hairline) on --card",
    colors.hairline,
    card,
    0,
    min.hairline,
    "the design's: a line inside a card groups rows rather than gridding them, and apca clips a step this faint to 0. a line that must be found is --border"
  ),
  p("--ring on --card", colors.ring, card, 46.5, min.spot),
  p("--primary on --card", colors.primary, card, 76.9, min.content),
  p(
    "gray-11 on --panel (a well)",
    colors.gray_11,
    colors.panel,
    75.8,
    min.content
  ),
  p(
    "gray-12 on --panel (a well)",
    colors.gray_12,
    colors.panel,
    99.5,
    min.body_preferred
  ),

  // --- the blots, for copy that lands on the ground outside a card
  p("gray-12 on --wash", colors.gray_12, colors.wash, 87.5, min.body),
  p("gray-11 on --wash", colors.gray_11, colors.wash, 63.7, min.content),
  p("gray-12 on --wash-far", colors.gray_12, colors.wash_far, 91.3, min.body),
  p(
    "gray-11 on --wash-far",
    colors.gray_11,
    colors.wash_far,
    67.5,
    min.content
  ),
  p(
    "gray-12 on --wash-strong",
    colors.gray_12,
    colors.wash_strong,
    82,
    min.body
  ),
  p(
    "gray-11 on --wash-strong",
    colors.gray_11,
    colors.wash_strong,
    58.2,
    min.content,
    "the solo-card blot is behind the card, not behind copy: de-emphasised copy on the bare blot takes gray-12"
  ),
  p("--primary on --wash", colors.primary, colors.wash, 61.1, min.content),

  // --- borders, the focus ring, neutral ink on the page
  p("gray-6 (--border) on gray-1", colors.gray_6, page, 17.4, min.hairline),
  p(
    "gray-6 (--border) on --panel",
    colors.gray_6,
    colors.panel,
    15.5,
    min.hairline
  ),
  p(
    "gray-7 control boundary on gray-1",
    colors.gray_7,
    page,
    23.8,
    min.spot,
    "radix's element-border rung taken as generated; gray-8 clears and was declined 2026-09-13"
  ),
  p(
    "gray-7 control boundary on --panel",
    colors.gray_7,
    colors.panel,
    21.8,
    min.spot,
    "same rung, one surface down"
  ),
  p("gray-8 on gray-1", colors.gray_8, page, 34.3, min.spot),
  p("gray-8 on --panel", colors.gray_8, colors.panel, 32.4, min.spot),
  p("gray-11 on gray-1", colors.gray_11, page, 77.7, min.content),
  p("gray-12 on gray-1", colors.gray_12, page, 101.5, min.body_preferred),
  p("--ring (blue-8) on gray-1", colors.ring, page, 44.6, min.spot),
  // on the line and not over it, which is what surface-primary's ring rebind
  // exists for.
  p("--ring on --primary", colors.ring, colors.primary, 30.0, min.spot),
  p("gray-6 on --primary", colors.gray_6, colors.primary, 58.6, min.spot),

  // --- fill or ink: every token measured on the real page ground
  p("--primary on gray-1", colors.primary, page, 75.1, min.content),
  // the hover rung of the `link` recipe, and the first place step 10 is spent
  // as ink rather than as a fill. the ramp pairs a step 10 with nothing, so
  // this is the palette's own combination and is measured rather than inferred
  // from the step below it.
  p("--primary-hover on gray-1", colors.primary_hover, page, 80.7, min.content),
  // fill only by rule (gray-12 is the app's dark ink), so no threshold binds.
  p("--primary-deep on gray-1", colors.primary_deep, page, 93.9, null),
  p("--success glyph on gray-1", colors.success, page, 67.0, min.detail),
  p(
    "--success-subtle-fg on gray-1",
    colors.success_subtle_fg,
    page,
    72.0,
    min.content
  ),
  p("--destructive on gray-1", colors.destructive, page, 74.1, min.content),
  p(
    "--warning glyph on gray-1",
    colors.warning,
    page,
    39.9,
    min.detail,
    "a fill, not an icon ink: a meaningful amber glyph takes --warning-subtle-fg"
  ),
  p(
    "--warning glyph on white",
    colors.warning,
    white,
    41.8,
    min.detail,
    "same fill, on white"
  ),
  p(
    "--warning-subtle-fg on gray-1",
    colors.warning_subtle_fg,
    page,
    69.3,
    min.content
  ),
  p(
    "--warning-subtle-fg on white",
    colors.warning_subtle_fg,
    white,
    71.2,
    min.content
  ),
  p("--warning-fg on gray-1", colors.warning_fg, page, 94.2, min.content),
  p("gray-11 on gray-3", colors.gray_11, colors.gray_3, 70.9, min.content),
  p(
    "gray-11 on --secondary",
    colors.gray_11,
    colors.secondary,
    71.5,
    min.content
  ),
  p(
    "gray-11 on --secondary-active",
    colors.gray_11,
    colors.secondary_active,
    60.9,
    min.content
  ),
  p(
    "--success-subtle-fg on gray-3",
    colors.success_subtle_fg,
    colors.gray_3,
    65.1,
    min.content
  ),
  p(
    "--success-subtle-fg on --secondary",
    colors.success_subtle_fg,
    colors.secondary,
    65.8,
    min.content
  ),
  p(
    "--success-subtle-fg on --secondary-active",
    colors.success_subtle_fg,
    colors.secondary_active,
    55.1,
    min.content,
    "cross-scale, outside radix's own pairings: the ledger names it a pairing to avoid"
  ),
  p(
    "--destructive on gray-3",
    colors.destructive,
    colors.gray_3,
    67.3,
    min.content
  ),
  p(
    "--destructive on --secondary",
    colors.destructive,
    colors.secondary,
    68.0,
    min.content
  ),
  p(
    "--destructive on --destructive-subtle",
    colors.destructive,
    colors.destructive_subtle,
    66.7,
    min.content
  ),
  p(
    "--destructive on --panel",
    colors.destructive,
    colors.panel,
    72.2,
    min.content
  ),

  // --- the authored bands, and the step-11 inks across surfaces
  p(
    "--destructive-subtle-fg on --destructive-subtle",
    colors.destructive_subtle_fg,
    colors.destructive_subtle,
    64.8,
    min.content
  ),
  p(
    "--destructive-subtle-fg on --panel",
    colors.destructive_subtle_fg,
    colors.panel,
    70.3,
    min.content
  ),
  p(
    "--destructive-subtle-fg on gray-3",
    colors.destructive_subtle_fg,
    colors.gray_3,
    65.4,
    min.content
  ),
  p(
    "--destructive-subtle-fg on --secondary",
    colors.destructive_subtle_fg,
    colors.secondary,
    66.1,
    min.content
  ),
  p(
    "--destructive-subtle-fg on --destructive-subtle-active",
    colors.destructive_subtle_fg,
    colors.destructive_subtle_active,
    51.7,
    min.content,
    "the pressed rung of a subtle error control; transient, and radix guarantees step 11 against step 2 only"
  ),
  p("red-11 on red-2", colors.red_11, colors.red_2, 70.3, min.content),
  // red-4 carries no token: the row is the ledger's illustration of a step-11
  // ink degrading as the surface climbs its own scale.
  p("red-11 on red-4", colors.red_11, colors.red_4, 57.6, null),
  p(
    "--success-subtle-fg on --success-subtle",
    colors.success_subtle_fg,
    colors.success_subtle,
    66.1,
    min.content
  ),
  p(
    "--success-subtle-fg on --panel",
    colors.success_subtle_fg,
    colors.panel,
    70.0,
    min.content
  ),
  p(
    "--success-subtle-fg on green-2",
    colors.success_subtle_fg,
    colors.green_2,
    70.3,
    min.content
  ),
  p(
    "--warning-subtle-fg on --warning-subtle",
    colors.warning_subtle_fg,
    colors.warning_subtle,
    62.5,
    min.content
  ),
  p(
    "--warning-subtle-fg on --panel",
    colors.warning_subtle_fg,
    colors.panel,
    67.4,
    min.content
  ),
  p(
    "--warning-subtle-fg on amber-2",
    colors.warning_subtle_fg,
    colors.amber_2,
    67.2,
    min.content
  ),
  p(
    "--warning-subtle-fg on --secondary",
    colors.warning_subtle_fg,
    colors.secondary,
    63.2,
    min.content
  ),
  p(
    "--warning-subtle-fg on gray-3",
    colors.warning_subtle_fg,
    colors.gray_3,
    62.5,
    min.content
  ),
  p(
    "--warning-subtle-fg on --secondary-active",
    colors.warning_subtle_fg,
    colors.secondary_active,
    52.5,
    min.content,
    "cross-scale, on the pressed rung: the tightest ink in the palette and the one surface it misses"
  ),
  p(
    "gray-12 on --warning-subtle",
    colors.gray_12,
    colors.warning_subtle,
    94.6,
    min.body_preferred
  ),
  p(
    "gray-12 on --destructive-subtle",
    colors.gray_12,
    colors.destructive_subtle,
    94.0,
    min.body_preferred
  ),
  p(
    "gray-12 on --success-subtle",
    colors.gray_12,
    colors.success_subtle,
    95.7,
    min.body_preferred
  ),
  p(
    "--warning-fg on --warning-subtle",
    colors.warning_fg,
    colors.warning_subtle,
    87.3,
    min.content
  ),

  // --- filled controls: the fill and its own -fg
  p(
    "--primary-fg on --primary",
    colors.primary_fg,
    colors.primary,
    82.3,
    min.body
  ),
  p(
    "--warning-fg on --warning",
    colors.warning_fg,
    colors.warning,
    52.1,
    min.content,
    "the filled warning button's label; white is weaker still"
  ),
  // the alternative the ledger weighs and rejects, so nothing holds it to a floor.
  p("white on --warning", white, colors.warning, 46.4, null),
  p(
    "--success-fg on --success",
    colors.success_fg,
    colors.success,
    74.3,
    min.content
  ),

  // --- semantic hue on a --primary fill: the class the ledger closes with a
  // rule rather than a token. every row but the last is why.
  p(
    "--destructive-subtle-fg on --primary",
    colors.destructive_subtle_fg,
    colors.primary,
    0.0,
    min.content,
    "invisible: under apca's low clip"
  ),
  p(
    "--warning-subtle-fg on --primary",
    colors.warning_subtle_fg,
    colors.primary,
    0.0,
    min.content,
    "invisible"
  ),
  p(
    "--success-subtle-fg on --primary",
    colors.success_subtle_fg,
    colors.primary,
    0.0,
    min.content,
    "invisible"
  ),
  p(
    "--success on --primary",
    colors.success,
    colors.primary,
    0.0,
    min.content,
    "invisible"
  ),
  p(
    "--warning on --primary",
    colors.warning,
    colors.primary,
    34.8,
    min.content,
    "under the Lc 60 its copy needs"
  ),
  p(
    "--destructive on --primary",
    colors.destructive,
    colors.primary,
    0.0,
    min.content,
    "invisible"
  ),
  // a band on its own node against the fill it sits over: separation, not ink.
  p(
    "--destructive-subtle chip against --primary",
    colors.destructive_subtle,
    colors.primary,
    72.0,
    null
  ),

  // --- the alpha anti-pattern: bg-<token>/10 text-<token>, over the page
  p(
    "bg-warning/10 text-warning",
    colors.warning,
    tint(colors.warning, 0.1),
    34.9,
    min.content,
    "illegible; the case that forced the authored pair"
  ),
  p(
    "bg-success/10 text-success",
    colors.success,
    tint(colors.success, 0.1),
    58.6,
    min.content,
    "under Lc 60, and --success is not a text color anywhere"
  ),
  p(
    "bg-destructive/10 text-destructive",
    colors.destructive,
    tint(colors.destructive, 0.1),
    63.1,
    min.content
  ),
  p(
    "bg-primary/10 text-primary",
    colors.primary,
    tint(colors.primary, 0.1),
    66.0,
    min.content
  ),
  p(
    "bg-destructive/20 text-destructive",
    colors.destructive,
    tint(colors.destructive, 0.2),
    52.6,
    min.content,
    "a rejected pressed rung: an alpha of the fill, which nothing generated"
  ),
  p(
    "bg-destructive/20 text-destructive-subtle-fg",
    colors.destructive_subtle_fg,
    tint(colors.destructive, 0.2),
    50.8,
    min.content,
    "the same rejected rung with the band's own ink"
  ),

  // --- the --primary-fg alpha ladder in components/footer/, over --primary
  p(
    "text-primary-fg/90 on --primary",
    tint(colors.primary_fg, 0.9, colors.primary),
    colors.primary,
    71.9,
    min.content
  ),
  p(
    "text-primary-fg/80 on --primary",
    tint(colors.primary_fg, 0.8, colors.primary),
    colors.primary,
    62.0,
    min.content
  ),
  p(
    "text-primary-fg/50 placeholder on --primary",
    tint(colors.primary_fg, 0.5, colors.primary),
    colors.primary,
    34.6,
    min.spot
  ),
  p(
    "border-primary-fg/20 on --primary",
    tint(colors.primary_fg, 0.2, colors.primary),
    colors.primary,
    11.6,
    min.spot,
    "a live failure the ledger names: the newsletter field's boundary. --primary-border exists for this job"
  ),

  // --- --primary-deep, opaque and as the hero's translucent scrim
  p("white on --primary-deep", white, colors.primary_deep, 99.6, min.body),
  p(
    "text-white/90 on --primary-deep",
    tint(white, 0.9, colors.primary_deep),
    colors.primary_deep,
    86.6,
    min.body
  ),
  p(
    "white on a primary-deep/70 scrim over white",
    white,
    scrim,
    77.7,
    min.body
  ),
  p(
    "white on a primary-deep/68 scrim over white",
    white,
    tint(colors.primary_deep, 0.68, white),
    75.9,
    min.body
  ),
  p(
    "white on a primary-deep/65 scrim over white",
    white,
    tint(colors.primary_deep, 0.65, white),
    73.2,
    min.body,
    "a thinner scrim the ledger measures and rules out"
  ),
  p(
    "white on a primary-deep/60 scrim over white",
    white,
    tint(colors.primary_deep, 0.6, white),
    68.4,
    min.body,
    "thinner still"
  ),
  p(
    "text-white/90 on a primary-deep/70 scrim over white",
    over(rgb(white), 0.9, scrim),
    scrim,
    68.5,
    min.body,
    "why text on the scrim takes full white, never an alpha rung"
  ),
  p(
    "border-white/40 on --primary-deep",
    tint(white, 0.4, colors.primary_deep),
    colors.primary_deep,
    30.4,
    min.spot
  ),

  // --- the allocation slider's adjacent track segments. both are fills and the
  // legend above prints each value as text, so only the hairline floor binds;
  // the lower of the two polarities is the one recorded.
  p(
    "slider grant (gray-3) beside savings (--warning)",
    colors.warning,
    colors.gray_3,
    33.1,
    min.hairline
  ),
  p(
    "slider savings (--warning) beside investment (--success)",
    colors.success,
    colors.warning,
    24.9,
    min.hairline
  ),
];

describe("every documented pairing measures the Lc the ledger records", () => {
  it.each(pairings)("$what", ({ fg, ground, lc: recorded }) => {
    expect(lc(fg, ground)).toBe(recorded);
  });
});

describe("every pairing clears the threshold the ledger assigns it", () => {
  const held = pairings.filter((x) => x.min !== null && !x.miss);
  it("finds pairings to hold", () => {
    expect(held.length).toBeGreaterThan(0);
  });
  it.each(held)("$what clears Lc $min", ({ fg, ground, min: floor }) => {
    expect(lc(fg, ground)).toBeGreaterThanOrEqual(floor as number);
  });
});

// the misses are allowances, not skips: each one's measured value is asserted
// above, so a reskin that keeps the miss passes and one that deepens it fails.
// a reskin that FIXES one fails here instead, which is the ledger edit.
describe("the pairings the ledger records under their threshold still are", () => {
  const misses = pairings.filter((x) => x.miss && x.min !== null);
  it("finds the recorded misses", () => {
    expect(misses.length).toBeGreaterThan(0);
  });
  it.each(misses)(
    "$what is under Lc $min — $miss",
    ({ fg, ground, min: floor }) => {
      expect(lc(fg, ground)).toBeLessThan(floor as number);
    }
  );
});

// --- the two color-mix() tokens
//
// neither has a literal behind it, so neither reaches colors.ts and neither is
// covered above. the recipe is read out of the css the way colors.test.ts reads
// :root — a hardcoded percentage here would keep passing against a stale one —
// while the ingredients still come from the guarded mirror.
const css = readFileSync(new URL("./colors.css", import.meta.url), "utf8");

type Recipe = { first: string; pct: number; second: string };

function recipe(token: string): Recipe {
  const m = css.match(
    new RegExp(
      `--${token}:\\s*color-mix\\(\\s*in oklch,\\s*var\\(--([a-z0-9-]+)\\)\\s*([\\d.]+)%,\\s*(transparent|var\\(--[a-z0-9-]+\\))\\s*\\)`
    )
  );
  if (!m) {
    throw new Error(
      `--${token}: no color-mix(in oklch, var(--x) n%, …) declaration to measure`
    );
  }
  return { first: m[1], pct: Number(m[2]), second: m[3] };
}

const hex_of = (name: string): string => {
  const value = colors[name.replace(/-/g, "_") as keyof typeof colors];
  if (!value) throw new Error(`--${name}: no hex twin in colors.ts`);
  return value;
};

// color-mix(in oklch, a pct%, b). an achromatic endpoint's hue is powerless, so
// it takes the other's rather than interpolating an arc off h=0 — the two
// resolutions are the Lc 60.9 / 61.8 spread the ledger declines to pick between,
// and this is the one a browser renders.
function mix_oklch(a: string, b: string, pct: number): string {
  const [a_l, a_c, a_h] = hex_to_oklch(a);
  const [b_l, b_c, b_h] = hex_to_oklch(b);
  const t = pct / 100;
  if (a_c > 1e-6 && b_c > 1e-6 && Math.abs(a_h - b_h) > 1e-6) {
    throw new Error("two chromatic endpoints: hue interpolation is unhandled");
  }
  return oklch_to_hex(
    a_l * t + b_l * (1 - t),
    a_c * t + b_c * (1 - t),
    a_c > 1e-6 ? a_h : b_h
  );
}

describe("--primary-border, the mix that has no hex twin", () => {
  const { first, pct, second } = recipe("primary-border");
  const ground = hex_of(second.replace(/^var\(--|\)$/g, ""));
  const mixed = mix_oklch(hex_of(first), ground, pct);

  it("mixes to a value off the ramp", () => {
    expect(mixed).toBe("#d3e1ef");
  });

  // the ledger carries this as unchecked ("about Lc 61"); this is the figure.
  it("clears a control boundary on --primary", () => {
    expect(lc(rgb(mixed), rgb(ground))).toBe(61.8);
    expect(lc(rgb(mixed), rgb(ground))).toBeGreaterThanOrEqual(min.spot);
  });
});

describe("--overlay, the dialog scrim", () => {
  const { first, pct, second } = recipe("overlay");
  it("is its step mixed with transparent", () => {
    expect(second).toBe("transparent");
  });

  // composited over the white page and cards it scrims. no ledger figure exists for it either:
  // the token's job is to dim, and this pins how far it does.
  it("dims the page by a recorded amount", () => {
    const dimmed = over(rgb(hex_of(first)), pct / 100, rgb(card));
    expect(to_hex(dimmed)).toBe("#babcbf");
    expect(lc(dimmed, rgb(card))).toBe(36.2);
  });
});

// the ledger states the composited value of the hero's scrim, and the 70% step
// is chosen against it: worth pinning on its own, since every figure in that
// section is measured on this stack.
describe("the hero scrim composites to the recorded color", () => {
  it("is #60778c over a pure-white region", () => {
    expect(to_hex(scrim)).toBe("#60778c");
  });
});
