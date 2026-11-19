import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

/** a document url a record held before `jobs/migrate-private-docs.ts` moved
 * the file, and the copy it moved to. `/api/docs?ref=<old_url>` links already
 * handed out keep resolving to whoever holds the copy. an old url can have more
 * than one copy when a rerun copied it again, so the pair is the key. */
export const doc_url_aliases = pgTable(
  "doc_url_aliases",
  {
    old_url: text("old_url").notNull(),
    new_url: text("new_url").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.old_url, t.new_url] }),
    check("doc_url_aliases_moved", sql`${t.old_url} <> ${t.new_url}`),
  ]
);
