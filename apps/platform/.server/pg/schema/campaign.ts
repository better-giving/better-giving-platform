import { sql } from "drizzle-orm";
import {
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
import type { TCampaignStatus, TCampaignType } from "@/campaign";
import type { DonateMethodId, IIncrement, TFrequency } from "@/schemas";
import { user } from "./auth";
import { numeric_as_number, timestamptz, timestamptz_now } from "./columns";
import { funds } from "./fund";
import { npos } from "./npo";
import { programs } from "./program";

export type { TCampaignStatus, TCampaignType };

export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    owner_npo_id: integer("owner_npo_id").references(() => npos.id),
    owner_user_id: text("owner_user_id").references(() => user.id),
    creator_id: text("creator_id")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    campaign_type: text("campaign_type").$type<TCampaignType | null>(),
    description_pt: text("description_pt").notNull().default("[]"),
    description_v2: text("description_v2"),
    banner: text("banner"),
    logo: text("logo"),
    videos: text("videos").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").$type<TCampaignStatus>().notNull().default("draft"),
    published_at: timestamptz("published_at"),
    ends_at: timestamptz("ends_at"),
    spam_score: numeric_as_number("spam_score", { precision: 5, scale: 2 }),
    donate_methods: text("donate_methods").array().$type<DonateMethodId[]>(),
    donate_frequencies: text("donate_frequencies")
      .array()
      .$type<TFrequency[]>(),
    increments: jsonb("increments").$type<IIncrement[] | null>(),
    target_number: numeric_as_number("target_number", {
      precision: 38,
      scale: 18,
    }),
    target_smart: boolean("target_smart"),
    hide_bg_tip: boolean("hide_bg_tip").notNull().default(false),
    program_id: text("program_id").references(() => programs.id, {
      onDelete: "set null",
    }),
    program_name: text("program_name"),
    // the org fund this campaign was folded from, if any; its historic gifts
    // (settled dists carrying `fund_id`) still count toward the campaign total
    legacy_fund_id: text("legacy_fund_id")
      .unique()
      .references(() => funds.id),
    created_at: timestamptz_now("created_at"),
    updated_at: timestamptz_now("updated_at"),
  },
  (t) => [
    check(
      "owner_xor",
      sql`num_nonnulls(${t.owner_npo_id}, ${t.owner_user_id}) = 1`
    ),
    check(
      "campaigns_type_check",
      sql`${t.campaign_type} IS NULL OR ${t.campaign_type} IN ('year_end','emergency','building','event','tribute','monthly','program','other')`
    ),
    check(
      "campaigns_status_check",
      sql`${t.status} IN ('draft','live','ended')`
    ),
    check(
      "target_xor",
      sql`num_nonnulls(${t.target_number}, ${t.target_smart}) <= 1`
    ),
    uniqueIndex("campaigns_owner_npo_slug_idx")
      .on(t.owner_npo_id, sql`LOWER(${t.slug})`)
      .where(sql`${t.owner_npo_id} IS NOT NULL`),
    uniqueIndex("campaigns_owner_user_slug_idx")
      .on(t.owner_user_id, sql`LOWER(${t.slug})`)
      .where(sql`${t.owner_user_id} IS NOT NULL`),
    index("campaigns_owner_npo_id_idx").on(t.owner_npo_id),
    index("campaigns_creator_id_idx").on(t.creator_id),
  ]
);

export const campaign_members = pgTable(
  "campaign_members",
  {
    campaign_id: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.campaign_id, t.npo_id] }),
    index("campaign_members_npo_id_idx").on(t.npo_id),
  ]
);
