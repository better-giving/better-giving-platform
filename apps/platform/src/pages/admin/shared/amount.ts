import * as v from "valibot";

/** commas only between three-digit groups, so "12,50" is rejected rather than read as 1250 */
const AMOUNT = /^-?(\d{1,3}(,\d{3})+|\d+)?(\.\d{1,2})?$/;

/** drops "$" and spaces, so "$ 9,627.92" reads as "9,627.92" */
const trim_amount = (raw: string) => raw.replace(/[$\s]/g, "");

/** shared by the withdraw and transfer forms; the output is a plain decimal string */
export const amount = v.lazy((x) => {
  if (!x) return v.pipe(v.string(), v.nonEmpty("Please enter an amount"));
  return v.pipe(
    v.string(),
    v.transform(trim_amount),
    v.check(
      (x) => /\d/.test(x) && AMOUNT.test(x),
      "Enter a number, like 1250.50"
    ),
    v.transform((x) => +x.replace(/,/g, "")),
    v.gtValue(0, "amount must be greater than 0"),
    v.transform((x) => x.toString())
  );
});
