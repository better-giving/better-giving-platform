import * as v from "valibot";
import { amount_num } from "@/schemas/amount";

/** shared by the withdraw and transfer forms; the output is a plain decimal string */
export const amount = v.lazy((x) => {
  if (!x) return v.pipe(v.string(), v.nonEmpty("Please enter an amount"));
  return v.pipe(
    amount_num(),
    v.gtValue(0, "amount must be greater than 0"),
    v.transform((x) => x.toString())
  );
});
