/**
 * the closed set of modal content-box geometries — one full literal class
 * string per tier. four constraints hold this shape:
 *
 * - each string is literal, never composed at runtime. tailwind v4 is a jit
 *   over source text, so `max-w-${size}` compiles to no rule and no error.
 * - geometry only, no `bg-*`/`text-*`/`border`. utilities of equal specificity
 *   resolve by stylesheet source order, not class-string order, so a surface
 *   baked in here beats a call site's own on some sites and loses on others.
 * - every tier caps its own height. `fixed-center` is `position: fixed` plus a
 *   -50% translate, so a taller box puts its heading and its submit control
 *   off-screen with nothing to scroll.
 * - `dvh`, not `vh`: `vh` is the largest viewport height and ignores mobile
 *   browser chrome.
 */
export const modal_box = {
  /** 448px — prompts, confirms, filter panels */
  panel:
    "fixed-center rounded-card z-modal w-[90vw] sm:w-full sm:max-w-md max-h-[90dvh] overflow-y-auto scrollbars",
  /** 512px — the default: single-column forms and dialogs */
  sm: "fixed-center rounded-card z-modal w-[90vw] sm:w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto scrollbars",
  /** 672px — share sheets, charts, multi-column forms */
  md: "fixed-center rounded-card z-modal w-[90vw] sm:w-full sm:max-w-2xl max-h-[90dvh] overflow-y-auto scrollbars",
  /** 768px — the widest: tabular admin forms, embedded third-party frames */
  lg: "fixed-center rounded-card z-modal w-[90vw] sm:w-full sm:max-w-3xl max-h-[90dvh] overflow-y-auto scrollbars",
  /**
   * 480px dialog, full-viewport sheet below `sm`.
   * not `fixed-center`: `inset-0` and `top`/`left` set the same properties,
   * and two of them in one string resolve by stylesheet order.
   * `max-h-[90dvh]` is the desktop cap the conformance sweep requires.
   * the sheet's own height is `h-dvh`.
   */
  donate:
    "fixed z-modal flex w-full flex-col max-sm:inset-0 max-sm:h-dvh max-sm:overflow-hidden sm:top-1/2 sm:left-1/2 sm:h-auto sm:w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-h-[90dvh] sm:overflow-y-auto sm:scrollbars sm:rounded-card",
} as const;

export type ModalSize = keyof typeof modal_box;
