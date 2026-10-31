/**
 * one popup / option / status vocabulary for every select and combobox.
 *
 * what lives here is the shared shell; what stays at a call site is genuinely
 * per-host — the popup's width, and the scrollbar theming the embedded donation
 * form drives from its tenant accents.
 */

/**
 * the portaled popup shell.
 *
 * width is the host's: `w-(--reference-width)` when the popup tracks its
 * control, a fixed track when it doesn't, or sized to its options (never
 * narrower than the control) under a compact select. so is the scrollbar — see
 * `popup_scrollbar_cls`.
 */
export const popup_cls =
  "z-floating max-h-60 overflow-y-auto overscroll-contain rounded-card bg-card text-gray-12 shadow-floating";

/** the app scrollbar for a popup list. */
export const popup_scrollbar_cls = "scrollbars";

/**
 * one option row.
 *
 * both zag machines emit `data-state="checked"` for the selected row and
 * `data-highlighted` for the keyboard-focused one (`getItemProps`,
 * @zag-js/select + @zag-js/combobox 1.41.2). `data-selected` matches neither.
 */
export const option_cls =
  "flex items-center gap-2 px-4 py-2 text-sm hover:bg-secondary data-highlighted:bg-secondary data-[state=checked]:bg-secondary-active";

/** the line that replaces the option rows while a list is empty/loading/failed. */
export const status_cls = "px-4 py-2 text-sm text-gray-11";

/** one wording per status, across every popup. */
export const status_text = {
  loading: "Searching…",
  error: "Failed to load options",
  /** the list has rows, none of them match what was typed */
  no_match: (q: string) => `${q} not found`,
  /** the list itself is empty — nothing to choose from, nothing was typed */
  empty: "No options found",
} as const;

/** rows rendered from a filtered list before the rest are cut. */
export const RESULT_LIMIT = 10;
