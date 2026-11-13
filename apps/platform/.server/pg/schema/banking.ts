import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz, timestamptz_now } from "./columns";
import { npos } from "./npo";

export const banking_apps = pgTable(
  "banking_apps",
  {
    id: text("id").primaryKey(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    status: text("status")
      .notNull()
      .default("under-review")
      .$type<"default" | "under-review" | "approved" | "rejected">(),
    bank_summary: text("bank_summary").notNull().default(""),
    bank_statement_url: text("bank_statement_url").notNull().default(""),
    rejection_reason: text("rejection_reason").notNull().default(""),
    date_created: timestamptz("date_created").notNull().default(sql`now()`),
    // when the row last moved state — submission, verdict, or promotion to the
    // npo's primary account. the admin list orders on this, not date_created.
    updated_at: timestamptz_now("updated_at"),
  },
  (t) => [
    check(
      "banking_apps_status_check",
      sql`${t.status} IN ('default', 'under-review', 'approved', 'rejected')`
    ),
    index("banking_apps_npo_id_status_idx").on(
      t.npo_id,
      t.status,
      t.date_created
    ),
    index("banking_apps_status_date_idx").on(t.status, t.date_created),
    index("banking_apps_status_updated_idx").on(t.status, t.updated_at),
    index("banking_apps_under_review_idx")
      .on(t.date_created)
      .where(sql`${t.status} = 'under-review'`),
  ]
);
