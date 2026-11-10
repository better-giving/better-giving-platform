import * as v from "valibot";
import { to_text } from "#/components/rich-text/helpers";
import { CAMPAIGN_TYPES } from "@/campaign";
import {
  $,
  donate_method_id,
  frequency,
  increment,
  MAX_NUM_INCREMENTS,
  segment_shape,
  target,
} from "@/schemas";

const https = v.pipe(v.string(), v.trim(), v.url("Enter a valid https link."));

const link = "Enter the end of the link. Use letters, numbers, and - . _ ~.";

/** the story's cap, for the form's counter and for the save */
export const STORY_MAX_CHARS = 8000;

export const campaign_body = v.object({
  name: v.pipe($, v.nonEmpty("Enter a name.")),
  slug: v.pipe(v.string(), v.trim(), v.nonEmpty(link), segment_shape),
  campaign_type: v.optional(v.picklist(CAMPAIGN_TYPES)),
  description_pt: v.pipe(
    $,
    v.nonEmpty("Enter a story."),
    // the form checks the same count; a direct request must not skip it
    v.check(
      (x) => to_text(x).length <= STORY_MAX_CHARS,
      `max length is ${STORY_MAX_CHARS} chars`
    )
  ),
  banner: v.optional(v.union([v.literal(""), https])),
  logo: v.optional(v.union([v.literal(""), https])),
  videos: v.optional(v.array(https)),
  ends_at: v.optional(v.union([v.literal(""), v.pipe($, v.isoTimestamp())])),
  target,
  increments: v.optional(
    v.pipe(v.array(increment), v.maxLength(MAX_NUM_INCREMENTS))
  ),
  donate_methods: v.pipe(v.array(donate_method_id), v.minLength(1)),
  donate_frequencies: v.pipe(
    v.array(frequency),
    v.minLength(1),
    v.check((xs) => xs.includes("one-time"), "one-time must stay available")
  ),
  hide_bg_tip: v.optional(v.boolean()),
  program_id: v.optional(v.union([v.literal(""), v.pipe($, v.uuid())])),
  op: v.optional(v.picklist(["save", "publish", "end", "delete"])),
});

export type ICampaignBody = v.InferOutput<typeof campaign_body>;
