import { and, count, desc, eq, exists, inArray, not, sql } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import type { IBappsOpts } from "@/banking";
import type { TStatus } from "@/banking/schema";
import { db } from "../db";
import { banking_apps } from "../schema/banking";
import type { DbOrTx, IPage } from "./helpers";
import { decode_date_cursor, encode_date_cursor } from "./helpers";

type Bapp = typeof banking_apps.$inferSelect;
type BappInsert = typeof banking_apps.$inferInsert;

export async function bapp_get(id: string) {
  const [row] = await db
    .select()
    .from(banking_apps)
    .where(eq(banking_apps.id, id));
  return row;
}

export async function npo_bapps(
  npo_id: number,
  opts?: { limit?: number; next?: string }
) {
  const { limit = 10, next } = opts || {};
  const cursor = decode_bapp_cursor(next);

  const rows = await db
    .select()
    .from(banking_apps)
    .where(
      and(
        eq(banking_apps.npo_id, npo_id),
        bapp_keyset(banking_apps.date_created, cursor)
      )
    )
    .orderBy(desc(banking_apps.date_created), desc(banking_apps.id))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    next:
      has_more && last
        ? encode_bapp_cursor({ ts: last.date_created, id: last.id })
        : undefined,
  } satisfies IPage<Bapp>;
}

export async function npo_bapp_count(npo_id: number) {
  const [row] = await db
    .select({ c: count() })
    .from(banking_apps)
    .where(eq(banking_apps.npo_id, npo_id));
  return row?.c ?? 0;
}

export async function npo_default_bapp(npo_id: number) {
  const [row] = await db
    .select()
    .from(banking_apps)
    .where(
      and(eq(banking_apps.npo_id, npo_id), eq(banking_apps.status, "default"))
    )
    .limit(1);
  return row;
}

interface BappCursor {
  /** the ordering timestamp — `updated_at` on the admin list, `date_created`
   * on an npo's own list */
  ts: string;
  id: string;
}

/** neither ordering timestamp is unique — `bapp_set_default` stamps two rows
 * with one instant, the backfill gave every pre-existing row its submission
 * time, and `date_created` defaults to `now()` for rows written in one
 * transaction. a timestamp-only cursor drops every tied row that fell past the
 * page edge, since the next page's `< cursor` rejects them all. `id` breaks the
 * tie.
 *
 * carried as `<iso>|<id>` through the same base64url pair the date cursor uses
 * — neither field can contain a pipe, and a decoded value without both halves
 * reads as no cursor (the first page). */
function encode_bapp_cursor(c: BappCursor) {
  return encode_date_cursor(`${c.ts}|${c.id}`);
}

function decode_bapp_cursor(next?: string): BappCursor | undefined {
  const raw = decode_date_cursor(next);
  if (!raw) return undefined;
  const [ts, id] = raw.split("|");
  if (!ts || !id) return undefined;
  return { ts, id };
}

function bapp_keyset(col: PgColumn, cursor?: BappCursor) {
  if (!cursor) return undefined;
  return sql`(${col}, ${banking_apps.id}) < (${cursor.ts}::timestamptz, ${cursor.id}::text)`;
}

/** the admin list: keyed on `updated_at` so a verdict on an old submission
 * surfaces as recent, which submission date can never do. */
export async function bapps_by_status(
  status: TStatus | TStatus[] | undefined,
  opts?: IBappsOpts
) {
  const { limit = 15, next, npo_id } = opts || {};
  const cursor = decode_bapp_cursor(next);

  const status_filter = Array.isArray(status)
    ? inArray(banking_apps.status, status)
    : status
      ? eq(banking_apps.status, status)
      : undefined;

  const keyset = bapp_keyset(banking_apps.updated_at, cursor);

  const rows = await db
    .select()
    .from(banking_apps)
    .where(
      and(
        status_filter,
        npo_id ? eq(banking_apps.npo_id, npo_id) : undefined,
        keyset
      )
    )
    .orderBy(desc(banking_apps.updated_at), desc(banking_apps.id))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    next:
      has_more && last
        ? encode_bapp_cursor({ ts: last.updated_at, id: last.id })
        : undefined,
  } satisfies IPage<Bapp>;
}

/** false when a bapp with this wise recipient id already exists, for any npo */
export async function bapp_put(db: DbOrTx, data: BappInsert) {
  const inserted = await db
    .insert(banking_apps)
    .values(data)
    .onConflictDoNothing({ target: banking_apps.id })
    .returning({ id: banking_apps.id });
  return inserted.length > 0;
}

export async function bapp_update_status(
  id: string,
  update: { status: TStatus; rejection_reason?: string }
) {
  const [prev] = await db
    .select()
    .from(banking_apps)
    .where(eq(banking_apps.id, id));
  await db
    .update(banking_apps)
    .set({
      status: update.status,
      rejection_reason: update.rejection_reason ?? "",
      updated_at: new Date().toISOString(),
    })
    .where(eq(banking_apps.id, id));

  return prev;
}

/**
 * set the npo's approved bapp as default, demoting any existing default;
 * false (and nothing changed) when `id` is not an approved bapp of `npo_id`
 */
export async function bapp_set_default(
  id: string,
  npo_id: number
): Promise<boolean> {
  const now = new Date().toISOString();
  return db.transaction(async (tx) => {
    // lock the npo's rows first: concurrent promotions queue here instead of
    // deadlocking, and the demote below sees the winner's committed default
    await tx
      .select({ id: banking_apps.id })
      .from(banking_apps)
      .where(eq(banking_apps.npo_id, npo_id))
      .orderBy(banking_apps.id)
      .for("update");

    const promoted = await tx
      .update(banking_apps)
      .set({ status: "default", updated_at: now })
      .where(
        and(
          eq(banking_apps.id, id),
          eq(banking_apps.npo_id, npo_id),
          eq(banking_apps.status, "approved")
        )
      )
      .returning({ id: banking_apps.id });
    if (promoted.length === 0) return false;

    await tx
      .update(banking_apps)
      .set({ status: "approved", updated_at: now })
      .where(
        and(
          eq(banking_apps.npo_id, npo_id),
          eq(banking_apps.status, "default"),
          sql`${banking_apps.id} != ${id}`
        )
      );
    return true;
  });
}

/** false when `id` is not a bapp of `npo_id` */
export async function bapp_delete(id: string, npo_id: number) {
  const deleted = await db
    .delete(banking_apps)
    .where(and(eq(banking_apps.id, id), eq(banking_apps.npo_id, npo_id)))
    .returning({ id: banking_apps.id });
  return deleted.length > 0;
}

export type BappDeleteResult = "deleted" | "refused" | "not_found";

/**
 * delete a bapp of `npo_id`, refused while it is the npo's default and the npo
 * has an approved method that could take its place.
 *
 * the guard alone is not enough under read committed: its `exists` reads the
 * statement snapshot, so an approve still uncommitted when the delete starts is
 * missed. locking the npo's rows first makes that approve finish before the
 * delete's fresh snapshot is taken — the approve path updates an existing row,
 * and no insert writes `approved`. ordered by id like `bapp_set_default`, so
 * the two queue on each other rather than deadlock.
 */
export async function bapp_delete_guarded(
  id: string,
  npo_id: number
): Promise<BappDeleteResult> {
  const sibling = alias(banking_apps, "sibling");
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: banking_apps.id })
      .from(banking_apps)
      .where(eq(banking_apps.npo_id, npo_id))
      .orderBy(banking_apps.id)
      .for("update");
    if (!locked.some((r) => r.id === id)) return "not_found";

    const deleted = await tx
      .delete(banking_apps)
      .where(
        and(
          eq(banking_apps.id, id),
          eq(banking_apps.npo_id, npo_id),
          not(
            and(
              eq(banking_apps.status, "default"),
              exists(
                tx
                  .select({ one: sql`1` })
                  .from(sibling)
                  .where(
                    and(
                      eq(sibling.npo_id, npo_id),
                      eq(sibling.status, "approved")
                    )
                  )
              )
            )!
          )
        )
      )
      .returning({ id: banking_apps.id });
    return deleted.length > 0 ? "deleted" : "refused";
  });
}
