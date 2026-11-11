import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { IDonation } from "@/donations";
import {
  type ISub,
  monthly_amount,
  type TInterval,
  type TPlatform,
  type TStatus,
} from "@/subscriptions";
import { db } from "../db";
import { pg_text_to_iso } from "../schema/columns";
import { dists } from "../schema/dist";
import {
  donation_donors,
  donation_settlements,
  donations,
} from "../schema/donation";
import { subscriptions } from "../schema/subscription";
import type { DbOrTx, IPage } from "./helpers";
import { decode_cursor, encode_cursor } from "./helpers";

export async function sub_get(id: string): Promise<ISub | undefined> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id));
  return row;
}

/** the donor's subscriptions; `from_id` keeps the case checkout sent, so the match ignores it */
export async function sub_user_list(
  email: string,
  status?: TStatus
): Promise<ISub[]> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        // matches the expression subscriptions_from_id_lower_status_idx is built on
        sql`lower(${subscriptions.from_id}) = lower(${email})`,
        status ? eq(subscriptions.status, status) : undefined
      )
    )
    .orderBy(desc(subscriptions.created_at));
  return rows;
}

/** idempotent — fails silently if id exists */
export async function sub_put(db: DbOrTx, data: ISub) {
  await db.insert(subscriptions).values(data).onConflictDoNothing();
}

export async function sub_update(
  db: DbOrTx,
  id: string,
  data: Partial<Omit<ISub, "id">>
): Promise<{ row: ISub | undefined; prev_status: string | undefined }> {
  // detect active→inactive for platform cancellation
  const needs_deactivation_event = data.status === "inactive";
  let prev_status: string | undefined;

  if (needs_deactivation_event) {
    const [prev] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.id, id));
    prev_status = prev?.status ?? undefined;
  }

  const [row] = await db
    .update(subscriptions)
    .set({ ...data, updated_at: new Date().toISOString() })
    .where(eq(subscriptions.id, id))
    .returning();

  return { row, prev_status };
}

/** sets the cancel reason only where none is recorded yet, in one statement */
export async function sub_cancel_reason_default(
  db: DbOrTx,
  id: string,
  reason: string
) {
  await db
    .update(subscriptions)
    .set({
      status_cancel_reason: sql`coalesce(${subscriptions.status_cancel_reason}, ${reason})`,
    })
    .where(eq(subscriptions.id, id));
}

/**
 * reactivates a row only while it still carries `pending_reason`, in one
 * statement: a cancel that lands meanwhile overwrites the reason and wins.
 * `cancelled_at`, when given, is that one cancel's `cancel_requested_at`, so an
 * older job can't undo a newer cancel that reused the reason. true when this
 * call is the one that reactivated it.
 */
export async function sub_reactivate_if(
  db: DbOrTx,
  id: string,
  pending_reason: string,
  cancelled_at?: string
): Promise<boolean> {
  const rows = await db
    .update(subscriptions)
    .set({
      status: "active",
      status_cancel_reason: null,
      cancel_requested_at: null,
      updated_at: new Date().toISOString(),
    })
    .where(
      and(
        eq(subscriptions.id, id),
        eq(subscriptions.status, "inactive"),
        eq(subscriptions.status_cancel_reason, pending_reason),
        cancelled_at
          ? eq(subscriptions.cancel_requested_at, cancelled_at)
          : undefined
      )
    )
    .returning({ id: subscriptions.id });
  return rows.length > 0;
}

// -- npo subscriber queries --

export interface INpoSubDetail {
  id: string;
  amount_usd: number;
  interval: TInterval;
  interval_count: number;
  status: TStatus;
  platform: TPlatform;
  next_billing: string;
}

export interface INpoSubscriber {
  from_email: string;
  from_name: string | null;
  /** total monthly usd across all active subs */
  monthly_usd: number;
  /** number of active subscriptions */
  active_count: number;
  /** earliest subscription created_at */
  since: string;
  /** has any inactive subscription */
  has_inactive: boolean;
  /** subscription ids for this donor+npo */
  sub_ids: string[];
  /** soonest next_billing among active subs */
  next_billing: string | null;
  /** per-sub breakdown for composition tooltip */
  subs: INpoSubDetail[];
}

interface INpoSubsOpts {
  limit?: number;
  next?: string;
}

/** paginated subscribers (grouped by donor) for an npo */
export async function npo_subscriptions(
  npo_id: number,
  opts?: INpoSubsOpts
): Promise<IPage<INpoSubscriber>> {
  const { limit = 10, next } = opts || {};
  const cursor = next ? decode_cursor(next) : undefined;

  const rows = await db
    .select({
      from_id: subscriptions.from_id,
      since: sql`min(${subscriptions.created_at})`.mapWith(
        subscriptions.created_at
      ),
      active_count: sql<number>`count(*) filter (where ${subscriptions.status} = 'active')::int`,
      has_inactive: sql<boolean>`bool_or(${subscriptions.status} = 'inactive')`,
      monthly_usd: sql<number>`coalesce(sum(
        case when ${subscriptions.status} = 'active' then
          ${subscriptions.amount_usd}
          * case ${subscriptions.interval}
              when 'day' then 30
              when 'week' then 4.33
              when 'month' then 1
              when 'year' then 1.0/12
            end
          / ${subscriptions.interval_count}
        else 0 end
      ), 0)::float8`,
      sub_ids: sql<
        string[]
      >`array_agg(${subscriptions.id} order by ${subscriptions.created_at})`,
      next_billing:
        sql`min(${subscriptions.next_billing}) filter (where ${subscriptions.status} = 'active')`
          .mapWith(subscriptions.next_billing)
          .as<string | null>(),
      subs: sql<INpoSubDetail[]>`json_agg(json_build_object(
        'id', ${subscriptions.id},
        'amount_usd', ${subscriptions.amount_usd}::float8,
        'interval', ${subscriptions.interval},
        'interval_count', ${subscriptions.interval_count},
        'status', ${subscriptions.status},
        'platform', ${subscriptions.platform},
        'next_billing', ${subscriptions.next_billing}
      ) order by ${subscriptions.created_at})`,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.to_npo_id, npo_id),
        cursor?.from_id
          ? sql`${subscriptions.from_id} > ${cursor.from_id as string}`
          : undefined
      )
    )
    .groupBy(subscriptions.from_id)
    .orderBy(subscriptions.from_id)
    .limit(limit + 1);

  const has_more = rows.length > limit;
  const sliced = rows.slice(0, limit);

  // resolve donor names
  const emails = sliced.map((r) => r.from_id);
  const donors =
    emails.length > 0
      ? await db
          .selectDistinct({
            email: donation_donors.email,
            name: donation_donors.name,
          })
          .from(donation_donors)
          .where(inArray(donation_donors.email, emails))
      : [];
  const name_map = new Map(donors.map((d) => [d.email, d.name]));

  const items: INpoSubscriber[] = sliced.map((r) => ({
    from_email: r.from_id,
    from_name: name_map.get(r.from_id) ?? null,
    monthly_usd: Math.round(r.monthly_usd * 100) / 100,
    active_count: r.active_count,
    since: r.since,
    has_inactive: r.has_inactive,
    sub_ids: r.sub_ids,
    next_billing: r.next_billing,
    // json_agg bypasses column decoders
    subs: r.subs.map((s) => ({
      ...s,
      next_billing: pg_text_to_iso(s.next_billing),
    })),
  }));

  return {
    items,
    next: has_more
      ? encode_cursor({ from_id: sliced[sliced.length - 1]?.from_id })
      : undefined,
  };
}

/** dist history; subscription_id is null for one-time donations */
export interface ISubDist {
  id: string;
  subscription_id: string | null;
  date_created: string;
  amount: number | null;
  amount_denom: string;
  amount_usd: number | null;
  /** donor-side tip in presentment currency (BG revenue, not npo-credit) */
  amount_tip: number | null;
  /** donor-side tip in usd (BG revenue, not npo-credit) */
  amount_tip_usd: number | null;
  /** donor-side fee allowance in usd (covers processor fee, not npo-credit) */
  amount_fee_allowance_usd: number | null;
  net: number | null;
  fee_base: number | null;
  fee_fsa: number | null;
  fee_processing: number | null;
  fee_allowance: number | null;
  status: string;
  /** the parent donation's status; see `INpoDonation.donation_status` */
  donation_status: IDonation["status"];
  sttl_date: string | null;
}

// donations.status is untyped text in the schema; the check constraint holds it to the union
const donation_status = sql<IDonation["status"]>`${donations.status}`;

export async function subscription_dists(
  npo_id: number,
  sub_ids: string[]
): Promise<ISubDist[]> {
  if (sub_ids.length === 0) return [];
  const rows = await db
    .select({
      id: dists.id,
      subscription_id: donations.subscription_id,
      date_created: dists.date_created,
      amount: dists.amount,
      amount_denom: donations.currency,
      amount_usd: dists.amount_usd,
      amount_tip: donations.amount_tip,
      amount_tip_usd: sql<number>`(${donations.amount_tip} / NULLIF(${donations.upusd}, 0))::float8`,
      amount_fee_allowance_usd: sql<number>`(${donations.amount_fee_allowance} / NULLIF(${donations.upusd}, 0))::float8`,
      net: dists.net,
      fee_base: dists.fee_base,
      fee_fsa: dists.fee_fsa,
      fee_processing: dists.fee_processing,
      fee_allowance: dists.fee_allowance,
      status: dists.status,
      donation_status,
      sttl_date: donation_settlements.date,
    })
    .from(donations)
    .innerJoin(dists, eq(dists.donation_id, donations.id))
    .innerJoin(subscriptions, eq(subscriptions.id, donations.subscription_id))
    .leftJoin(
      donation_settlements,
      eq(donations.id, donation_settlements.donation_id)
    )
    .where(
      and(
        eq(subscriptions.to_npo_id, npo_id),
        inArray(donations.subscription_id, sub_ids)
      )
    )
    .orderBy(desc(dists.date_created));

  return rows;
}

export interface INpoSubSummary {
  /** total expected billing for the period (active sched + inactive billed) */
  expected_usd: number;
  /** amount included in expected_usd from subs cancelled within the period */
  cancelled_billed_usd: number;
  /** monthly-equivalent net mrr change for the period (new_usd - cancelled_usd) */
  net_new_usd: number;
  /** monthly-equivalent mrr gained from new subs in period */
  new_usd: number;
  /** monthly-equivalent mrr lost from subs cancelled in period (approx via updated_at) */
  cancelled_usd: number;
  /** subs created within the period */
  new_count: number;
  /** subs transitioned to inactive within the period (approx — uses updated_at) */
  cancelled_count: number;
}

/** period-aware summary: expected billing + net new subscribers */
export async function npo_subscription_summary(
  npo_id: number,
  period: TPeriod
): Promise<INpoSubSummary> {
  const { start, end } = period_range(period);
  const start_iso = start.toISOString();
  const end_iso = end.toISOString();

  const [
    active_rows,
    inactive_rows,
    cancelled_billed_row,
    new_row,
    cancelled_row,
  ] = await Promise.all([
    db
      .select({
        next_billing: subscriptions.next_billing,
        interval: subscriptions.interval,
        interval_count: subscriptions.interval_count,
        amount_usd: subscriptions.amount_usd,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.to_npo_id, npo_id),
          eq(subscriptions.status, "active")
        )
      ),
    // inactive subs: their actual in-period billings count toward expected
    db
      .select({
        total: sql<number>`coalesce(sum(${dists.amount_usd}), 0)::float8`,
      })
      .from(donations)
      .innerJoin(dists, eq(dists.donation_id, donations.id))
      .innerJoin(subscriptions, eq(subscriptions.id, donations.subscription_id))
      .where(
        and(
          eq(subscriptions.to_npo_id, npo_id),
          eq(subscriptions.status, "inactive"),
          sql`${dists.date_created} >= ${start_iso}`,
          sql`${dists.date_created} < ${end_iso}`
        )
      ),
    // amount of expected_usd attributable to subs cancelled within the period
    db
      .select({
        total: sql<number>`coalesce(sum(${dists.amount_usd}), 0)::float8`,
      })
      .from(donations)
      .innerJoin(dists, eq(dists.donation_id, donations.id))
      .innerJoin(subscriptions, eq(subscriptions.id, donations.subscription_id))
      .where(
        and(
          eq(subscriptions.to_npo_id, npo_id),
          eq(subscriptions.status, "inactive"),
          sql`${subscriptions.updated_at} >= ${start_iso}`,
          sql`${subscriptions.updated_at} < ${end_iso}`,
          sql`${dists.date_created} >= ${start_iso}`,
          sql`${dists.date_created} < ${end_iso}`
        )
      ),
    // subs created within the period
    db
      .select({
        amount_usd: subscriptions.amount_usd,
        interval: subscriptions.interval,
        interval_count: subscriptions.interval_count,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.to_npo_id, npo_id),
          sql`${subscriptions.created_at} >= ${start_iso}`,
          sql`${subscriptions.created_at} < ${end_iso}`
        )
      ),
    // subs transitioned to inactive within the period (approx via updated_at)
    db
      .select({
        amount_usd: subscriptions.amount_usd,
        interval: subscriptions.interval,
        interval_count: subscriptions.interval_count,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.to_npo_id, npo_id),
          eq(subscriptions.status, "inactive"),
          sql`${subscriptions.updated_at} >= ${start_iso}`,
          sql`${subscriptions.updated_at} < ${end_iso}`
        )
      ),
  ]);

  let expected_usd = 0;
  for (const s of active_rows) {
    const n = count_invoices_in_period(
      s.next_billing,
      s.interval,
      s.interval_count,
      start,
      end
    );
    expected_usd += n * s.amount_usd;
  }
  expected_usd += inactive_rows[0]?.total ?? 0;

  const sum_monthly = (rows: typeof new_row) =>
    rows.reduce(
      (acc, r) =>
        acc + monthly_amount(r.amount_usd, r.interval, r.interval_count),
      0
    );
  const new_usd = sum_monthly(new_row);
  const cancelled_usd = sum_monthly(cancelled_row);

  return {
    expected_usd: Math.round(expected_usd * 100) / 100,
    cancelled_billed_usd:
      Math.round((cancelled_billed_row[0]?.total ?? 0) * 100) / 100,
    net_new_usd: Math.round((new_usd - cancelled_usd) * 100) / 100,
    new_usd: Math.round(new_usd * 100) / 100,
    cancelled_usd: Math.round(cancelled_usd * 100) / 100,
    new_count: new_row.length,
    cancelled_count: cancelled_row.length,
  };
}

// -- trailing 12-month MRR + net-new MRR trends (KPI sparklines) --

export interface INpoSubTrends {
  /** monthly active MRR snapshot, oldest..current (12 entries) */
  trend_mrr: number[];
  /** monthly net new MRR (new − cancelled), oldest..current (12 entries) */
  trend_net_new: number[];
}

export async function npo_subscription_trends(
  npo_id: number
): Promise<INpoSubTrends> {
  // case expression normalizing amount_usd × interval → monthly equivalent
  const monthly_sql = sql`s.amount_usd * case s.interval
        when 'day' then 30
        when 'week' then 4.33
        when 'month' then 1
        when 'year' then 1.0/12
      end / s.interval_count`;

  const { rows } = await db.execute(sql`
    with months as (
      select generate_series(
        date_trunc('month', now()) - interval '11 months',
        date_trunc('month', now()),
        interval '1 month'
      )::date as m
    ),
    active_mrr as (
      select m.m as bucket,
        coalesce(sum(${monthly_sql}) filter (
          where s.status = 'active'
             or s.updated_at > (m.m + interval '1 month')
        ), 0)::float8 as mrr
      from months m
      left join ${subscriptions} s
        on s.to_npo_id = ${npo_id}
       and s.created_at <= (m.m + interval '1 month')
      group by m.m
    ),
    new_mrr as (
      select date_trunc('month', s.created_at)::date as bucket,
        coalesce(sum(${monthly_sql}), 0)::float8 as amt
      from ${subscriptions} s
      where s.to_npo_id = ${npo_id}
        and s.created_at >= date_trunc('month', now()) - interval '11 months'
      group by 1
    ),
    cancelled_mrr as (
      select date_trunc('month', s.updated_at)::date as bucket,
        coalesce(sum(${monthly_sql}), 0)::float8 as amt
      from ${subscriptions} s
      where s.to_npo_id = ${npo_id}
        and s.status = 'inactive'
        and s.updated_at >= date_trunc('month', now()) - interval '11 months'
      group by 1
    )
    select
      to_char(months.m, 'YYYY-MM') as bucket,
      active_mrr.mrr,
      coalesce(new_mrr.amt, 0) - coalesce(cancelled_mrr.amt, 0) as net_new
    from months
    left join active_mrr on active_mrr.bucket = months.m
    left join new_mrr on new_mrr.bucket = months.m
    left join cancelled_mrr on cancelled_mrr.bucket = months.m
    order by months.m asc
  `);

  const arr = rows as unknown as {
    bucket: string;
    mrr: number;
    net_new: number;
  }[];
  return {
    trend_mrr: arr.map((r) => Math.round((r.mrr ?? 0) * 100) / 100),
    trend_net_new: arr.map((r) => Math.round((r.net_new ?? 0) * 100) / 100),
  };
}

// -- billing progress --

export type TPeriod = "week" | "month" | "year";

export interface IBillingProgress {
  /** amount billed (settled) in the period */
  billed_usd: number;
  /** expected invoice amount for the period based on billing schedules */
  expected_usd: number;
}

const INTERVAL_DAYS: Record<TInterval, number> = {
  day: 1,
  week: 7,
  month: 30.44,
  year: 365.25,
};

function period_range(period: TPeriod): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "week": {
      const day = now.getDay();
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - day
      );
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { start, end };
    }
    case "year": {
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear() + 1, 0, 1),
      };
    }
  }
}

/** count invoices falling in [start, end) for a sub based on next_billing and interval */
function count_invoices_in_period(
  next_billing: string,
  interval: TInterval,
  interval_count: number,
  start: Date,
  end: Date
): number {
  const nb = new Date(next_billing).getTime();
  const interval_ms = INTERVAL_DAYS[interval] * interval_count * 86400000;
  const start_ms = start.getTime();
  const end_ms = end.getTime();

  let count = 0;
  // backward from nb (k=0 inclusive)
  for (let k = 0; ; k++) {
    const d = nb - k * interval_ms;
    if (d < start_ms) break;
    if (d < end_ms) count++;
  }
  // forward (k=1,…) — strictly after nb to avoid double-counting
  for (let k = 1; ; k++) {
    const d = nb + k * interval_ms;
    if (d >= end_ms) break;
    if (d >= start_ms) count++;
  }
  return count;
}

/** billing progress for a donor's subscriptions in a given period */
export async function donor_billing_progress(
  sub_ids: string[],
  subs: INpoSubDetail[],
  period: TPeriod
): Promise<IBillingProgress> {
  if (sub_ids.length === 0) return { billed_usd: 0, expected_usd: 0 };

  const { start, end } = period_range(period);
  const start_iso = start.toISOString();
  const end_iso = end.toISOString();

  const active_subs = subs.filter((s) => s.status === "active");
  const inactive_ids = subs
    .filter((s) => s.status !== "active")
    .map((s) => s.id);

  // active subs: expected from billing schedule
  let expected_usd = 0;
  for (const s of active_subs) {
    const n = count_invoices_in_period(
      s.next_billing,
      s.interval,
      s.interval_count,
      start,
      end
    );
    expected_usd += n * s.amount_usd;
  }

  // inactive subs: actual billed in period counts as expected
  // (invoices were expected before cancellation)
  const inactive_billed =
    inactive_ids.length > 0
      ? await db
          .select({
            total: sql<number>`coalesce(sum(${dists.amount_usd}), 0)::float8`,
          })
          .from(donations)
          .innerJoin(dists, eq(dists.donation_id, donations.id))
          .where(
            and(
              inArray(donations.subscription_id, inactive_ids),
              sql`${dists.date_created} >= ${start_iso}`,
              sql`${dists.date_created} < ${end_iso}`
            )
          )
      : [{ total: 0 }];
  expected_usd += inactive_billed[0]?.total ?? 0;

  // billed: sum of all settled donation amounts in the period
  const [billed_row] = await db
    .select({
      total: sql<number>`coalesce(sum(${dists.amount_usd}), 0)::float8`,
    })
    .from(donations)
    .innerJoin(dists, eq(dists.donation_id, donations.id))
    .where(
      and(
        inArray(donations.subscription_id, sub_ids),
        sql`${dists.date_created} >= ${start_iso}`,
        sql`${dists.date_created} < ${end_iso}`
      )
    );

  return {
    billed_usd: Math.round((billed_row?.total ?? 0) * 100) / 100,
    expected_usd: Math.round(expected_usd * 100) / 100,
  };
}

// -- donor detail --

export interface IDonorDetail {
  email: string;
  name: string | null;
  monthly_usd: number;
  since: string;
  subs: (ISub & { monthly_usd_normalized: number })[];
  dists: ISubDist[];
  /** sum of normalized monthly amounts for active subs in current month with no settled dist (mirrors stewardship chart pending bar) */
  pend_month: number;
  /** sum of normalized monthly amounts for active subs across current+future months in current year with no settled dist (mirrors stewardship chart pending bars) */
  pend_year: number;
}

/** full donor detail for a specific donor+npo pair */
export async function donor_detail(
  npo_id: number,
  email: string
): Promise<IDonorDetail | undefined> {
  const [subs, dist_rows, donor_rows] = await Promise.all([
    db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.to_npo_id, npo_id),
          eq(subscriptions.from_id, email)
        )
      )
      .orderBy(desc(subscriptions.created_at)),
    // all dists for this donor at this npo — includes one-time + subscription
    db
      .select({
        id: dists.id,
        subscription_id: donations.subscription_id,
        date_created: dists.date_created,
        amount: dists.amount,
        amount_denom: donations.currency,
        amount_usd: dists.amount_usd,
        amount_tip: donations.amount_tip,
        amount_tip_usd: sql<number>`(${donations.amount_tip} / NULLIF(${donations.upusd}, 0))::float8`,
        amount_fee_allowance_usd: sql<number>`(${donations.amount_fee_allowance} / NULLIF(${donations.upusd}, 0))::float8`,
        net: dists.net,
        fee_base: dists.fee_base,
        fee_fsa: dists.fee_fsa,
        fee_processing: dists.fee_processing,
        fee_allowance: dists.fee_allowance,
        status: dists.status,
        donation_status,
        sttl_date: donation_settlements.date,
      })
      .from(dists)
      .innerJoin(donations, eq(donations.id, dists.donation_id))
      .innerJoin(donation_donors, eq(donation_donors.donation_id, donations.id))
      .leftJoin(
        donation_settlements,
        eq(donations.id, donation_settlements.donation_id)
      )
      .where(and(eq(dists.to_id, npo_id), eq(donation_donors.email, email)))
      .orderBy(desc(dists.date_created)),
    db
      .selectDistinct({ name: donation_donors.name })
      .from(donation_donors)
      .where(eq(donation_donors.email, email)),
  ]);

  if (subs.length === 0 && dist_rows.length === 0) return undefined;

  const name = donor_rows[0]?.name ?? null;
  // earliest activity: oldest sub or oldest dist
  const oldest_sub = subs.length ? subs[subs.length - 1].created_at : null;
  const oldest_dist = dist_rows.length
    ? dist_rows[dist_rows.length - 1].date_created
    : null;
  const since =
    oldest_sub && oldest_dist
      ? oldest_sub < oldest_dist
        ? oldest_sub
        : oldest_dist
      : (oldest_sub ?? oldest_dist ?? new Date().toISOString());

  let monthly_usd = 0;
  const enriched = subs.map((s) => {
    const norm =
      s.status === "active"
        ? monthly_amount(s.amount_usd, s.interval, s.interval_count)
        : 0;
    monthly_usd += norm;
    return { ...s, monthly_usd_normalized: Math.round(norm * 100) / 100 };
  });

  const settled = dist_rows.filter((d) => d.status === "settled");
  const pend_month = donor_pending_usd(enriched, settled, "month");
  const pend_year = donor_pending_usd(enriched, settled, "year");

  return {
    email,
    name,
    monthly_usd: Math.round(monthly_usd * 100) / 100,
    since,
    subs: enriched,
    dists: dist_rows,
    pend_month,
    pend_year,
  };
}

// mirrors stewardship chart pending bars: active subs, current+future
// months in current year, excluding months with a settled dist.
function donor_pending_usd(
  subs: ISub[],
  settled: ISubDist[],
  period: "month" | "year"
): number {
  const now = new Date();
  const cur_m = now.getMonth();
  const year = now.getFullYear();
  const months =
    period === "month"
      ? [cur_m]
      : Array.from({ length: 12 - cur_m }, (_, i) => cur_m + i);

  let total = 0;
  for (const mi of months) {
    const m_start = new Date(year, mi, 1).getTime();
    const m_end = new Date(year, mi + 1, 1).getTime();
    for (const s of subs) {
      if (s.status !== "active") continue;
      if (new Date(s.created_at).getTime() >= m_end) continue;
      const has_dist = settled.some((d) => {
        if (d.subscription_id !== s.id) return false;
        const t = new Date(d.sttl_date ?? d.date_created).getTime();
        return t >= m_start && t < m_end;
      });
      if (has_dist) continue;
      total += monthly_amount(s.amount_usd, s.interval, s.interval_count);
    }
  }
  return Math.round(total * 100) / 100;
}
