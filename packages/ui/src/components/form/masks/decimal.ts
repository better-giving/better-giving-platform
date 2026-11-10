import type { IMask } from "../mask-types";

/** the characters that count as "typed" for caret placement: a comma is
 * inserted by the mask, never typed, so the caret skips over it. */
export const keep = /[\d.]/;

/** a plain decimal with grouping commas, as typed: digits, one dot, at most
 * `places` decimals. anything else in `raw` — letters, "$", spaces, commas, a
 * second dot — is dropped, so a paste lands as the nearest valid number and the
 * field never shows a value the schema rejects. A trailing dot survives, so
 * "9627." is still mid-typing. */
export function format(raw: string, places = 2): string {
  const s = raw.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  const whole = (dot === -1 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (dot === -1) return grouped;
  const frac = s
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, places);
  return `${grouped || "0"}.${frac}`;
}

/** display → the plain decimal a form stores ("9,627.92" → "9627.92") */
export function unmask(masked: string, places = 2): string {
  return format(masked, places).replace(/,/g, "");
}

/** the mask for `places` decimals — 2 for dollars, a currency's or token's own
 * precision elsewhere, `Number.POSITIVE_INFINITY` for no cap. */
export function decimals(places = 2): IMask {
  return {
    format: (raw) => format(raw, places),
    unmask: (masked) => unmask(masked, places),
    keep,
  };
}
