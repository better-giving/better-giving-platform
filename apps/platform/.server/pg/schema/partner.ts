import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { timestamptz, timestamptz_now } from "./columns";
import { npos } from "./npo";

export const partner_tenants = pgTable("partner_tenants", {
  npo_id: integer("npo_id")
    .primaryKey()
    .references(() => npos.id, { onDelete: "cascade" }),
  // the `whsec_…` secret events are signed with, as the aes-256-gcm envelope
  // `api_key_put` builds (queries/api-key.ts); never the plaintext
  event_secret: text("event_secret").notNull(),
  revision: integer("revision").notNull().default(0),
  fingerprint: text("fingerprint"),
  created_at: timestamptz_now("created_at"),
});

export const partner_keys = pgTable(
  "partner_keys",
  {
    id: text("id").primaryKey(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    // sha-256 hex of the full key string; the key is not a column
    key_hash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    last4: text("last4").notNull(),
    // null when provisioning minted the key, or once the minting user is deleted
    minted_by: text("minted_by").references(() => user.id, {
      onDelete: "set null",
    }),
    created_at: timestamptz_now("created_at"),
    last_used_at: timestamptz("last_used_at"),
    revoked_at: timestamptz("revoked_at"),
    revoked_by: text("revoked_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check("partner_keys_key_hash_hex", sql`${t.key_hash} ~ '^[0-9a-f]{64}$'`),
    check("partner_keys_prefix_len", sql`char_length(${t.prefix}) = 8`),
    check("partner_keys_last4_len", sql`char_length(${t.last4}) = 4`),
    index("partner_keys_npo_id_live_idx")
      .on(t.npo_id)
      .where(sql`${t.revoked_at} is null`),
  ]
);
