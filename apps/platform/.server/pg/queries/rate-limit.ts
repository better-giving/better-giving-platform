import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { rate_limit_windows as t } from "../schema/rate-limit";
import type { DbOrTx } from "./helpers";

/** one fixed window, as ISO instants */
export interface RateWindow {
  start: string;
  end: string;
}

/** counts one use of `key` in `w` and returns the new count, or null when the
 * window already holds `max` — a denial is not counted. one statement, so
 * concurrent takers from any instance serialize on the row. */
export async function rate_limit_take(
  key: string,
  w: RateWindow,
  max: number,
  conn: DbOrTx = db
): Promise<number | null> {
  const [row] = await conn
    .insert(t)
    .values({ key, window_start: w.start, count: 1, expires_at: w.end })
    .onConflictDoUpdate({
      target: [t.key, t.window_start],
      set: { count: sql`${t.count} + 1` },
      setWhere: sql`${t.count} < ${max}`,
    })
    .returning({ count: t.count });
  return row?.count ?? null;
}

/** hands one use back to the window that started at `window_start`; never
 * below zero */
export async function rate_limit_release(
  key: string,
  window_start: string,
  conn: DbOrTx = db
): Promise<void> {
  await conn
    .update(t)
    .set({ count: sql`${t.count} - 1` })
    .where(
      and(eq(t.key, key), eq(t.window_start, window_start), gt(t.count, 0))
    );
}

/** deletes up to `batch` windows that ended at or before `now`, and returns how
 * many went. the batch bounds the latency of the request that pays for it. */
export async function rate_limit_sweep(
  now: string,
  conn: DbOrTx = db,
  batch = 1000
): Promise<number> {
  const ended = conn
    .select({ key: t.key, window_start: t.window_start })
    .from(t)
    .where(lte(t.expires_at, now))
    .limit(batch);
  const gone = await conn
    .delete(t)
    .where(sql`(${t.key}, ${t.window_start}) in (${ended})`)
    .returning({ key: t.key });
  return gone.length;
}
