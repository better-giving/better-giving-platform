import * as v from "valibot";
import { amount_num, decimal_str } from "@/schemas/amount";
export const target = v.variant("type", [
  v.object({
    type: v.literal("fixed"),
    value: v.pipe(
      v.string("required"),
      v.nonEmpty("required"),
      // any decimals, as the server's `target`: a stored goal from before the
      // 2-decimal mask must not block a save of the fields beside it
      amount_num(Number.POSITIVE_INFINITY),
      // "0" is how the server stores no goal
      v.gtValue(0, "must be greater than 0"),
      /** so that the inferred type is string */
      v.transform(decimal_str)
    ),
  }),
  v.object({ type: v.literal("smart"), value: v.optional(v.string()) }),
  v.object({ type: v.literal("none"), value: v.optional(v.string()) }),
]);

export type Target = v.InferOutput<typeof target>;
export type TargetType = Target["type"];
