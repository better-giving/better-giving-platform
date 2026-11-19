/**
 * the closed set of modal content-box geometries — one full literal class
 * string per tier. these constraints hold this shape:
 *
 * - each string is literal, never composed at runtime. tailwind v4 is a jit
 *   over source text, so `max-w-${size}` compiles to no rule and no error.
 * - geometry and elevation only, no `bg-*`/`text-*`. utilities of equal
 *   specificity resolve by stylesheet source order, not class-string order,
 *   so a surface baked in here beats a call site's own on some sites and
 *   loses on others. the elevation is the modal level's (radix themes' panel
 *   plus shadow, `shadow-floating`) and the floating layer's 1px `--hairline`
 *   edge, which no call site spells; the sheet draws the edge only from `sm`,
 *   where it stops filling the viewport.
 * - centred by `inset-0 m-auto block-fit`, never a translate: a transform makes
 *   the box the containing block of every fixed descendant, so a menu panel
 *   portaled into it is clipped by its scroll instead of floating free.
 * - centred in what the user sees, a little above the middle, in a band
 *   symmetric about 40% of the viewport's height: `--ds-dialog-top` is a
 *   24px gap (more under a device notch, `env(safe-area-inset-top)`), the
 *   band starts that gap below the top and ends `--ds-view-lift` (0.2) of the
 *   height plus the same gap up from the bottom, so any box's middle sits at
 *   40%. every tier caps its height at the band, the viewport minus the lift
 *   and twice the gap, and at 90dvh (which only binds under a `--ds-view-lift`
 *   override below 0.1): a box taller
 *   than the band would split the overflow between its auto margins and start
 *   above the viewport, its heading cut off with nothing to scroll. a box at
 *   the cap stops the gap below the top and scrolls inside.
 * - `dvh`, not `vh`: `vh` is the largest viewport height and ignores mobile
 *   browser chrome.
 */
const sheet_box =
  "fixed inset-0 z-modal shadow-floating border-hairline sm:border flex inline-full flex-col max-sm:block-dvh max-sm:overflow-clip [--ds-dialog-top:max(--spacing(6),env(safe-area-inset-top,0px))] sm:inset-bs-(--ds-dialog-top) sm:inset-be-[calc(100dvh*var(--ds-view-lift,0.2)+var(--ds-dialog-top))] sm:m-auto sm:block-fit sm:inline-[480px] sm:max-block-[min(90dvh,calc(100dvh*(1_-_var(--ds-view-lift,0.2))_-_2*var(--ds-dialog-top)))] sm:overflow-y-auto sm:scrollbars sm:rounded-card";

export const modal_box = {
  /** 448px — prompts, confirms, filter panels */
  panel:
    "fixed inset-0 [--ds-dialog-top:max(--spacing(6),env(safe-area-inset-top,0px))] inset-bs-(--ds-dialog-top) inset-be-[calc(100dvh*var(--ds-view-lift,0.2)+var(--ds-dialog-top))] m-auto block-fit rounded-card border border-hairline shadow-floating z-modal inline-[90%] sm:inline-full sm:max-inline-md max-block-[min(90dvh,calc(100dvh*(1_-_var(--ds-view-lift,0.2))_-_2*var(--ds-dialog-top)))] overflow-y-auto scrollbars",
  /** 512px — the default: single-column forms and dialogs */
  sm: "fixed inset-0 [--ds-dialog-top:max(--spacing(6),env(safe-area-inset-top,0px))] inset-bs-(--ds-dialog-top) inset-be-[calc(100dvh*var(--ds-view-lift,0.2)+var(--ds-dialog-top))] m-auto block-fit rounded-card border border-hairline shadow-floating z-modal inline-[90%] sm:inline-full sm:max-inline-lg max-block-[min(90dvh,calc(100dvh*(1_-_var(--ds-view-lift,0.2))_-_2*var(--ds-dialog-top)))] overflow-y-auto scrollbars",
  /** 672px — share sheets, charts, multi-column forms */
  md: "fixed inset-0 [--ds-dialog-top:max(--spacing(6),env(safe-area-inset-top,0px))] inset-bs-(--ds-dialog-top) inset-be-[calc(100dvh*var(--ds-view-lift,0.2)+var(--ds-dialog-top))] m-auto block-fit rounded-card border border-hairline shadow-floating z-modal inline-[90%] sm:inline-full sm:max-inline-2xl max-block-[min(90dvh,calc(100dvh*(1_-_var(--ds-view-lift,0.2))_-_2*var(--ds-dialog-top)))] overflow-y-auto scrollbars",
  /** 768px — the widest: tabular admin forms, embedded third-party frames */
  lg: "fixed inset-0 [--ds-dialog-top:max(--spacing(6),env(safe-area-inset-top,0px))] inset-bs-(--ds-dialog-top) inset-be-[calc(100dvh*var(--ds-view-lift,0.2)+var(--ds-dialog-top))] m-auto block-fit rounded-card border border-hairline shadow-floating z-modal inline-[90%] sm:inline-full sm:max-inline-3xl max-block-[min(90dvh,calc(100dvh*(1_-_var(--ds-view-lift,0.2))_-_2*var(--ds-dialog-top)))] overflow-y-auto scrollbars",
  /**
   * 480px dialog (named `sheet`), full-viewport sheet below `sm`.
   * from `sm` it takes the band cap the other tiers have.
   * the sheet's own height is `block-dvh`.
   */
  sheet: sheet_box,
  /** @deprecated the same box as `sheet`; use `sheet`. kept so copied call sites keep compiling. */
  donate: sheet_box,
} as const;

export type ModalSize = keyof typeof modal_box;
