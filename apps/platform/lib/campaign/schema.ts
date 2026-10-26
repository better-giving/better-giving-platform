import {
  array,
  boolean,
  type InferOutput,
  integer,
  isoTimestamp,
  maxLength,
  minValue,
  nonEmpty,
  number,
  object,
  optional,
  partial,
  pick,
  picklist,
  pipe,
  url,
  uuid,
} from "valibot";
import {
  $,
  $int_gte1,
  increment,
  MAX_NUM_INCREMENTS,
  slug,
  target,
} from "../schemas";

export type { DonateMethodId } from "../schemas";
export type { Environment } from "../types/list";

export const fund_id = pipe($, uuid());
/**
 * when campaign is created in the context of an NPO, all members of that NPO can edit the campaign
 * null - none
 */
const npo_owner = optional(pipe(number(), integer(), minValue(1)));

const fund_new = object({
  name: pipe($, nonEmpty("required")),
  description_pt: pipe($, nonEmpty("required")),
  banner: pipe($, url()),
  logo: pipe($, url()),
  /** endowment ids */
  members: pipe(
    array(pipe(number(), integer(), minValue(1))),
    nonEmpty(),
    maxLength(10)
  ),
  published: boolean(),
  expiration: optional(pipe($, isoTimestamp("invalid date"))),
  /** `"0"` - none, {"number"} = fixed */
  target: target,
  videos: array(pipe($, url())),
  increments: optional(
    pipe(
      array(increment),
      maxLength(
        MAX_NUM_INCREMENTS,
        ({ requirement }) => `cannot have more than ${requirement} increments`
      )
    )
  ),
  npo_owner,
  slug: optional(slug),
});

export const fund_update = partial(
  pick(fund_new, [
    "name",
    "description_pt",
    "banner",
    "logo",
    "published",
    "target",
    "videos",
    "slug",
    "increments",
  ])
);

export const funds_search = object({
  /** search text */
  query: optional($),
  /** input str: from url */
  page: optional($int_gte1),
});

const funds_npo_memberof_search = object({
  /** when true, only return published + active + non-expired funds */
  published: optional(boolean()),
  /** "ours" = npo is owner, "others" = npo is member but not owner */
  creator: optional(picklist(["ours", "others"])),
  /** when true, drop funds already folded into a campaign (a campaign whose
   * `legacy_fund_id` is the fund's id); the folded ones live on as campaigns */
  exclude_folded: optional(boolean()),
});

export interface IFundNew extends InferOutput<typeof fund_new> {}
export interface IFundUpdate extends InferOutput<typeof fund_update> {}
export interface IFundsSearchObj extends InferOutput<typeof funds_search> {}
export interface IFundsNpoMemberOfSearchObj
  extends InferOutput<typeof funds_npo_memberof_search> {}

export const MAX_EXPIRATION_ISO = "9999-12-31T23:59:59Z";
