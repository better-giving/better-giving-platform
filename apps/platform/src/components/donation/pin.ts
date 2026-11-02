/** campaign dialog footer. mounts that leave `pin` unset never render it.
 * the bottom padding is the home-indicator inset when that is larger than
 * the 12px step, and the fill is opaque, so a glyph scrolling under the bar
 * cannot show in that strip. the length is a variable: a bracket padding
 * is off the spacing ladder. */
export const pin_bar =
  "sticky bottom-0 z-10 mt-auto flex w-full shrink-0 flex-col gap-3 border-t border-hairline bg-card px-5 sm:px-6 pt-2 [--pin-safe:max(0.75rem,env(safe-area-inset-bottom))] pb-(--pin-safe)";

/** the card step pads its summary, and this footer sits inside that padding.
 * the width has to grow by the same amount the negative margin pulls, or
 * the right edge stays short of the dialog. `w-full` on the bar is the same
 * layer and wins an unforced calc, which is why these are marked important. */
export const pin_bleed =
  "-mx-5 w-[calc(100%+2.5rem)]! sm:-mx-6 sm:w-[calc(100%+3rem)]!";
