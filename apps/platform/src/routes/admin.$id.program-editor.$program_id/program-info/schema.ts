import * as v from "valibot";
import { img_output } from "#/components/img-editor";
import { $req } from "@/schemas";
import { amount_num, decimal_str } from "@/schemas/amount";
import { MAX_CHARS } from "../common";

export const schema = v.object({
  title: $req,
  description: v.object({
    value: $req,
    length: v.optional(
      v.pipe(
        v.number(),
        v.maxValue(MAX_CHARS, (x) => `max ${x.requirement} characters`)
      )
    ),
  }),
  image: img_output(),
  target_raise: v.lazy((val) => {
    if (val === "") return v.string();
    return v.pipe(
      // any decimals: a stored target from before the 2-decimal mask must not
      // block a save of the fields beside it
      amount_num(Number.POSITIVE_INFINITY),
      v.check((x) => x > 0, "must be greater than 0"),
      v.transform(decimal_str)
    );
  }),
});

export interface FV extends v.InferOutput<typeof schema> {}
