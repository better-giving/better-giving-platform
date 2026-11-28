import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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

/** the four parts of a partner payment, in the integer minor units the site
 * sent them in */
export interface IPartnerAmount {
  gift: number;
  gift_fee_cover: number;
  contribution: number;
  contribution_fee_cover: number;
}

/** what the site names about a payment that checkout never looks up: its ids
 * are the site's own, so none is read as platform's */
export interface IPartnerAttribution {
  form: { id: string; name: string };
  campaign?: { id: string; name: string };
  program?: { id: string; name: string };
  tribute?: {
    kind: "honor" | "memory";
    honoree: string;
    notify?: { name: string; email: string };
  };
  contribution_offered: boolean;
  deployment_origin: string;
  page_origin?: string;
}

/** the answer to `POST /payments`, kept to replay */
export interface IPartnerPaymentAnswer {
  id: string;
  client: { provider: "stripe" | "paypal" | "chariot"; token: string };
}

/** one payment a partner site asked for. `(npo_id, gift_id)` is the site's
 * idempotency identity: the row is claimed before any session is made, so two
 * requests for one gift can't both create one, and `response` is set once the
 * session exists */
export const partner_payments = pgTable(
  "partner_payments",
  {
    npo_id: integer("npo_id")
      .notNull()
      .references(() => npos.id, { onDelete: "cascade" }),
    gift_id: text("gift_id").notNull(),
    // hash of the method, currency and four parts: what a repeat must match
    fingerprint: text("fingerprint").notNull(),
    method: text("method").notNull(),
    currency: text("currency").notNull(),
    amount: jsonb("amount").$type<IPartnerAmount>().notNull(),
    attribution: jsonb("attribution").$type<IPartnerAttribution>().notNull(),
    // the donation row the session was made for; null until it exists
    donation_id: text("donation_id"),
    response: jsonb("response").$type<IPartnerPaymentAnswer>(),
    created_at: timestamptz_now("created_at"),
    claimed_at: timestamptz_now("claimed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.npo_id, t.gift_id] }),
    uniqueIndex("partner_payments_donation_id_idx").on(t.donation_id),
  ]
);
