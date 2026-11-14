import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  type INpoPayoutsOptions,
  type INpoSettlementsOptions,
  type IPayout,
  type IPendingStatus,
  type IProcessingStatus,
  type PayoutStatus,
  UNSENT_TYPES,
} from "@/payouts";
import { db } from "../db";
import { payouts, settlements } from "../schema/payout";
import type { DbOrTx, IPage } from "./helpers";
import { decode_date_cursor, encode_date_cursor } from "./helpers";
import {
  from_payout_insert,
  from_payout_update,
  to_payout,
} from "./mappers/payout";

// -- payouts --

export async function payout_get(id: string): Promise<IPayout | undefined> {
  const [row] = await db.select().from(payouts).where(eq(payouts.id, id));
  return row ? to_payout(row) : undefined;
}

/** one settlement stamps every payout in it with the same `date`, and a
 * date-only `< cursor` drops every tied row past the page edge. `id` breaks the
 * tie, carried as `<iso>|<id>` through the date cursor's base64url (an iso date
 * has no pipe). a cursor without one is a date-only cursor an older page still
 * holds, and pages as it always did: strictly older rows. */
function payout_keyset(next?: string) {
  const raw = decode_date_cursor(next);
  if (!raw) return undefined;
  const pipe = raw.indexOf("|");
  if (pipe < 0) return sql`${payouts.date} < ${raw}`;
  const date = raw.slice(0, pipe);
  const id = raw.slice(pipe + 1);
  return sql`(${payouts.date}, ${payouts.id}) < (${date}::timestamptz, ${id}::text)`;
}

export async function npo_payouts(
  npo_id: number,
  opts: INpoPayoutsOptions
): Promise<IPage<IPayout>> {
  const { limit = 10, next, status, not_status } = opts;

  const rows = await db
    .select()
    .from(payouts)
    .where(
      and(
        eq(payouts.npo_id, npo_id),
        status ? eq(payouts.type, status) : undefined,
        not_status ? ne(payouts.type, not_status) : undefined,
        payout_keyset(next)
      )
    )
    .orderBy(desc(payouts.date), desc(payouts.id))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows.slice(0, limit).map(to_payout);
  const last = items[items.length - 1];
  return {
    items,
    next:
      has_more && last
        ? encode_date_cursor(`${last.date}|${last.id}`)
        : undefined,
  };
}

/** all pending payouts (no pagination — drains full set) */
export async function pending_payouts(): Promise<IPayout[]> {
  const rows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.type, "pending"))
    .orderBy(desc(payouts.date));
  return rows.map(to_payout);
}

/** claimed by a grants run that has not settled or released them yet */
export async function processing_payouts(): Promise<
  IPayout<IProcessingStatus>[]
> {
  const rows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.type, "processing"))
    .orderBy(asc(payouts.npo_id), asc(payouts.id));
  return rows.map(to_payout) as IPayout<IProcessingStatus>[];
}

/**
 * compare-and-set out of every state a grant has gone out in, settled
 * included: the loss log records what the npo kept. false when the payout's
 * money is in the npo's cash again (unsent), or it was voided: the caller's
 * snapshot is stale.
 */
export async function payout_mark_refunded_loss(
  db: DbOrTx,
  id: string
): Promise<boolean> {
  const rows = await db
    .update(payouts)
    .set(from_payout_update({ type: "refunded_loss" }))
    .where(
      and(
        eq(payouts.id, id),
        notInArray(payouts.type, [...UNSENT_TYPES, "void"])
      )
    )
    .returning({ id: payouts.id });
  return rows.length > 0;
}

/**
 * the payouts among `ids` still pending, row-locked until `tx` ends. a payout
 * claimed or refunded by a writer that commits first is re-checked after the
 * wait and left out. id order keeps two concurrent lockers from deadlocking.
 */
export async function pending_payouts_locked(
  tx: DbOrTx,
  ids: string[]
): Promise<IPayout<IPendingStatus>[]> {
  const rows = await tx
    .select()
    .from(payouts)
    .where(and(inArray(payouts.id, ids), eq(payouts.type, "pending")))
    .orderBy(asc(payouts.id))
    .for("update");
  return rows.map(to_payout) as IPayout<IPendingStatus>[];
}

export async function payout_put(db: DbOrTx, data: IPayout) {
  await db.insert(payouts).values(from_payout_insert(data));
}

/**
 * compare-and-set out of `pending` or `returned` (`UNSENT_TYPES`): false when
 * the payout was already moved on (claimed by the grants cron, refunded, …):
 * the caller's snapshot is stale. a re-send moving `returned` to `pending`
 * keeps it movable.
 */
export async function payout_move_from_unsent(
  db: DbOrTx,
  id: string,
  upd: Partial<Omit<IPayout, "id">>
): Promise<boolean> {
  const rows = await db
    .update(payouts)
    .set(from_payout_update(upd))
    .where(and(eq(payouts.id, id), inArray(payouts.type, [...UNSENT_TYPES])))
    .returning({ id: payouts.id });
  return rows.length > 0;
}

/**
 * compare-and-set of every payout among `ids` still in `from`; returns the ids
 * it moved. a payout another writer moved on first is left out.
 */
export async function payouts_move(
  db: DbOrTx,
  ids: string[],
  from: PayoutStatus["type"],
  upd: PayoutStatus
): Promise<string[]> {
  const rows = await db
    .update(payouts)
    .set(from_payout_update(upd))
    .where(and(inArray(payouts.id, ids), eq(payouts.type, from)))
    .returning({ id: payouts.id });
  return rows.map((r) => r.id);
}

/** the ids among `ids` whose payout is currently `type` */
export async function payouts_in(
  db: DbOrTx,
  ids: string[],
  type: PayoutStatus["type"]
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(inArray(payouts.id, ids), eq(payouts.type, type)));
  return rows.map((r) => r.id);
}

export interface IReturnedPayouts {
  count: number;
  total: number;
  /** the latest returned payout's own `date`, iso */
  latest_date: string;
}

/** the npo's payouts whose transfer came back, waiting until a newer approved
 * account is the one the grants run pays (`npo_return_hold`;
 * `resend_returned` moves them back to pending); null when none */
export async function npo_returned_payouts(
  npo_id: number
): Promise<IReturnedPayouts | null> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`sum(${payouts.amount})`.mapWith(payouts.amount),
      latest_date: sql<string>`max(${payouts.date})`.mapWith(payouts.date),
    })
    .from(payouts)
    .where(and(eq(payouts.npo_id, npo_id), eq(payouts.type, "returned")));
  return row && row.count > 0 ? row : null;
}

/** the npo's returned payouts back to pending, for the next grants run to
 * pay; returns the ids moved. their settlement is cleared with them: a
 * pending payout names none, and the run that pays them names its own */
export async function returned_payouts_resend(
  db_: DbOrTx,
  npo_id: number
): Promise<string[]> {
  const rows = await db_
    .update(payouts)
    .set({
      type: "pending",
      message: null,
      settled_id: null,
      settled_date: null,
    })
    .where(and(eq(payouts.npo_id, npo_id), eq(payouts.type, "returned")))
    .returning({ id: payouts.id });
  return rows.map((r) => r.id).sort();
}

// -- settlements --

export type SettlementRow = typeof settlements.$inferSelect;
type SettlementInsert = typeof settlements.$inferInsert;

export async function npo_settlements(
  npo_id: number,
  opts: INpoSettlementsOptions
): Promise<IPage<SettlementRow>> {
  const { limit = 10, next } = opts;
  const cursor = decode_date_cursor(next);

  const rows = await db
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.npo_id, npo_id),
        cursor ? sql`${settlements.date} < ${cursor}` : undefined
      )
    )
    .orderBy(desc(settlements.date))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows.slice(0, limit);
  return {
    items,
    next: has_more
      ? encode_date_cursor(items[items.length - 1]?.date ?? undefined)
      : undefined,
  };
}

export async function settlement_put(db: DbOrTx, data: SettlementInsert) {
  await db.insert(settlements).values(data);
}

/** the settlement, row-locked until `tx` ends */
export async function settlement_locked(
  tx: DbOrTx,
  id: string
): Promise<SettlementRow | undefined> {
  const [row] = await tx
    .select()
    .from(settlements)
    .where(eq(settlements.id, id))
    .for("update");
  return row;
}

/** compare-and-set of the stored wise state; false when another writer moved
 * it first */
export async function settlement_status_set(
  db_: DbOrTx,
  id: string,
  from: string,
  to: string
): Promise<boolean> {
  const rows = await db_
    .update(settlements)
    .set({ status: to })
    .where(and(eq(settlements.id, id), eq(settlements.status, from)))
    .returning({ id: settlements.id });
  return rows.length > 0;
}

/**
 * the settlements of a real wise transfer (a grants run's: `other_id` is its
 * ref, the amount what it sent) dated since `since`, whose stored state is
 * not one of `final`
 */
export async function settlements_to_poll(
  since: string,
  final: readonly string[]
): Promise<SettlementRow[]> {
  return db
    .select()
    .from(settlements)
    .where(
      and(
        isNotNull(settlements.other_id),
        gt(settlements.amount, 0),
        gte(settlements.date, since),
        notInArray(settlements.status, [...final])
      )
    )
    .orderBy(asc(settlements.date), asc(settlements.id));
}

/** the npo's latest settlement whose transfer came back; null when none did */
export async function npo_last_return(
  npo_id: number,
  db_: DbOrTx = db
): Promise<Pick<SettlementRow, "id" | "date"> | null> {
  const [row] = await db_
    .select({ id: settlements.id, date: settlements.date })
    .from(settlements)
    .where(
      and(eq(settlements.npo_id, npo_id), eq(settlements.status, "returned"))
    )
    .orderBy(desc(settlements.date), desc(settlements.id))
    .limit(1);
  return row ?? null;
}

/** marks returned settlement `id` as the one ops was told holds its npo's
 * grants; false when ops was already told of it. the marker is the dedupe:
 * one alert per returned settlement */
export async function hold_alert_claim(id: string): Promise<boolean> {
  const rows = await db
    .update(settlements)
    .set({ hold_alerted_at: new Date().toISOString() })
    .where(and(eq(settlements.id, id), isNull(settlements.hold_alerted_at)))
    .returning({ id: settlements.id });
  return rows.length > 0;
}

/** a hold alert that did not go out: the next run claims it again */
export async function hold_alert_unclaim(id: string) {
  await db
    .update(settlements)
    .set({ hold_alerted_at: null })
    .where(eq(settlements.id, id));
}

/** the settlement's npo, unlocked: undefined when there is no such settlement */
export async function settlement_npo_id(
  db_: DbOrTx,
  id: string
): Promise<number | null | undefined> {
  const [row] = await db_
    .select({ npo_id: settlements.npo_id })
    .from(settlements)
    .where(eq(settlements.id, id));
  return row ? row.npo_id : undefined;
}

export interface IRunPayout {
  id: string;
  amount: number;
  type: PayoutStatus["type"];
  settled_id: string | null;
}

export interface ILegacyLoss extends IRunPayout {
  source_id: string;
}

/**
 * payouts of the run behind `s` that a refund took in flight under the settle
 * from before it stamped them: `refunded_loss`, no `settled_id`, listed in
 * its `sources`. row-locked. `shared`: another settlement of the npo lists the
 * same source too, so which run they belong to is not decidable here
 */
export async function legacy_losses_locked(
  tx: DbOrTx,
  s: Pick<SettlementRow, "id" | "npo_id" | "sources">
): Promise<{ rows: ILegacyLoss[]; shared: boolean }> {
  if (s.npo_id === null || !s.sources || s.sources.length === 0) {
    return { rows: [], shared: false };
  }
  const rows = await tx
    .select({
      id: payouts.id,
      amount: payouts.amount,
      type: payouts.type,
      settled_id: payouts.settled_id,
      source_id: payouts.source_id,
    })
    .from(payouts)
    .where(
      and(
        eq(payouts.npo_id, s.npo_id),
        isNull(payouts.settled_id),
        eq(payouts.type, "refunded_loss"),
        inArray(payouts.source_id, s.sources)
      )
    )
    .orderBy(asc(payouts.id))
    .for("update");
  if (rows.length === 0) return { rows, shared: false };
  const others = await tx
    .select({ id: settlements.id, sources: settlements.sources })
    .from(settlements)
    .where(and(eq(settlements.npo_id, s.npo_id), ne(settlements.id, s.id)));
  const mine = new Set(rows.map((r) => r.source_id));
  const shared = others.some((o) => (o.sources ?? []).some((x) => mine.has(x)));
  return { rows, shared };
}

/**
 * every payout of the run behind `s`, row-locked in id order: those it owns
 * by `settled_id`, whatever they are now. one a refund took while the transfer
 * was in flight is the run's too: the settle stamps it when it records the run
 */
export async function run_payouts_locked(
  tx: DbOrTx,
  s: Pick<SettlementRow, "id">
): Promise<IRunPayout[]> {
  return tx
    .select({
      id: payouts.id,
      amount: payouts.amount,
      type: payouts.type,
      settled_id: payouts.settled_id,
    })
    .from(payouts)
    .where(eq(payouts.settled_id, s.id))
    .orderBy(asc(payouts.id))
    .for("update");
}

/** names `settlement_id` as the run of loss-refunded payouts `ids`, which a
 * refund took while the run's transfer was in flight, so they never got a
 * `settled_id` from the settle */
export async function payouts_own_loss(
  tx: DbOrTx,
  ids: string[],
  settlement_id: string
) {
  if (ids.length === 0) return;
  await tx
    .update(payouts)
    .set({ settled_id: settlement_id })
    .where(
      and(
        inArray(payouts.id, ids),
        eq(payouts.type, "refunded_loss"),
        isNull(payouts.settled_id)
      )
    );
}
