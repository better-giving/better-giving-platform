import * as v from "valibot";
import { target } from "#/components/goal-selector";
import { img_output } from "#/components/img-editor";
import { video } from "#/pages/funds/common/videos";
import { richtext_content } from "#/types/components";
import { slug } from "@/npo/schema";
import { increment, MAX_NUM_INCREMENTS } from "@/schemas";

const str = v.pipe(v.string(), v.trim());

export const MAX_DESCRIPTION_CHARS = 3000;
export const schema = v.object({
  name: v.pipe(str, v.nonEmpty("required")),
  description: richtext_content({
    maxChars: MAX_DESCRIPTION_CHARS,
    required: true,
  }),
  slug,
  target,
  videos: v.array(video),
  banner: img_output({ required: true }),
  logo: img_output({ required: true }),
  increments: v.pipe(
    v.array(increment),
    v.maxLength(
      MAX_NUM_INCREMENTS,
      ({ requirement }) => `cannot have more than ${requirement} increments`
    )
  ),
});

export type FV = v.InferOutput<typeof schema>;
