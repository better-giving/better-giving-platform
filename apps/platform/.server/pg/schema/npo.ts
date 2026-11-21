import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { IAllocation } from "@/donations";
import type { ISocialMediaUrls } from "@/npo/schema";
import type { PayoutMethod } from "@/payouts";
import type {
  DonateMethodId,
  IIncrement,
  TFrequency,
  UnSdgNum,
} from "@/schemas";
import { user } from "./auth";
import { numeric_as_number, timestamptz, timestamptz_now } from "./columns";

export const npos = pgTable(
  "npos",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    slug: text("slug").unique(),
    keyword: text("keyword").unique(),
    registration_number: text("registration_number").notNull().unique(),
    name: text("name").notNull(),
    endow_designation: text("endow_designation")
      .$type<
        | "Charity"
        | "Religious Organization"
        | "University"
        | "Hospital"
        | "Other"
      >()
      .notNull(),
    overview_v2: text("overview_v2"),
    overview_pt: text("overview_pt").notNull(),
    tagline: text("tagline"),
    image: text("image"),
    logo: text("logo"),
    card_img: text("card_img"),
    hq_country: text("hq_country").notNull(),
    active_in_countries: text("active_in_countries")
      .array()
      .notNull()
      .default([]),
    social_media_urls: jsonb(
      "social_media_urls"
    ).$type<ISocialMediaUrls | null>(),
    url: text("url"),
    sdgs: integer("sdgs").array().notNull().default([]).$type<UnSdgNum[]>(),
    receipt_msg: text("receipt_msg"),
    hide_bg_tip: boolean("hide_bg_tip").notNull().default(false),
    published: boolean("published").notNull().default(false),
    active: boolean("active").notNull().default(true),
    prog_donations_allowed: boolean("prog_donations_allowed")
      .notNull()
      .default(false),
    allocation: jsonb("allocation").$type<IAllocation | null>(),
    donate_methods: text("donate_methods").array().$type<DonateMethodId[]>(),
    donate_frequencies: text("donate_frequencies")
      .array()
      .$type<TFrequency[]>(),
    increments: jsonb("increments").$type<IIncrement[] | null>(),
    fund_opt_in: boolean("fund_opt_in").notNull().default(false),
    target_number: numeric_as_number("target_number", {
      precision: 38,
      scale: 18,
    }),
    target_smart: boolean("target_smart"),
    kyc_donors_only: boolean("kyc_donors_only").notNull().default(false),
    fiscal_sponsored: boolean("fiscal_sponsored").notNull().default(false),
    referral_id: text("referral_id").unique(),
    referrer_user: text("referrer_user").references(() => user.referral_code),
    referrer_npo: text("referrer_npo").references(
      (): AnyPgColumn => npos.referral_id
    ),
    referrer_expiry: timestamptz("referrer_expiry"),
    // unreferenced by any code path today. the ownership rule for serving a
    // stored w-9 eid lives in src/routes/api.anvil-doc.$eid/route.ts.
    w_form: text("w_form"),
    payout_minimum: numeric_as_number("payout_minimum", {
      precision: 38,
      scale: 18,
    }),
    payout_method: text("payout_method")
      .$type<PayoutMethod>()
      .notNull()
      .default("wise"),
    street_address: text("street_address"),
    donor_address_required: boolean("donor_address_required")
      .notNull()
      .default(false),
    liq: numeric_as_number("liq", { precision: 38, scale: 18 })
      .notNull()
      .default(0),
    lock_units: numeric_as_number("lock_units", { precision: 38, scale: 18 })
      .notNull()
      .default(0),
    cash: numeric_as_number("cash", { precision: 38, scale: 18 })
      .notNull()
      .default(0),
    stripe_account_id: text("stripe_account_id").unique(),
    // local mirror of the connected account's readiness, as stripe last reported it
    stripe_charges_enabled: boolean("stripe_charges_enabled")
      .notNull()
      .default(false),
    stripe_payouts_enabled: boolean("stripe_payouts_enabled")
      .notNull()
      .default(false),
    stripe_details_submitted: boolean("stripe_details_submitted")
      .notNull()
      .default(false),
    /** `requirements.currently_due` */
    stripe_requirements_due: text("stripe_requirements_due")
      .array()
      .notNull()
      .default([]),
    stripe_synced_at: timestamptz("stripe_synced_at"),
    /** when the npo last connected `stripe_account_id`, by the db clock; null
     * for an account connected before this was kept */
    stripe_connected_at: timestamptz("stripe_connected_at"),
    /** when the npo disconnected us from its stripe dashboard; `stripe_account_id` stays */
    stripe_deauthorized_at: timestamptz("stripe_deauthorized_at"),
    created_at: timestamptz_now("created_at"),
    updated_at: timestamptz_now("updated_at"),
  },
  (t) => [
    check(
      "endow_designation_check",
      sql`${t.endow_designation} IN ('Charity', 'Religious Organization', 'University', 'Hospital', 'Other')`
    ),
    check(
      "npos_payout_method_check",
      sql`${t.payout_method} IN ('wise', 'manual_wire')`
    ),
    check(
      "target_xor",
      sql`num_nonnulls(${t.target_number}, ${t.target_smart}) <= 1`
    ),
    index("npos_published_name_idx")
      .on(t.name)
      .where(sql`${t.published} = true`),
    check(
      "referrer_xor",
      sql`num_nonnulls(${t.referrer_user}, ${t.referrer_npo}) <= 1`
    ),
    index("npos_referrer_user_idx")
      .on(t.referrer_user)
      .where(sql`${t.referrer_user} IS NOT NULL`),
    index("npos_referrer_npo_idx")
      .on(t.referrer_npo)
      .where(sql`${t.referrer_npo} IS NOT NULL`),
    uniqueIndex("npos_slug_lower_idx")
      .on(sql`LOWER(${t.slug})`)
      .where(sql`${t.slug} IS NOT NULL`),
    uniqueIndex("npos_keyword_lower_idx")
      .on(sql`LOWER(${t.keyword})`)
      .where(sql`${t.keyword} IS NOT NULL`),
    // pg_trgm fuzzy search index on name + tagline + overview + registration_number
    index("npos_search_trgm_idx").using(
      "gin",
      sql`(COALESCE(${t.name},'') || ' ' || COALESCE(${t.tagline},'') || ' ' || COALESCE(${t.overview_v2},'') || ' ' || COALESCE(${t.registration_number},'')) gin_trgm_ops`
    ),
  ]
);

export const npo_media = pgTable(
  "npo_media",
  {
    id: text("id").primaryKey(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    type: text("type").$type<"album" | "article" | "video">().notNull(),
    featured: boolean("featured").notNull().default(false),
    date_created: timestamptz("date_created"),
  },
  (t) => [
    check(
      "npo_media_type_check",
      sql`${t.type} IN ('album', 'article', 'video')`
    ),
    index("npo_media_npo_id_type_idx").on(t.npo_id, t.type, t.featured, t.id),
  ]
);

export const api_keys = pgTable("api_keys", {
  npo_id: integer("npo_id")
    .primaryKey()
    .references(() => npos.id, { onDelete: "cascade" }),
  api_key: text("api_key").notNull().unique(),
  created_at: timestamptz("created_at"),
});

export const webhooks = pgTable(
  "webhooks",
  {
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    url: text("url").notNull(),
  },
  (t) => [primaryKey({ columns: [t.npo_id, t.id] })]
);
