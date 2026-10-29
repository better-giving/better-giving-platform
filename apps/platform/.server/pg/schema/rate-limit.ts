import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { timestamptz } from "./columns";

/** fixed-window counters shared by every serverless instance. a row is one
 * key's use count in one window; rows past `expires_at` are dead weight that
 * `rate_limit_sweep` deletes, on a sampled take in
 * `src/.server/auth/rate-limit.ts`. */
export const rate_limit_windows = pgTable(
  "rate_limit_windows",
  {
    key: text("key").notNull(),
    window_start: timestamptz("window_start").notNull(),
    count: integer("count").notNull(),
    /** the window's end */
    expires_at: timestamptz("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.window_start] }),
    check("rate_limit_windows_count_nonneg", sql`${t.count} >= 0`),
    check(
      "rate_limit_windows_expires_after_start",
      sql`${t.expires_at} > ${t.window_start}`
    ),
    index("rate_limit_windows_expires_at_idx").on(t.expires_at),
  ]
);
