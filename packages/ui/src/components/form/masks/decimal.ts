import type { IMask } from "../mask-types";

/** the characters that count as "typed" for caret placement: a comma is
 * inserted by the mask, never typed, so the caret skips over it. */
export const keep = /[\d.]/;

/** the field's own value — a plain decimal, or the grouped display read back —
 * as a display: digits, one dot, at most `places` decimals, grouping commas.
 * every comma here is grouping, because the field only ever holds the commas
 * it drew; text the user typed or pasted goes through `read` first. leading
 * zeros stay, so backspacing the "1" of "1,000" leaves "000" for the next
 * digit rather than collapsing to "0". A trailing dot survives, so "9627." is
 * still mid-typing. */
export function format(raw: string, places = 2): string {
  const s = raw.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  const whole = dot === -1 ? s : s.slice(0, dot);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (dot === -1) return grouped;
  const frac = s
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, places);
  return `${grouped || "0"}.${frac}`;
}

/** text the user typed or pasted, as digits and dots — `null` refuses it.
 * - a minus is refused whole: dropping it would turn -50 into 50.
 * - the last comma is the decimal separator ("12,50", "1.234,56", a comma
 *   keypad's "1,") unless exactly 3 digits follow it with a whole part that
 *   doesn't start with 0 ("1,234", "12,34,567"), which is grouping. A comma
 *   followed by a dot is always grouping.
 * - "$", spaces and letters are dropped. */
export function read(text: string): string | null {
  if (text.includes("-")) return null;
  const s = text.replace(/[^\d.,]/g, "");
  const comma = s.lastIndexOf(",");
  if (comma === -1 || comma < s.lastIndexOf(".")) return s.replace(/,/g, "");
  const whole = s.slice(0, comma).replace(/\D/g, "");
  const after = s.slice(comma + 1);
  const grouping = /^\d{3}$/.test(after) && /^[1-9]/.test(whole);
  return grouping ? whole + after : `${whole}.${after}`;
}

/** display → the plain decimal a form stores ("9,627.92" → "9627.92") */
export function unmask(masked: string, places = 2): string {
  return format(masked, places).replace(/,/g, "");
}

/** the mask for `places` decimals — 2 for dollars, a currency's or token's own
 * precision elsewhere, `Number.POSITIVE_INFINITY` for no cap.
 *
 * the cap is on what the user adds: a field already holding more decimals
 * (a currency or token switch to fewer) keeps them through an edit elsewhere
 * in it, so "1.2345" at 2 places takes a digit before the point and loses one
 * decimal per backspace; the form's schema reports the excess. */
export function decimals(places = 2): IMask {
  const mask: IMask = {
    format: (raw) => format(raw, places),
    unmask: (masked) => unmask(masked, places),
    read,
    keep,
    fit: (own) => {
      const dot = own.indexOf(".");
      const held = dot === -1 ? 0 : own.length - dot - 1;
      return held > places ? decimals(held) : mask;
    },
  };
  return mask;
}
