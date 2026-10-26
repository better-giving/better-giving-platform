import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import type { DonateMethodId, IIncrement, TFrequency } from "@/schemas";
import { user } from "./auth";
import { numeric_as_number, timestamptz } from "./columns";
import { funds } from "./fund";
import { npos } from "./npo";

export const forms = pgTable(
  "forms",
  {
    id: text("id").primaryKey(),
    owner_npo_id: integer("owner_npo_id").references(() => npos.id),
    owner_user_id: text("owner_user_id").references(() => user.id),
    status: text("status"),
    tag: text("tag"),
    name: text("name").notNull(),
    recipient_npo_id: integer("recipient_npo_id").references(() => npos.id),
    recipient_fund_id: text("recipient_fund_id").references(() => funds.id),
    date_created: timestamptz("date_created"),
    // the last edit; null on a form not edited since it was made, or since this column was added
    updated_at: timestamptz("updated_at"),
    ltd: numeric_as_number("ltd", { precision: 38, scale: 18 }).default(0),
    ltd_count: integer("ltd_count").default(0),
    target_number: numeric_as_number("target_number", {
      precision: 38,
      scale: 18,
    }),
    target_smart: boolean("target_smart"),
    accent_primary: text("accent_primary"),
    accent_secondary: text("accent_secondary"),
    success_redirect: text("success_redirect"),
    donate_methods: text("donate_methods").array().$type<DonateMethodId[]>(),
    freq_opts: text("freq_opts").array().$type<TFrequency[]>(),
    increments: jsonb("increments").$type<IIncrement[] | null>(),
    program_id: text("program_id"),
    program_name: text("program_name"),
    defaults: jsonb("defaults").$type<Record<string, unknown> | null>(),
  },
  (t) => [
    check("forms_status_check", sql`${t.status} IN ('active', 'inactive')`),
    check(
      "recipient_xor",
      sql`num_nonnulls(${t.recipient_npo_id}, ${t.recipient_fund_id}) <= 1`
    ),
    check(
      "owner_xor",
      sql`num_nonnulls(${t.owner_npo_id}, ${t.owner_user_id}) = 1`
    ),
    check(
      "target_xor",
      sql`num_nonnulls(${t.target_number}, ${t.target_smart}) <= 1`
    ),
    // covers: all forms by npo (no status filter) ordered by date
    index("forms_owner_npo_date_idx")
      .on(t.owner_npo_id, t.date_created)
      .where(sql`${t.owner_npo_id} IS NOT NULL`),
    // covers: forms by npo filtered by status, ordered by date
    index("forms_owner_npo_status_date_idx")
      .on(t.owner_npo_id, t.status, t.date_created)
      .where(sql`${t.owner_npo_id} IS NOT NULL`),
    // covers: all forms by user ordered by date
    index("forms_owner_email_date_idx")
      .on(t.owner_user_id, t.date_created)
      .where(sql`${t.owner_user_id} IS NOT NULL`),
    // covers: forms by user filtered by status, ordered by date
    index("forms_owner_user_status_date_idx")
      .on(t.owner_user_id, t.status, t.date_created)
      .where(sql`${t.owner_user_id} IS NOT NULL`),
  ]
);
