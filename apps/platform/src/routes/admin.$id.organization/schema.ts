import type { ImageMIMEType } from "@better-giving/ui";
import * as v from "valibot";
import { type ImgSpec, img_output } from "#/components/img-editor";
import { richtext_content } from "#/types/components";
import {
  $,
  $req,
  https_url,
  org_designation,
  org_slug,
  reg_number,
  social_media_urls,
} from "@/npo/schema";

export const VALID_MIME_TYPES: ImageMIMEType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];

export const MAX_CHARS = 4000;

export const logoSpec: ImgSpec = {
  type: VALID_MIME_TYPES,
  aspect: [1, 1],
  max_size: 4e6,
};
export const bannerSpec: ImgSpec = {
  type: VALID_MIME_TYPES,
  aspect: [4, 1],
  max_size: 4e6,
};

/** letters and digits from the legal name, for the empty slug's placeholder */
export function suggest_slug(name: string): string {
  const chars = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 30);
  return chars || "myNonprofit";
}

export const schema = v.object({
  logo: img_output({ required: true }),
  name: $req,
  registration_number: reg_number,
  endow_designation: org_designation,
  hq_country: $req,
  slug: org_slug,
  url: v.optional(https_url()),
  street_address: v.optional($),
  active_in_countries: v.array($),
});

export type FV = v.InferInput<typeof schema>;

/** the controls, in the order the form renders them — `trigger`'s
 * focus-on-error walks this order, not the order they register in. the legal
 * name is text, not a control */
export const fields = [
  "logo",
  "registration_number",
  "endow_designation",
  "hq_country",
  "slug",
  "url",
  "street_address",
  "active_in_countries",
] as const satisfies (keyof FV)[];

/** the Better Giving Page section, the socials and the publish switch */
export const profile_schema = v.object({
  overview: richtext_content({ maxChars: MAX_CHARS, required: true }),
  tagline: v.pipe($req, v.maxLength(140, "max length is 140 chars")),
  image: img_output({ required: true }),
  social_media_urls: social_media_urls,
  published: v.boolean(),
});

export type ProfileFV = v.InferInput<typeof profile_schema>;
