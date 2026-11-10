import * as v from "valibot";
import { target } from "#/components/goal-selector";
import { img_output } from "#/components/img-editor";
import { video } from "#/pages/funds/common/videos";
import { donate_method, richtext_max } from "#/types/components";
import { CAMPAIGN_TYPES } from "@/campaign";
import {
  donate_freq_opts_bool,
  increment,
  MAX_NUM_INCREMENTS,
  segment_shape,
} from "@/schemas";

const day = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, "invalid date"));

const link = "Enter the end of the link. Use letters, numbers, and - . _ ~.";
const story = "Enter a story.";

export const form_schema = v.object({
  name: v.pipe(v.string(), v.trim(), v.nonEmpty("Enter a name.")),
  slug: v.pipe(v.string(), v.trim(), v.nonEmpty(link), segment_shape),
  campaign_type: v.optional(
    v.union([v.literal(""), v.picklist(CAMPAIGN_TYPES)])
  ),
  description: v.pipe(
    v.object({
      value: v.pipe(v.string(story), v.nonEmpty(story)),
      length: v.optional(v.number()),
    }),
    richtext_max(8000)
  ),
  banner: img_output(),
  logo: img_output(),
  videos: v.array(video),
  ends_at: v.optional(v.union([v.literal(""), day])),
  target,
  increments: v.pipe(v.array(increment), v.maxLength(MAX_NUM_INCREMENTS)),
  donate_methods: v.pipe(
    v.array(donate_method),
    v.filterItems((m) => !m.disabled),
    v.minLength(1, "at least one payment option should be active")
  ),
  freqs: donate_freq_opts_bool,
  hide_bg_tip: v.boolean(),
  program_id: v.optional(
    v.union([v.literal(""), v.pipe(v.string(), v.uuid())])
  ),
});

export type FV = v.InferInput<typeof form_schema>;
