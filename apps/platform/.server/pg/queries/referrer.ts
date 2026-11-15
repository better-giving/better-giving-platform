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
  notInArray,
  or,
  sql,
  sum,
} from "drizzle-orm";
import type { ICommission, IPayout, TStatus } from "@/referrals";
import { db } from "../db";
import { referrer_commissions, referrer_payouts } from "../schema/referrer";
import {
  v_referrer_commissions_ltd,
  v_referrer_payout_ltd,
} from "../schema/views";
import type { DbOrTx, IPage } from "./helpers";
import { decode_date_cursor, encode_date_cursor } from "./helpers";

// --- commission queries ---

/** all commissions with a given status (no pagination — drains full set) */
export async function commissions_all_by_status(
  status: TStatus
): Promise<ICommission[]> {
  const rows = await db
    .select()
    .from(referrer_commissions)
    .where(eq(referrer_commissions.status, status));
  // drizzle: status is plain text, domain requires TStatus union
  return rows as unknown as ICommission[];
}

/** earned and not yet paid: a commission in a transfer counts until it is, and
 * counts again once the transfer came back */
export async function pending_earnings(referrer: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(referrer_commissions.amount) })
    .from(referrer_commissions)
    .where(
      and(
        or(
          eq(referrer_commissions.referrer_user, referrer),
          eq(referrer_commissions.referrer_npo, referrer)
        ),
        inArray(referrer_commissions.status, [
          "pending",
          "processing",
          "returned",
        ])
      )
    );
  return Number(row?.total ?? 0);
}

// --- payout queries ---

export async function referrer_payout_list(
  referrer: string,
  opts?: { next?: string; limit?: number }
): Promise<IPage<IPayout>> {
  const { limit = 10, next } = opts || {};
  const cursor = decode_date_cursor(next);

  const rows = await db
    .select()
    .from(referrer_payouts)
    .where(
      and(
        or(
          eq(referrer_payouts.referrer_user, referrer),
          eq(referrer_payouts.referrer_npo, referrer)
        ),
        cursor ? sql`${referrer_payouts.date} < ${cursor}` : undefined
      )
    )
    .orderBy(desc(referrer_payouts.date))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  // drizzle: error/transfer_id nullable, domain requires string / optional
  const items = rows.slice(0, limit) as unknown as IPayout[];
  return {
    items,
    next: has_more
      ? encode_date_cursor(items[items.length - 1]?.date)
      : undefined,
  };
}

/** payout LTD — from view */
export async function payout_ltd_get(referrer: string): Promise<number> {
  const [row] = await db
    .select()
    .from(v_referrer_payout_ltd)
    .where(eq(v_referrer_payout_ltd.referrer, referrer));
  return Number(row?.total ?? 0);
}

/** commissions LTD per npo — from view */
export async function commissions_ltd_get(
  referrer: string
): Promise<(typeof v_referrer_commissions_ltd.$inferSelect)[]> {
  return db
    .select()
    .from(v_referrer_commissions_ltd)
    .where(eq(v_referrer_commissions_ltd.referrer, referrer));
}

// --- writes ---

export async function commission_put(db: DbOrTx, data: ICommission) {
  await db.insert(referrer_commissions).values(data);
}

// refunded_loss stays: the unfunded-payout reversal returns an unclaimed one to refunded
const REFUNDABLE: TStatus[] = [
  "pending",
  "processing",
  "returned",
  "refunded_loss",
];

/**
 * reverses a refunded donation's commission, read under its row lock: one a
 * Wise transfer has claimed may already be paying out, so it becomes
 * `refunded_loss` whatever `status` asked, and one that is already
 * `refunded_loss` with a ref stays so — that transfer may have paid it. one
 * with no ref took its loss from the npo's side and follows `status`. a
 * `returned` one was never paid (its transfer came back), so it follows
 * `status` and drops its ref, which would read as a transfer that paid it. a
 * `paid` one is left as it is: the referrer has the money. returns the row as
 * it was.
 */
export async function commission_refund(
  tx: DbOrTx,
  donation_id: string,
  status: "refunded" | "refunded_loss"
): Promise<ICommission | undefined> {
  const [cur] = await tx
    .select()
    .from(referrer_commissions)
    .where(eq(referrer_commissions.donation_id, donation_id))
    .for("update");
  if (!cur) return undefined;
  const claimed =
    cur.status === "processing" ||
    (cur.status === "refunded_loss" && cur.ref !== null);
  await tx
    .update(referrer_commissions)
    .set({
      status: claimed ? "refunded_loss" : status,
      ...(cur.status === "returned" && { ref: null }),
    })
    .where(
      and(
        eq(referrer_commissions.donation_id, donation_id),
        inArray(referrer_commissions.status, REFUNDABLE)
      )
    );
  return to_commission(cur);
}

// --- wise payout claim ---

type CommissionRow = typeof referrer_commissions.$inferSelect;

function to_commission(r: CommissionRow): ICommission {
  return {
    date: r.date,
    referrer_user: r.referrer_user ?? undefined,
    referrer_npo: r.referrer_npo ?? undefined,
    donation_id: r.donation_id,
    npo_id: r.npo_id,
    amount: r.amount,
    status: r.status,
    ref: r.ref ?? undefined,
  };
}

const of_referrer = (referrer: string) =>
  or(
    eq(referrer_commissions.referrer_user, referrer),
    eq(referrer_commissions.referrer_npo, referrer)
  );

/**
 * claims every pending commission of `referrer` for one transfer: moves them
 * to processing with `mk_ref(pending, tx)` stored as their ref, called with
 * them locked; a throw from it claims nothing. undefined when none is pending
 * — a concurrent claim waits on the row locks, then finds them processing and
 * takes nothing.
 */
export async function commissions_claim(
  db: DbOrTx,
  referrer: string,
  mk_ref: (pending: ICommission[], tx: DbOrTx) => string | Promise<string>
): Promise<{ ref: string; commissions: ICommission[] } | undefined> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(referrer_commissions)
      .where(
        and(of_referrer(referrer), eq(referrer_commissions.status, "pending"))
      )
      .orderBy(asc(referrer_commissions.donation_id))
      .for("update");
    if (locked.length === 0) return undefined;
    const pending = locked.map(to_commission);
    const ref = await mk_ref(pending, tx);
    await tx
      .update(referrer_commissions)
      .set({ status: "processing", ref })
      .where(
        and(
          inArray(
            referrer_commissions.donation_id,
            pending.map((c) => c.donation_id)
          ),
          eq(referrer_commissions.status, "pending")
        )
      );
    return {
      ref,
      commissions: pending.map((c) => ({ ...c, status: "processing", ref })),
    };
  });
}

/** compare-and-set of the ref's commissions still processing; returns those it moved */
async function claimed_move(
  db: DbOrTx,
  ref: string,
  upd: { status: "pending"; ref: null } | { status: "paid" }
): Promise<ICommission[]> {
  const rows = await db
    .update(referrer_commissions)
    .set(upd)
    .where(
      and(
        eq(referrer_commissions.ref, ref),
        eq(referrer_commissions.status, "processing")
      )
    )
    .returning();
  return rows
    .map(to_commission)
    .sort((a, b) => a.donation_id.localeCompare(b.donation_id));
}

/** the transfer was never funded: the ref's claimed commissions go back to pending */
export function commissions_release(db: DbOrTx, ref: string) {
  return claimed_move(db, ref, { status: "pending", ref: null });
}

/** the transfer was funded: the ref's claimed commissions are paid, ref kept */
export function commissions_mark_paid(db: DbOrTx, ref: string) {
  return claimed_move(db, ref, { status: "paid" });
}

// --- returned transfers ---

export type ReferrerPayoutRow = typeof referrer_payouts.$inferSelect;

/** the payout's row, locked until `tx` ends */
export async function referrer_payout_locked(
  tx: DbOrTx,
  id: string
): Promise<ReferrerPayoutRow | undefined> {
  const [row] = await tx
    .select()
    .from(referrer_payouts)
    .where(eq(referrer_payouts.id, id))
    .for("update");
  return row;
}

/** the payout's referrer, unlocked: undefined when there is no such payout */
export async function referrer_payout_referrer(
  tx: DbOrTx,
  id: string
): Promise<string | undefined> {
  const [row] = await tx
    .select({
      user: referrer_payouts.referrer_user,
      npo: referrer_payouts.referrer_npo,
    })
    .from(referrer_payouts)
    .where(eq(referrer_payouts.id, id));
  return row ? (row.user ?? row.npo ?? undefined) : undefined;
}

/** compare-and-set of the stored wise state; false when another writer moved
 * it first */
export async function referrer_payout_status_set(
  db_: DbOrTx,
  id: string,
  from: string,
  to: string
): Promise<boolean> {
  const rows = await db_
    .update(referrer_payouts)
    .set({ status: to })
    .where(and(eq(referrer_payouts.id, id), eq(referrer_payouts.status, from)))
    .returning({ id: referrer_payouts.id });
  return rows.length > 0;
}

/** stores the wise recipient a transfer paid, where none is stored yet */
export async function referrer_payout_recipient_fill(
  db_: DbOrTx,
  id: string,
  recipient_id: string
) {
  await db_
    .update(referrer_payouts)
    .set({ recipient_id })
    .where(
      and(eq(referrer_payouts.id, id), isNull(referrer_payouts.recipient_id))
    );
}

/** payouts with a real wise transfer behind them (not a failed attempt, not a
 * run recovered as owed) dated since `since`, whose stored state is not one of
 * `final` */
export async function referrer_payouts_to_poll(
  since: string,
  final: readonly string[]
): Promise<ReferrerPayoutRow[]> {
  return db
    .select()
    .from(referrer_payouts)
    .where(
      and(
        isNotNull(referrer_payouts.transfer_id),
        isNull(referrer_payouts.error),
        gt(referrer_payouts.amount, 0),
        gte(referrer_payouts.date, since),
        notInArray(referrer_payouts.status, [...final])
      )
    )
    .orderBy(asc(referrer_payouts.date), asc(referrer_payouts.id));
}

/** returned payouts of a real transfer dated since `since` with no recipient
 * stored: the poll reads it off the transfer */
export async function referrer_returned_missing_recipient(
  since: string
): Promise<ReferrerPayoutRow[]> {
  return db
    .select()
    .from(referrer_payouts)
    .where(
      and(
        isNotNull(referrer_payouts.transfer_id),
        gte(referrer_payouts.date, since),
        eq(referrer_payouts.status, "returned"),
        isNull(referrer_payouts.recipient_id)
      )
    )
    .orderBy(asc(referrer_payouts.date), asc(referrer_payouts.id));
}

/** the commissions a transfer's ref claimed, row-locked in id order */
export async function commissions_of_ref_locked(
  tx: DbOrTx,
  ref: string
): Promise<ICommission[]> {
  const rows = await tx
    .select()
    .from(referrer_commissions)
    .where(eq(referrer_commissions.ref, ref))
    .orderBy(asc(referrer_commissions.donation_id))
    .for("update");
  return rows.map(to_commission);
}

/** the ref's commissions that are paid go `returned`, ref kept; returns those moved */
export async function commissions_mark_returned(
  tx: DbOrTx,
  ref: string
): Promise<ICommission[]> {
  const rows = await tx
    .update(referrer_commissions)
    .set({ status: "returned" })
    .where(
      and(
        eq(referrer_commissions.ref, ref),
        eq(referrer_commissions.status, "paid")
      )
    )
    .returning();
  return rows
    .map(to_commission)
    .sort((a, b) => a.donation_id.localeCompare(b.donation_id));
}

/** referrers holding returned commissions */
export async function referrers_with_returned(): Promise<string[]> {
  const rows = await db
    .selectDistinct({
      user: referrer_commissions.referrer_user,
      npo: referrer_commissions.referrer_npo,
    })
    .from(referrer_commissions)
    .where(eq(referrer_commissions.status, "returned"));
  return rows.flatMap((r) => r.user ?? r.npo ?? []);
}

/**
 * the wise recipients the referrer's returned payouts went to: the accounts
 * that bounced. `unrecorded` is set when a returned payout has no recipient
 * on record. the one notion the commissions run (skip a bounced account) and
 * the re-send (refuse one) both read, so they cannot drift
 */
export async function referrer_bounced_recipients(
  referrer: string,
  db_: DbOrTx = db
): Promise<{
  returned: boolean;
  recipients: Set<string>;
  unrecorded: boolean;
}> {
  const rows = await db_
    .select({ recipient_id: referrer_payouts.recipient_id })
    .from(referrer_payouts)
    .where(
      and(
        or(
          eq(referrer_payouts.referrer_user, referrer),
          eq(referrer_payouts.referrer_npo, referrer)
        ),
        eq(referrer_payouts.status, "returned")
      )
    );
  return {
    returned: rows.length > 0,
    recipients: new Set(rows.flatMap((r) => r.recipient_id ?? [])),
    unrecorded: rows.some((r) => r.recipient_id === null),
  };
}

/** the referrer's returned commissions go back to pending, ref cleared, to be
 * paid with the next run; returns their donation ids */
export async function returned_commissions_resend(
  tx: DbOrTx,
  referrer: string
): Promise<string[]> {
  const rows = await tx
    .update(referrer_commissions)
    .set({ status: "pending", ref: null })
    .where(
      and(of_referrer(referrer), eq(referrer_commissions.status, "returned"))
    )
    .returning({ id: referrer_commissions.donation_id });
  return rows.map((r) => r.id).sort();
}

export async function referrer_payout_put(db: DbOrTx, data: IPayout) {
  // drizzle: error/transfer_id nullable, domain has optional; id nullable, domain requires string
  await db.insert(referrer_payouts).values(data as any);
}
