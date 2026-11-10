import * as v from "valibot";

const PLAIN_DECIMAL = /^-?(\d+(\.\d{1,2})?|\.\d{1,2})$/;

/** drops thousands separators, "$" and spaces, so "$ 9,627.92" reads as "9627.92" */
export const clean_amount = (raw: string) => raw.replace(/[,$\s]/g, "");

/** shared by the withdraw and transfer forms; the output is a plain decimal string */
export const amount = v.lazy((x) => {
  if (!x) return v.pipe(v.string(), v.nonEmpty("Please enter an amount"));
  return v.pipe(
    v.string(),
    v.transform(clean_amount),
    v.regex(PLAIN_DECIMAL, "Enter a number, like 1250.50"),
    v.transform((x) => +x),
    v.gtValue(0, "amount must be greater than 0"),
    v.transform((x) => x.toString())
  );
});
