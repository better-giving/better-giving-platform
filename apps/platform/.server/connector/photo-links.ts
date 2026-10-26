import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, not, sql } from "drizzle-orm";
import type { DbOrTx } from "../pg/queries/helpers";
import { campaigns } from "../pg/schema/campaign";
import { connector_photo_links } from "../pg/schema/connector";
import { ended_sql } from "./reads";

export const PHOTO_LINK_TTL_MS = 15 * 60 * 1000;

const sha256_hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** issues a link bound to `campaign_id`; null when that campaign isn't
 * `npo_id`'s or has ended */
export async function issue_photo_link(
  db: DbOrTx,
  npo_id: number,
  campaign_id: string,
  now = new Date()
): Promise<{ token: string; expires_at: string } | null> {
  const token = randomBytes(32).toString("base64url");
  const expires_at = new Date(now.getTime() + PHOTO_LINK_TTL_MS).toISOString();
  // insert … select: the ownership check and the write are one statement
  const rows = await db
    .insert(connector_photo_links)
    .select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as("id"),
          token_hash: sql<string>`${sha256_hex(token)}`.as("token_hash"),
          npo_id: campaigns.owner_npo_id,
          campaign_id: campaigns.id,
          created_at: sql<string>`${now.toISOString()}::timestamptz`.as(
            "created_at"
          ),
          expires_at: sql<string>`${expires_at}::timestamptz`.as("expires_at"),
          used_at: sql<null>`null::timestamptz`.as("used_at"),
        })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.id, campaign_id),
            eq(campaigns.owner_npo_id, npo_id),
            not(ended_sql(now))
          )
        )
    )
    .returning({ id: connector_photo_links.id });
  return rows.length === 1 ? { token, expires_at } : null;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const live_link = (token: string, now: Date) =>
  and(
    eq(connector_photo_links.token_hash, sha256_hex(token)),
    isNull(connector_photo_links.used_at),
    gt(connector_photo_links.expires_at, now.toISOString())
  );

const link_shape = {
  id: connector_photo_links.id,
  npo_id: connector_photo_links.npo_id,
  campaign_id: connector_photo_links.campaign_id,
};

export async function peek_photo_link(
  db: DbOrTx,
  token: string,
  now = new Date()
): Promise<{ id: string; npo_id: number; campaign_id: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select(link_shape)
    .from(connector_photo_links)
    .where(live_link(token, now));
  return row ?? null;
}

/** the single atomic claim: of concurrent calls on one token, one gets the row */
export async function consume_photo_link(
  db: DbOrTx,
  token: string,
  now = new Date()
): Promise<{
  id: string;
  npo_id: number;
  campaign_id: string;
  used_at: string;
} | null> {
  if (!TOKEN_RE.test(token)) return null;
  const used_at = now.toISOString();
  const [row] = await db
    .update(connector_photo_links)
    .set({ used_at })
    .where(live_link(token, now))
    .returning(link_shape);
  return row ? { ...row, used_at } : null;
}

/** reopens a claim whose upload failed; a link claimed at another `used_at` stays shut */
export async function release_photo_link(
  db: DbOrTx,
  id: string,
  used_at: string
): Promise<boolean> {
  const rows = await db
    .update(connector_photo_links)
    .set({ used_at: null })
    .where(
      and(
        eq(connector_photo_links.id, id),
        eq(connector_photo_links.used_at, used_at)
      )
    )
    .returning({ id: connector_photo_links.id });
  return rows.length === 1;
}
