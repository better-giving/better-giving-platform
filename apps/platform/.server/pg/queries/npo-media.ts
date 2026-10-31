import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { IMedia } from "@/npo";
import type { IMediaSearchObj, IMediaUpdate } from "@/npo/schema";
import { db } from "../db";
import { npo_media } from "../schema/npo";
import type { IPage, Tx } from "./helpers";
import { decode_cursor, encode_cursor } from "./helpers";

/** the last row of a page, in the list's sort key */
interface IMediaCursor {
  d: string | null;
  id: string;
}

const is_media_cursor = (x: unknown): x is IMediaCursor => {
  const c = x as Partial<IMediaCursor> | undefined;
  return typeof c?.id === "string" && (c.d === null || typeof c.d === "string");
};

/** rows past the cursor in `date_created desc nulls last, id desc` */
const after = ({ d, id }: IMediaCursor) =>
  d === null
    ? and(isNull(npo_media.date_created), lt(npo_media.id, id))
    : or(
        sql`${npo_media.date_created} < ${d}::timestamptz`,
        and(
          sql`${npo_media.date_created} = ${d}::timestamptz`,
          lt(npo_media.id, id)
        ),
        isNull(npo_media.date_created)
      );

export async function npo_media_list(
  npo_id: number,
  opts: IMediaSearchObj
): Promise<IPage<IMedia>> {
  const { limit = 10, next, type, featured } = opts;
  const cursor = decode_cursor(next);

  const rows = await db
    .select()
    .from(npo_media)
    .where(
      and(
        eq(npo_media.npo_id, npo_id),
        type ? eq(npo_media.type, type) : undefined,
        featured !== undefined ? eq(npo_media.featured, featured) : undefined,
        is_media_cursor(cursor) ? after(cursor) : undefined
      )
    )
    .orderBy(sql`${npo_media.date_created} desc nulls last`, desc(npo_media.id))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items as unknown as IMedia[],
    next:
      has_more && last
        ? encode_cursor({ d: last.date_created, id: last.id })
        : undefined,
  };
}

export async function npo_media_get(mid: string): Promise<IMedia | undefined> {
  const [row] = await db.select().from(npo_media).where(eq(npo_media.id, mid));
  return row as unknown as IMedia | undefined;
}

export interface IMediaPut {
  url: string;
  /** asked-for state; `true` lands only while the npo has room under the cap */
  featured: boolean;
}

export interface IMediaPutResult {
  id: string;
  /** the state the row holds, which is `false` for a feature refused at the cap */
  featured: boolean;
}

/** per-npo, held to commit: the featured count read under it is the one the
 * write lands on, so two writers can't both take the last spot */
async function lock_npo_media(tx: Tx, npo_id: number) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`npo-media:${npo_id}`}, 0))`
  );
}

async function featured_videos(tx: Tx, npo_id: number): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(npo_media)
    .where(
      and(
        eq(npo_media.npo_id, npo_id),
        eq(npo_media.type, "video"),
        eq(npo_media.featured, true)
      )
    );
  return row?.n ?? 0;
}

/** a link this npo already has answers with its row, featured state as it
 * stands: a repeated add is a retry after a lost response, never a second copy */
export async function npo_media_put(
  npo_id: number,
  put: IMediaPut,
  cap: number
): Promise<IMediaPutResult> {
  return db.transaction(async (tx) => {
    await lock_npo_media(tx, npo_id);
    const [existing] = await tx
      .select({ id: npo_media.id, featured: npo_media.featured })
      .from(npo_media)
      .where(
        and(
          eq(npo_media.npo_id, npo_id),
          eq(npo_media.type, "video"),
          eq(npo_media.url, put.url)
        )
      )
      .limit(1);
    if (existing) return existing;
    const featured = put.featured && (await featured_videos(tx, npo_id)) < cap;
    const id = crypto.randomUUID();
    await tx.insert(npo_media).values({
      id,
      npo_id,
      featured,
      url: put.url,
      type: "video",
      date_created: new Date().toISOString(),
    });
    return { id, featured };
  });
}

export interface IMediaRestore extends IMediaPut {
  /** the removed row's, so the undo brings back that video and no twin of it */
  id: string;
  /** the removed row's, so the video returns to its spot in the list */
  date_created: string | null;
}

/** undo of a delete, by the removed row's id: a repeat (its response was lost)
 * finds the row the first one wrote and answers with it. `undefined` when the
 * id is another npo's row, which is left untouched */
export async function npo_media_restore(
  npo_id: number,
  restore: IMediaRestore,
  cap: number
): Promise<IMediaPutResult | undefined> {
  return db.transaction(async (tx) => {
    await lock_npo_media(tx, npo_id);
    const featured =
      restore.featured && (await featured_videos(tx, npo_id)) < cap;
    await tx
      .insert(npo_media)
      .values({
        id: restore.id,
        npo_id,
        featured,
        url: restore.url,
        type: "video",
        date_created: restore.date_created,
      })
      .onConflictDoNothing({ target: npo_media.id });
    const [row] = await tx
      .select({ id: npo_media.id, featured: npo_media.featured })
      .from(npo_media)
      .where(
        and(
          eq(npo_media.id, restore.id),
          eq(npo_media.npo_id, npo_id),
          eq(npo_media.type, "video")
        )
      );
    return row;
  });
}

/** features an npo's video while fewer than `cap` are featured; `true` when
 * the row is featured afterwards (already-featured included), `false` at the
 * cap or for a row that isn't this npo's video */
export async function npo_media_feature(
  npo_id: number,
  mid: string,
  cap: number
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lock_npo_media(tx, npo_id);
    const room = (await featured_videos(tx, npo_id)) < cap;
    const updated = await tx
      .update(npo_media)
      .set({ featured: true })
      .where(
        and(
          eq(npo_media.id, mid),
          eq(npo_media.npo_id, npo_id),
          eq(npo_media.type, "video"),
          room ? undefined : eq(npo_media.featured, true)
        )
      )
      .returning({ id: npo_media.id });
    return updated.length > 0;
  });
}

export async function npo_media_update(
  npo_id: number,
  mid: string,
  update: IMediaUpdate
) {
  await db
    .update(npo_media)
    .set({
      ...(update.url !== undefined ? { url: update.url } : {}),
      ...(update.featured !== undefined ? { featured: update.featured } : {}),
    })
    .where(and(eq(npo_media.id, mid), eq(npo_media.npo_id, npo_id)));
}

export async function npo_media_delete(npo_id: number, mid: string) {
  await db
    .delete(npo_media)
    .where(and(eq(npo_media.id, mid), eq(npo_media.npo_id, npo_id)));
}
