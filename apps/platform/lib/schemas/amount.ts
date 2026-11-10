import * as v from "valibot";

export const amount_format_err = "Enter a number, like 1250.50";

/** "$" and spaces go; commas stay for the shape check, which only lets them
 * sit between three-digit groups so "12,50" is rejected, not read as 1250 */
const trim_amount = (raw: string) => raw.replace(/[$\s]/g, "");

const shape = (places: number) =>
  new RegExp(
    `^-?(\\d{1,3}(,\\d{3})+|\\d+)?(\\.\\d${places === Number.POSITIVE_INFINITY ? "*" : `{0,${places}}`})?$`
  );

/** free text a person typed or pasted → the number it reads as: a plain decimal
 * of at most `places` decimals, with "$", spaces and thousands commas allowed.
 * Anything else fails with {@link amount_format_err}; the caller chains its own
 * range checks (greater than 0, a minimum) after it. The masked inputs hand
 * this the plain decimal already — this is the backstop for a paste or a
 * submit that never went through one. */
export const amount_num = (places = 2) => {
  const re = shape(places);
  return v.pipe(
    v.string(),
    v.transform(trim_amount),
    v.check((x) => /\d/.test(x) && re.test(x), amount_format_err),
    v.transform((x) => +x.replace(/,/g, ""))
  );
};
