import * as v from "valibot";
import { target } from "#/components/goal-selector";
import { img_output } from "#/components/img-editor";
import { video } from "#/pages/funds/common/videos";
import { richtext_content } from "#/types/components";
import { fund_is_open } from "@/campaign/is-open";
import { increment, MAX_NUM_INCREMENTS } from "@/schemas";

const str = v.pipe(v.string("required"), v.trim());

export const endow_opt = v.object({
  id: v.number(),
  name: str,
  logo: v.optional(v.pipe(str, v.url())),
});

export const MAX_DESCRIPTION_CHAR = 3000;

export const schema = v.object({
  name: v.pipe(str, v.nonEmpty("required")),
  description: richtext_content({
    maxChars: MAX_DESCRIPTION_CHAR,
    required: true,
  }),
  banner: img_output({ required: true }),
  logo: img_output({ required: true }),
  members: v.pipe(
    v.array(endow_opt),
    v.minLength(1, "must contain at least one nonprofit"),
    v.maxLength(10, "cannot contain more than 10 nonprofits")
  ),
  expiration: v.optional(
    v.lazy((val) => {
      if (!val) return v.string();
      return v.pipe(
        str,
        v.transform((val) => new Date(val)),
        v.date("invalid date"),
        v.transform((val) => val.toISOString()),
        // open anywhere on earth, so the submitter's today passes in every zone
        v.check(
          (iso) => fund_is_open({ active: true, expiration: iso }, new Date()),
          "must be today or later"
        )
      );
    })
  ),
  target,
  videos: v.array(video),
  increments: v.pipe(
    v.array(increment),
    v.maxLength(
      MAX_NUM_INCREMENTS,
      ({ requirement }) => `cannot have more than ${requirement} increments`
    )
  ),
  // honeypot field - should always be empty for legitimate users
  website: v.optional(v.pipe(v.string(), v.trim())),
});

export interface FundMember extends v.InferOutput<typeof endow_opt> {}
export interface EndowOption extends FundMember {}
export interface FV extends v.InferOutput<typeof schema> {}
