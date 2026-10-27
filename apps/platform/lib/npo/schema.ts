import {
  $,
  $int_gte1,
  $req,
  donate_freq_opts,
  donate_method_id,
  https_url,
  increment,
  int_gte1,
  MAX_NUM_INCREMENTS,
  org_designation,
  org_slug,
  slug,
  target,
  unsdg_num,
} from "../schemas";

export {
  $,
  $int_gte1,
  $req,
  donate_method_id,
  https_url,
  org_designation,
  org_slug,
  slug,
} from "../schemas";

import * as v from "valibot";
import { allocation } from "../donations/schema";

export const min_payout_amount = 50;

/** used for text to give */
const keyword = v.pipe(
  $,
  v.nonEmpty("required"),
  v.toLowerCase(),
  v.maxLength(10, ({ requirement: r }) => `max ${r} characters`),
  v.regex(/^[a-z]+$/, "must be letters only")
);

const csv = v.lazy((x) => {
  if (!x) return $;
  return v.pipe($, v.regex(/^[^,]+(?:,[^,]+)*$/, "invalid csv"));
});
const csv_strs = v.pipe(
  csv,
  v.transform((x) => x.split(",")),
  v.filterItems((x) => x.length > 0)
);

export const reg_number = v.pipe(
  $,
  v.nonEmpty("required"),
  v.regex(/^[a-zA-Z0-9]+$/, "must only contain letters and numbers")
);
const _url = v.pipe($, v.url());

export const social_media_urls = v.object({
  facebook: v.optional(https_url({})),
  twitter: v.optional(https_url({})),
  linkedin: v.optional(https_url({})),
  discord: v.optional(https_url({})),
  instagram: v.optional(https_url({})),
  youtube: v.optional(https_url({})),
  tiktok: v.optional(https_url({})),
});
export interface ISocialMediaUrls
  extends v.InferOutput<typeof social_media_urls> {}

export const MAX_RECEIPT_MSG_CHAR = 500;

const tagline_max_chars = 140;

const npo = v.object({
  id: int_gte1,
  slug: v.optional(slug),
  keyword: v.optional(keyword),
  registration_number: reg_number,
  name: $req,
  endow_designation: org_designation,
  overview_v2: v.optional($),
  overview_pt: $,
  tagline: v.optional(v.pipe($, v.maxLength(tagline_max_chars))),
  image: v.optional(_url),
  logo: v.optional(_url),
  card_img: v.optional(_url),
  hq_country: $req,
  active_in_countries: v.array($),
  street_address: v.optional($),
  social_media_urls,
  /** website */
  url: v.optional(https_url({})),
  sdgs: v.array(unsdg_num),
  receipt_msg: v.optional(v.pipe($, v.maxLength(MAX_RECEIPT_MSG_CHAR))),
  //can be optional, default false and need not be explicit
  hide_bg_tip: v.optional(v.boolean()),
  published: v.optional(v.boolean()),
  active: v.optional(v.boolean()),
  /** allowed by default */
  prog_donations_allowed: v.optional(v.boolean()),

  allocation: v.optional(allocation),
  donate_methods: v.optional(v.array(donate_method_id)),
  donate_frequencies: v.optional(donate_freq_opts),
  increments: v.optional(
    v.pipe(
      v.array(increment),
      v.maxLength(
        MAX_NUM_INCREMENTS,
        ({ requirement }) => `cannot have more than ${requirement} increments`
      )
    )
  ),
  fund_opt_in: v.optional(v.boolean()),
  target: v.optional(target),
  kyc_donors_only: v.boolean(),
  fiscal_sponsored: v.boolean(),
  referral_id: v.optional($req),
  referrer_user: v.optional($req),
  referrer_npo: v.optional($req),
  referrer_expiry: v.optional(v.pipe($, v.isoTimestamp())),
  w_form: v.optional(v.string()),
  payout_minimum: v.optional(v.pipe(v.number(), v.minValue(min_payout_amount))),
  donor_address_required: v.optional(v.boolean()),
  liq: v.optional(v.pipe(v.number(), v.minValue(0))),
  lock_units: v.optional(v.pipe(v.number(), v.minValue(0))),
  cash: v.optional(v.pipe(v.number(), v.minValue(0))),
});

const npo_update_base = v.partial(
  v.omit(npo, [
    "id",
    "kyc_donors_only",
    "fiscal_sponsored",
    "active",
    "liq",
    "lock_units",
    "cash",
  ])
);
// assignment uses the reserved-segment check. the shared `slug` stays the
// shape fund edits already accepted.
export const npo_update = v.object({
  ...npo_update_base.entries,
  slug: v.optional(org_slug),
});

const npo_fields = v.keyof(npo);
export interface INpo extends v.InferOutput<typeof npo> {}
export interface INpoUpdate extends v.InferOutput<typeof npo_update> {}
const npo_search = v.object({
  fields: v.optional(v.pipe(csv_strs, v.array(npo_fields))),
});

export interface INposSearch extends v.InferInput<typeof npo_search> {}

const amnt = v.pipe(v.number(), v.minValue(0));
export const program_id = v.pipe($, v.uuid());
export const milestone_id = v.pipe($, v.uuid());

const milestone_new = v.object({
  date: v.pipe($, v.isoTimestamp()),
  title: $,
  description_pt: $,
  media: v.optional(_url),
});

export const milestone_update = v.partial(milestone_new, ["date"]);
export interface IMilestoneUpdate
  extends v.InferOutput<typeof milestone_update> {}

export interface IMilestoneNew extends v.InferOutput<typeof milestone_new> {}
const milestone = v.object({
  ...milestone_new.entries,
  id: milestone_id,
});
export interface IMilestone extends v.InferOutput<typeof milestone> {}

const program_new = v.object({
  title: $,
  description_pt: $,
  banner: v.optional(_url),
  /** null unsets target */
  target_raise: v.nullish(amnt),
  milestones: v.pipe(v.array(milestone_new), v.maxLength(24)),
});

const program = v.object({
  ...v.omit(program_new, ["milestones"]).entries,
  /** in USD */
  total_donations: v.optional(v.number()),
  id: program_id,
  created_at: v.optional(v.string()),
});

export const program_update = v.partial(v.omit(program_new, ["milestones"]));

export interface IProgramNew extends v.InferOutput<typeof program_new> {}
export interface IProgramDb extends v.InferOutput<typeof program> {}
export interface IProgram extends v.InferOutput<typeof program> {
  milestones: IMilestone[];
}
export interface IProgramUpdate extends v.InferOutput<typeof program_update> {}

const media_url = v.pipe($, v.url());
export const media_id = $req;
const media_types = ["album", "article", "video"] as const;
export const media_type = v.picklist(media_types);
export type TMediaType = v.InferOutput<typeof media_type>;

const media_update = v.object({
  url: v.optional(media_url),
  featured: v.optional(v.boolean()),
});
export interface IMediaUpdate extends v.InferOutput<typeof media_update> {}

const media_search = v.object({
  type: v.optional(media_type),
  next: v.optional($),
  featured: v.optional(v.pipe($, v.parseBoolean())),
  limit: v.optional($int_gte1),
});
export interface IMediaSearchObj extends v.InferOutput<typeof media_search> {}

const bool_csv = v.pipe(
  csv_strs,
  v.mapItems((x) => x === "true"),
  v.array(v.boolean())
);

const npo_item_field = v.picklist([
  "id",
  "name",
  "logo",
  "card_img",
  "tagline",
  "hq_country",
  "sdgs",
  "active_in_countries",
  "endow_designation",
  "registration_number",
  "kyc_donors_only",
  "published",
  "active",
  "fund_opt_in",
  "target",
  "contributions_total",
  "contributions_count",
]);

export const npos_search = v.object({
  query: v.optional($),
  page: v.optional($int_gte1),
  endow_designation: v.optional(v.pipe(csv_strs, v.array(org_designation))),
  sdgs: v.optional(
    v.pipe(
      csv_strs,
      v.mapItems((x) => +x),
      v.array(unsdg_num)
    )
  ),
  kyc_only: v.optional(bool_csv),
  fund_opt_in: v.optional(bool_csv),
  published: v.optional(bool_csv),
  countries: v.optional(v.pipe(csv_strs, v.array($))),
  fields: v.optional(v.pipe(csv_strs, v.array(npo_item_field))),
});

export interface INposSearch extends v.InferInput<typeof npos_search> {}
export interface INposSearchObj extends v.InferOutput<typeof npos_search> {}
