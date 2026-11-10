import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { IBalanceTx } from "@/balance-txs";
import type { IDonationsSearch, IPageOpts } from "@/donations";
import type { IAddr } from "@/types/donation";
import { db } from "../db";
import { bal_txs } from "../schema/bal-tx";
import { dists } from "../schema/dist";
import {
  donation_donors,
  donation_settlements,
  donations,
} from "../schema/donation";
import { forms } from "../schema/form";
import { npos } from "../schema/npo";
import { payouts } from "../schema/payout";
import { referrer_commissions } from "../schema/referrer";
import { rev_logs } from "../schema/revenue";
import type { DbOrTx, IPage, Tx } from "./helpers";
import { decode_date_cursor, encode_date_cursor } from "./helpers";
import { owed_on_gift, owed_open_on_gift } from "./owed";

export type DistRow = typeof dists.$inferSelect;
type DistInsert = typeof dists.$inferInsert;

/** dist joined with parent donation + donor + settlement */
export interface INpoDonation extends DistRow {
  // from donations
  frequency: string;
  via: string;
  source: string;
  form_id: string | null;
  form_name: string | null;
  form_tag: string | null;
  program_id: string | null;
  program_name: string | null;
  /** an `owed_amounts` row records this npo owing on the gift */
  owed_back: boolean;
  /** and some of it is still outstanding */
  owed_open: boolean;
  // from donation_donors
  from_email: string;
  from_name: string | null;
  from_company: string | null;
  from_addr: IAddr | null;
  // from donation_settlements
  sttl_id: string | null;
  sttl_date: string | null;
  sttl_currency: string | null;
}

// select shape for joined query
const dist_joined = {
  dist: dists,
  don: {
    frequency: donations.frequency,
    via: donations.via,
    source: donations.source,
    form_id: donations.form_id,
    program_id: donations.program_id,
    program_name: donations.program_name,
    // stripe refused to reverse part of a routed transfer: the nonprofit owes it
    owed_back: owed_on_gift(dists.donation_id, dists.to_id),
    owed_open: owed_open_on_gift(dists.donation_id, dists.to_id),
  },
  donor: {
    email: donation_donors.email,
    name: donation_donors.name,
    company_name: donation_donors.company_name,
    addr: donation_donors.addr,
  },
  sttl: {
    sttl_id: donation_settlements.sttl_id,
    date: donation_settlements.date,
    currency: donation_settlements.currency,
  },
  form: {
    name: forms.name,
    tag: forms.tag,
  },
};

type JoinedRow = {
  dist: DistRow;
  don: {
    frequency: string;
    via: string;
    source: string;
    form_id: string | null;
    program_id: string | null;
    program_name: string | null;
    owed_back: boolean;
    owed_open: boolean;
  };
  donor: {
    email: string;
    name: string | null;
    company_name: string | null;
    addr: IAddr | null;
  } | null;
  sttl: {
    sttl_id: string;
    date: string;
    currency: string;
  } | null;
  form: {
    name: string;
    tag: string | null;
  } | null;
};

function to_npo_donation(r: JoinedRow): INpoDonation {
  return {
    ...r.dist,
    frequency: r.don.frequency,
    via: r.don.via,
    source: r.don.source,
    form_id: r.don.form_id,
    form_name: r.form?.name ?? null,
    form_tag: r.form?.tag ?? null,
    program_id: r.don.program_id,
    program_name: r.don.program_name,
    owed_back: r.don.owed_back,
    owed_open: r.don.owed_open,
    from_email: r.donor?.email ?? "",
    from_name: r.donor?.name ?? null,
    from_company: r.donor?.company_name ?? null,
    from_addr: r.donor?.addr ?? null,
    sttl_id: r.sttl?.sttl_id ?? null,
    sttl_date: r.sttl?.date ?? null,
    sttl_currency: r.sttl?.currency ?? null,
  };
}

// base query builder — all dist reads join the same tables
function dist_base() {
  return db
    .select(dist_joined)
    .from(dists)
    .innerJoin(donations, eq(dists.donation_id, donations.id))
    .leftJoin(
      donation_donors,
      eq(dists.donation_id, donation_donors.donation_id)
    )
    .leftJoin(
      donation_settlements,
      eq(dists.donation_id, donation_settlements.donation_id)
    )
    .leftJoin(forms, eq(donations.form_id, forms.id));
}

export async function npo_donation_get(
  id: string
): Promise<INpoDonation | undefined> {
  const [row] = await dist_base().where(eq(dists.id, id));
  return row ? to_npo_donation(row as JoinedRow) : undefined;
}

export async function dist_put(db: DbOrTx, data: DistInsert) {
  await db.insert(dists).values(data);
}

export async function dist_update(
  db: DbOrTx,
  id: string,
  data: Partial<Omit<DistInsert, "id">>
) {
  await db.update(dists).set(data).where(eq(dists.id, id));
}

/** must outlast the don-dist handler's longest run, or a live holder loses its claim */
export const DIST_NOTICE_LEASE_MS = 15 * 60 * 1000;

const lease_cutoff = sql`now() - make_interval(secs => ${DIST_NOTICE_LEASE_MS / 1000})`;

/**
 * - `claimed`: the caller holds the notice; `stamp` is its claim, the one
 *   `release_dist_notice` gives back. `mailed`/`counted`/`hooked` say which
 *   steps an earlier holder already finished — the caller runs only the rest
 * - `done`: nothing left to run, ever — all three steps are stamped, or the
 *   dist is no longer `settled` (the queue payload is a snapshot from before
 *   enqueue, and the row is what knows a refund landed since)
 * - `busy`: another holder's claim is inside its lease, and may yet die
 *   without finishing — the caller has to come back after the lease, not drop it
 */
export type DistNoticeClaim =
  | {
      status: "claimed";
      stamp: string;
      mailed: boolean;
      counted: boolean;
      hooked: boolean;
    }
  | { status: "done" }
  | { status: "busy" };

const stamped = (step: AnyPgColumn) => sql<boolean>`${step} is not null`;

const steps_pending = sql<boolean>`(${dists.notice_sent_at} is null or ${dists.metric_counted_at} is null or ${dists.hooks_sent_at} is null)`;

/**
 * claim the right to run this dist's npo notice — the npo's mail, the country
 * metric, its zapier hooks.
 *
 * one lease covers all three: `notice_claimed_at` is taken here and expires
 * after `DIST_NOTICE_LEASE_MS`, so a holder killed mid-run does not take the
 * notice with it. each step has its own permanent stamp — `notice_sent_at`
 * (`mark_dist_notice_sent`), `metric_counted_at` (`count_dist_metric`),
 * `hooks_sent_at` (`mark_dist_hooks_sent`) — so a step that finished is never
 * repeated and one that failed is retried alone. both the lease and the stamps
 * read the database clock, never an instance's.
 */
export async function claim_dist_notice(
  dist_id: string,
  tx: DbOrTx = db
): Promise<DistNoticeClaim> {
  const [claimed] = await tx
    .update(dists)
    // ms, so the stamp survives a driver that hands back a Date and still
    // matches `release_dist_notice`'s equality
    .set({ notice_claimed_at: sql`date_trunc('milliseconds', now())` })
    .where(
      and(
        eq(dists.id, dist_id),
        eq(dists.status, "settled"),
        steps_pending,
        or(
          isNull(dists.notice_claimed_at),
          lt(dists.notice_claimed_at, lease_cutoff)
        )
      )
    )
    .returning({
      stamp: dists.notice_claimed_at,
      mailed: stamped(dists.notice_sent_at),
      counted: stamped(dists.metric_counted_at),
      hooked: stamped(dists.hooks_sent_at),
    });
  if (claimed?.stamp) {
    const { stamp, mailed, counted, hooked } = claimed;
    return { status: "claimed", stamp, mailed, counted, hooked };
  }

  // read after the miss, so a state that moved in between can only read as
  // busy, whose retry then sees it — stamps and refunds never move back
  const [row] = await tx
    .select({ status: dists.status, pending: steps_pending })
    .from(dists)
    .where(eq(dists.id, dist_id));
  // a missing dist has nothing to send either
  if (row?.status !== "settled" || !row.pending) return { status: "done" };
  return { status: "busy" };
}

/**
 * give back a notice claim whose steps did not all complete, so the
 * redelivery can take it. only the claim `stamp` names: a holder that outlived
 * its lease must not clear the claim a later holder took since. a notice with
 * every step stamped stays claimed, so a late release cannot reopen it.
 */
export async function release_dist_notice(
  dist_id: string,
  stamp: string,
  tx: DbOrTx = db
): Promise<void> {
  await tx
    .update(dists)
    .set({ notice_claimed_at: null })
    .where(
      and(
        eq(dists.id, dist_id),
        eq(dists.notice_claimed_at, stamp),
        steps_pending
      )
    );
}

/**
 * record that this dist's npo mail is out; permanent. not tied to a claim:
 * once the mail has gone, sent is true whoever holds.
 */
export async function mark_dist_notice_sent(
  dist_id: string,
  tx: DbOrTx = db
): Promise<void> {
  await tx
    .update(dists)
    .set({ notice_sent_at: sql`now()` })
    .where(eq(dists.id, dist_id));
}

/**
 * run `write` — the country metric increment — at most once per dist. the
 * stamp and `write` share one transaction, so either both land or neither:
 * a `write` that throws rolls the stamp back and the error propagates, leaving
 * the step for a later call. `write` must issue every statement on the `tx` it
 * is handed, or that statement escapes the rollback. true when this call
 * counted, false when the metric was already counted.
 */
export async function count_dist_metric(
  dist_id: string,
  write: (tx: Tx) => Promise<void>,
  tx: DbOrTx = db
): Promise<boolean> {
  // handed a tx, this nests as a savepoint inside the caller's transaction
  return tx.transaction(async (t) => {
    const [stamped] = await t
      .update(dists)
      .set({ metric_counted_at: sql`now()` })
      .where(and(eq(dists.id, dist_id), isNull(dists.metric_counted_at)))
      .returning({ id: dists.id });
    if (!stamped) return false;
    await write(t);
    return true;
  });
}

/**
 * record that this dist's zapier hooks went out; permanent, and like
 * `mark_dist_notice_sent` not tied to a claim.
 */
export async function mark_dist_hooks_sent(
  dist_id: string,
  tx: DbOrTx = db
): Promise<void> {
  await tx
    .update(dists)
    .set({ hooks_sent_at: sql`now()` })
    .where(eq(dists.id, dist_id));
}

export type TDistTransferSet = { set: true } | { set: false; existing: string };

/**
 * store the stripe transfer that paid this dist, only while it has none: the
 * double-transfer guard. `created_at` is that transfer's own creation time.
 * `existing` is the transfer already stored, which may be `transfer_id`
 * itself on a retry. a miss leaves the time already stored.
 */
export async function dist_stripe_transfer_set(
  dist_id: string,
  transfer_id: string,
  created_at: string,
  conn: DbOrTx = db
): Promise<TDistTransferSet> {
  const [written] = await conn
    .update(dists)
    .set({
      stripe_transfer_id: transfer_id,
      stripe_transfer_created_at: created_at,
    })
    .where(and(eq(dists.id, dist_id), isNull(dists.stripe_transfer_id)))
    .returning({ id: dists.id });
  if (written) return { set: true };

  // read after the miss, not as a cte beside the update: that select runs on
  // the statement's snapshot and misses a transfer committed while it waited.
  // nothing clears a stored transfer, so this read can't find it gone
  const existing = await dist_stripe_transfer_get(dist_id, conn);
  if (!existing) throw new Error(`dist ${dist_id} not found`);
  return { set: false, existing };
}

/** the stripe transfer that paid this dist; null when none, undefined when no such dist */
export async function dist_stripe_transfer_get(
  dist_id: string,
  conn: DbOrTx = db
): Promise<string | null | undefined> {
  const [row] = await conn
    .select({ tr: dists.stripe_transfer_id })
    .from(dists)
    .where(eq(dists.id, dist_id));
  return row?.tr;
}

export interface IDistAwaitingTransfer {
  id: string;
  to_id: number | null;
  net: number | null;
  stripe_routed_to: string;
}

/** this donation's dists settlement routed to a connected account and no
 * transfer has paid yet: what a redelivery still owes */
export async function dists_routed_untransferred(
  donation_id: string,
  conn: DbOrTx = db
): Promise<IDistAwaitingTransfer[]> {
  return conn
    .select({
      id: dists.id,
      to_id: dists.to_id,
      net: dists.net,
      // a text column needs no decoder, so the not-null filter can narrow it
      stripe_routed_to: sql<string>`${dists.stripe_routed_to}`,
    })
    .from(dists)
    .where(
      and(
        eq(dists.donation_id, donation_id),
        isNotNull(dists.stripe_routed_to),
        isNull(dists.stripe_transfer_id)
      )
    );
}

/** rebook a routed dist as pooled, only while no transfer has paid it. false
 * when it was already transferred, or never routed */
export async function dist_unroute(
  dist_id: string,
  conn: DbOrTx = db
): Promise<boolean> {
  const unrouted = await conn
    .update(dists)
    .set({ stripe_routed_to: null })
    .where(
      and(
        eq(dists.id, dist_id),
        isNotNull(dists.stripe_routed_to),
        isNull(dists.stripe_transfer_id)
      )
    )
    .returning({ id: dists.id });
  return unrouted.length > 0;
}

/** paginated donations received by npo */
export async function npo_donations(
  npo_id: number,
  opts?: IDonationsSearch
): Promise<IPage<INpoDonation>> {
  const { limit = 10, next, date_start, date_end } = opts || {};
  const cursor = decode_date_cursor(next);

  const rows = await dist_base()
    .where(
      and(
        eq(dists.to_id, npo_id),
        date_start
          ? gte(dists.date_created, new Date(date_start).toISOString())
          : undefined,
        date_end
          ? lte(dists.date_created, new Date(date_end).toISOString())
          : undefined,
        cursor ? sql`${dists.date_created} < ${cursor}` : undefined
      )
    )
    .orderBy(desc(dists.date_created))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows
    .slice(0, limit)
    .map((r) => to_npo_donation(r as JoinedRow));
  return {
    items,
    next: has_more
      ? encode_date_cursor(items[items.length - 1]?.date_created)
      : undefined,
  };
}

/** paginated donations by donor email */
export async function user_donations(
  email: string,
  opts?: IDonationsSearch
): Promise<IPage<INpoDonation>> {
  const { limit = 10, next, date_start, date_end } = opts || {};
  const cursor = decode_date_cursor(next);

  const rows = await dist_base()
    .where(
      and(
        eq(donation_donors.email, email),
        date_start
          ? gte(dists.date_created, new Date(date_start).toISOString())
          : undefined,
        date_end
          ? lte(dists.date_created, new Date(date_end).toISOString())
          : undefined,
        cursor ? sql`${dists.date_created} < ${cursor}` : undefined
      )
    )
    .orderBy(desc(dists.date_created))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows
    .slice(0, limit)
    .map((r) => to_npo_donation(r as JoinedRow));
  return {
    items,
    next: has_more
      ? encode_date_cursor(items[items.length - 1]?.date_created)
      : undefined,
  };
}

/** true once any dist row exists for this donation, whatever its status */
export async function donation_has_dists(
  donation_id: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: dists.id })
    .from(dists)
    .where(eq(dists.donation_id, donation_id))
    .limit(1);
  return !!row;
}

/** this donation's share for `to_id`, once it is distributed */
export async function dist_of(
  donation_id: string,
  to_id: number,
  conn: DbOrTx = db
): Promise<{ id: string; net: number | null } | undefined> {
  const [row] = await conn
    .select({ id: dists.id, net: dists.net })
    .from(dists)
    .where(and(eq(dists.donation_id, donation_id), eq(dists.to_id, to_id)));
  return row;
}

// -- refund support --

export interface DistRefundGraph {
  dist: DistRow;
  bal_txs: IBalanceTx[];
  rev_logs: (typeof rev_logs.$inferSelect)[];
  payout: typeof payouts.$inferSelect | undefined;
  commission: typeof referrer_commissions.$inferSelect | undefined;
}

/** fetch all dists for a donation with their downstream records for refund processing */
export async function dists_for_refund(
  donation_id: string
): Promise<DistRefundGraph[]> {
  const dist_rows = await db
    .select()
    .from(dists)
    .where(
      and(eq(dists.donation_id, donation_id), eq(dists.status, "settled"))
    );

  const results: DistRefundGraph[] = [];
  for (const dist of dist_rows) {
    const [bts, rls, [po], [comm]] = await Promise.all([
      db.select().from(bal_txs).where(eq(bal_txs.account_other_id, dist.id)),
      db.select().from(rev_logs).where(eq(rev_logs.donation_id, dist.id)),
      db
        .select()
        .from(payouts)
        .where(
          and(eq(payouts.source_id, dist.id), eq(payouts.source, "donation"))
        ),
      db
        .select()
        .from(referrer_commissions)
        .where(eq(referrer_commissions.donation_id, dist.id)),
    ]);
    results.push({
      dist,
      bal_txs: bts as IBalanceTx[],
      rev_logs: rls,
      payout: po,
      commission: comm,
    });
  }
  return results;
}

/**
 * true once any dist for this donation has a refund outcome recorded, whatever
 * its status — completed and loss flip a dist to refunded, while the donation
 * row can stay settled.
 */
export async function donation_refund_started(
  donation_id: string
): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(dists)
    .where(
      and(eq(dists.donation_id, donation_id), isNotNull(dists.refund_status))
    )
    .limit(1);
  return !!row;
}

/**
 * the dist's refund state, row-locked for the rest of the transaction. a
 * concurrent refund run holding the lock commits first, and this then reads
 * what it wrote.
 */
export async function dist_refund_state_locked(tx: DbOrTx, id: string) {
  const [row] = await tx
    .select({
      status: dists.status,
      refund_status: dists.refund_status,
      stripe_routed_to: dists.stripe_routed_to,
      refunds_cut_share: dists.refunds_cut_share,
    })
    .from(dists)
    .where(eq(dists.id, id))
    .for("update");
  return row;
}

/** the donation's dists still settled, failed reversals included */
export async function dists_settled_of(tx: DbOrTx, donation_id: string) {
  return tx
    .select({
      id: dists.id,
      status: dists.status,
      refund_status: dists.refund_status,
    })
    .from(dists)
    .where(
      and(eq(dists.donation_id, donation_id), eq(dists.status, "settled"))
    );
}

export async function dist_refund_update(
  db: DbOrTx,
  id: string,
  data: {
    refund_status: "completed" | "failed" | "loss";
    refund_error?: string;
  }
) {
  // failed dists keep status="settled" so they remain eligible for retry
  // (dists_for_refund filters status="settled"). completed/loss flip to
  // refunded. a failed write never lands on a dist a concurrent run already
  // reversed.
  const failed = data.refund_status === "failed";
  await db
    .update(dists)
    .set({ ...(!failed && { status: "refunded" as const }), ...data })
    .where(
      and(eq(dists.id, id), failed ? eq(dists.status, "settled") : undefined)
    );
}

/** paginated donations by npo referrer */
export async function referrer_donations(
  referrer: string,
  opts?: IPageOpts
): Promise<IPage<INpoDonation>> {
  const { limit = 10, next } = opts || {};
  const cursor = decode_date_cursor(next);

  const rows = await dist_base()
    .innerJoin(npos, eq(dists.to_id, npos.id))
    .where(
      and(
        or(eq(npos.referrer_user, referrer), eq(npos.referrer_npo, referrer)),
        cursor ? sql`${dists.date_created} < ${cursor}` : undefined
      )
    )
    .orderBy(desc(dists.date_created))
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const items = rows
    .slice(0, limit)
    .map((r) => to_npo_donation(r as JoinedRow));
  return {
    items,
    next: has_more
      ? encode_date_cursor(items[items.length - 1]?.date_created)
      : undefined,
  };
}
