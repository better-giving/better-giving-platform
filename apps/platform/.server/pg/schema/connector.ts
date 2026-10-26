import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { campaigns } from "./campaign";
import { timestamptz, timestamptz_now } from "./columns";
import { npos } from "./npo";

export const connector_keys = pgTable(
  "connector_keys",
  {
    id: text("id").primaryKey(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    // sha-256 hex of the full `bgc_…` key string; the key is not a column
    key_hash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    last4: text("last4").notNull(),
    allowed_by: text("allowed_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    created_at: timestamptz_now("created_at"),
    last_used_at: timestamptz("last_used_at"),
    revoked_at: timestamptz("revoked_at"),
    revoked_by: text("revoked_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check("connector_keys_key_hash_hex", sql`${t.key_hash} ~ '^[0-9a-f]{64}$'`),
    check("connector_keys_prefix_len", sql`char_length(${t.prefix}) = 8`),
    check("connector_keys_last4_len", sql`char_length(${t.last4}) = 4`),
    index("connector_keys_npo_id_live_idx")
      .on(t.npo_id)
      .where(sql`${t.revoked_at} is null`),
  ]
);

export const connector_codes = pgTable(
  "connector_codes",
  {
    // sha-256 hex of the code string the client posts; the code is not a column
    code_hash: text("code_hash").primaryKey(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    allowed_by: text("allowed_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    iss: text("iss").notNull(),
    expires_at: timestamptz("expires_at").notNull(),
    used_at: timestamptz("used_at"),
  },
  (t) => [
    check(
      "connector_codes_code_hash_hex",
      sql`${t.code_hash} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

export const connector_idempotency = pgTable(
  "connector_idempotency",
  {
    key_id: text("key_id")
      .notNull()
      .references(() => connector_keys.id, { onDelete: "cascade" }),
    idem_key: text("idem_key").notNull(),
    request_hash: text("request_hash").notNull(),
    status: text("status").$type<"pending" | "stored">().notNull(),
    response_status: integer("response_status"),
    response_body: jsonb("response_body"),
    created_at: timestamptz_now("created_at"),
    // the id a create under this record mints; a reclaim keeps it, a replaced record gets a new one
    resource_id: text("resource_id")
      .notNull()
      .default(sql`gen_random_uuid()::text`),
  },
  (t) => [
    primaryKey({ columns: [t.key_id, t.idem_key] }),
    check(
      "connector_idempotency_status_check",
      sql`${t.status} in ('pending', 'stored')`
    ),
    check(
      "connector_idempotency_response_check",
      sql`(
        ${t.status} = 'pending'
        and ${t.response_status} is null
        and ${t.response_body} is null
      ) or (
        ${t.status} = 'stored'
        and ${t.response_status} is not null
        and ${t.response_body} is not null
      )`
    ),
  ]
);

// single-use upload link that sets one campaign's banner
export const connector_photo_links = pgTable(
  "connector_photo_links",
  {
    id: text("id").primaryKey(),
    // sha-256 hex of the raw token in the link url; the token is not a column
    token_hash: text("token_hash").notNull().unique(),
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    campaign_id: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    created_at: timestamptz_now("created_at"),
    expires_at: timestamptz("expires_at").notNull(),
    used_at: timestamptz("used_at"),
    // the photo the claim stored, kept once its banner write went through: a
    // spent link shows it until a day past expires_at, and update_campaign_blocks
    // takes it as a hero for as long as the row stays, which the sweep never deletes
    saved_url: text("saved_url"),
    saved_pathname: text("saved_pathname"),
  },
  (t) => [
    check(
      "connector_photo_links_token_hash_hex",
      sql`${t.token_hash} ~ '^[0-9a-f]{64}$'`
    ),
    // the sweep's predicate exactly: saved rows are never swept, so they stay out
    index("connector_photo_links_unsaved_expires_at_idx")
      .on(t.expires_at)
      .where(sql`${t.saved_pathname} is null`),
    // also the lookup a campaign's delete cascades through
    index("connector_photo_links_campaign_saved_idx").on(
      t.campaign_id,
      t.saved_pathname
    ),
  ]
);
