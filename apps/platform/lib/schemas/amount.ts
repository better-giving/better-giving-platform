import * as v from "valibot";

export const amount_format_err = (places = 2) =>
  places === 0 ? "Enter a number, like 1250" : "Enter a number, like 1250.50";

/** two decimals is the dollar case: a third reads as a malformed amount, so it
 * gets the same message and example as any other */
export const amount_places_err = (places: number) =>
  places === 0
    ? "Enter a whole number, no cents"
    : places === 2
      ? amount_format_err(2)
      : `Use at most ${places} decimal${places === 1 ? "" : "s"}`;

/** "$" and spaces go; commas stay for the shape check */
const trim_amount = (raw: string) => raw.replace(/[$\s]/g, "");

/** commas only sit between three-digit groups, so "12,50" is rejected, not
 * read as 1250. a first group starting with 0 is refused too: the mask reads
 * "0,500" as the decimal 0.5, and this must not read it as 500 */
const shape = /^-?([1-9]\d{0,2}(,\d{3})+|\d+)?(\.\d*)?$/;

const decimals = (x: string) => x.split(".")[1]?.length ?? 0;

/** free text a person typed or pasted → the number it reads as: a plain decimal
 * of at most `places` decimals, with "$", spaces and thousands commas allowed.
 * anything else fails with {@link amount_format_err}, and too many decimals with
 * {@link amount_places_err}; the caller chains its own range checks (greater
 * than 0, a minimum) after it. the masked inputs hand
 * this the plain decimal already — this is the backstop for a paste or a
 * submit that never went through one. */
export const amount_num = (places = 2) =>
  v.pipe(
    v.string(),
    v.transform(trim_amount),
    v.check((x) => /\d/.test(x) && shape.test(x), amount_format_err(places)),
    v.check((x) => decimals(x) <= places, amount_places_err(places)),
    v.transform((x) => +x.replace(/,/g, ""))
  );

const plain = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumFractionDigits: 100,
});

/** a number as the plain decimal a schema outputs: `String(1e-7)` is "1e-7",
 * which the mask and `amount_num` read as something else */
export const decimal_str = (n: number) => plain.format(n);
