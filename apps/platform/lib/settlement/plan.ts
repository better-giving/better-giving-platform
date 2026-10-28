import * as v from "valibot";
import type { IBalanceTx } from "../balance-txs";
import { fees } from "../constants";
import { default_allocation } from "../constants/common";
import type {
  IAllocation,
  IAmount,
  IDonation,
  IDonationDist,
  IToSettings,
  TToType,
} from "../donations";
import { amnt_sum, partition } from "../donations/helpers";
import { allocation } from "../donations/schema";
import { nav_log_date } from "../nav/log-date";
import type { IPayout } from "../payouts";
import { msg } from "../queue";
import type { IMsg } from "../queue/types";
import type { ICommission } from "../referrals";
import type { IRevenueLog } from "../revenue";
import type { IBalanceDeltas, IDistFees } from "../types/donation";
import type { IInput, IParts } from "../types/donation-dist";

export const referral_commission_rate = 0.3;

export interface NpoSettlementContext {
  id: number;
  name: string;
  fiscal_sponsored: boolean;
  hide_bg_tip: boolean | null | undefined;
  allocation: IAllocation | null | undefined;
  lock_units: number | null | undefined;
  liq: number | null | undefined;
  referrer_user: string | null | undefined;
  referrer_npo: string | null | undefined;
  referrer_expiry: string | null | undefined;
}

export interface NavLogEntry {
  reason: string;
  date: string;
  cash_delta: number;
  holder_deltas: { npo_id: number; units_delta: number }[];
}

/** what settlement books wherever the money lands */
interface IBooked {
  /** the dist row's id, which every record of the share points back to */
  dist_id: string;
  dist: IDonationDist;
  don: IDonation;
  revenue_logs: IRevenueLog[];
  commission: ICommission | null;
  msgs: IMsg[];
  /** the stored allocation couldn't be split, so net went to default_allocation */
  alloc_fell_back: boolean;
}

/** what bg books for a share it keeps: the npo's balances and a payout */
export interface IPooledBooking {
  balance_txs: IBalanceTx[];
  payout: IPayout | null;
  nav_log_entry: NavLogEntry | null;
  balance_deltas: IBalanceDeltas;
  /** the npo's notice of a lock purchase */
  msgs: IMsg[];
}

/** the money stays in bg's balance and reaches the npo as balances and a payout */
export interface PooledSettlementPlan
  extends IBooked,
    Omit<IPooledBooking, "msgs"> {
  kind: "pooled";
}

/** the money goes to the npo's connected stripe account in one transfer, so
 * nothing lands in bg's books for the npo: no payout, balance or investment */
export interface RoutedSettlementPlan extends IBooked {
  kind: "routed";
  /** the connected account (`acct_…`) the transfer pays */
  routed_to: string;
}

export type SettlementPlan = PooledSettlementPlan | RoutedSettlementPlan;

const ALL_CASH: IAllocation = { cash: 100, liq: 0, lock: 0 };

/**
 * stored allocation is unvalidated jsonb, and settlement must put exactly net
 * into buckets: a missing cash is the remainder; null when still not an allocation
 */
const settlement_allocation = (a: Partial<IAllocation>): IAllocation | null => {
  const liq = a.liq ?? 0;
  const lock = a.lock ?? 0;
  const r = v.safeParse(allocation, {
    liq,
    lock,
    cash: a.cash ?? 100 - liq - lock,
  });
  return r.success ? r.output : null;
};

/** the split a pooled share of an npo with `stored` lands in; `fell_back`
 * when `stored` couldn't be split, so it is default_allocation */
export const pooled_allocation = (
  stored: IAllocation | null | undefined
): { alloc: IAllocation; fell_back: boolean } => {
  const a = stored ? settlement_allocation(stored) : default_allocation;
  return { alloc: a ?? default_allocation, fell_back: a === null };
};

// [resulting balance, excess fa]
const credit_fa = (
  amount: number,
  { fa, pf }: { fa: number; pf: number }
): [number, number] => [fa ? amount + pf : amount, fa ? fa - pf : 0];

// [net after fees, fee amounts]
const debit_pcfs = (amount: number, rates: IDistFees): [number, IDistFees] => {
  const base = amount * rates.base;
  const fsa = amount * rates.fsa;
  return [amount - base - fsa, { base, fsa }];
};

/** a donation's parts as settlement splits them: the charged amount, its
 * settled net and the processor's fee, each in the donation's proportions */
export const settled_parts = (
  amount: IAmount,
  upusd: number,
  settled: { net: number; fee: number }
): IParts => {
  const parts = partition(amount);
  const total = amnt_sum(amount);
  const amnt = parts(total);
  const sttl = parts(settled.net);
  return {
    amnt,
    amnt_usd: parts(total / upusd),
    fa: parts(amnt.fee_allowance),
    sttl,
    sttl_fee: parts(settled.fee),
    sttl_fa: parts(sttl.fee_allowance),
  };
};

/** what one npo's share nets after the base and fiscal sponsor fees, and what
 * its tip credits bg. settlement books these; a quote previews them */
export const npo_share = (
  ps: IParts,
  ctx: Pick<NpoSettlementContext, "fiscal_sponsored" | "hide_bg_tip">
) => {
  const [fa_added, fa_excess] = credit_fa(ps.sttl.base, {
    fa: ps.sttl_fa.base,
    pf: ps.sttl_fee.base,
  });

  // tip goes to BG (non-fsa, base fee not applicable) — no further deductions
  const [tip, tip_fa_excess] = credit_fa(ps.sttl.tip, {
    fa: ps.sttl_fa.tip,
    pf: ps.sttl_fee.tip,
  });

  const [net, pcfs] = debit_pcfs(fa_added, {
    base: ctx.hide_bg_tip ? fees.base : 0,
    fsa: ctx.fiscal_sponsored ? fees.fiscal_sponsor : 0,
  });
  return { net, pcfs, fa_excess, tip, tip_fa_excess };
};

export const shared_parts = (obj: IParts, n: number): IParts => ({
  amnt: {
    base: obj.amnt.base / n,
    tip: obj.amnt.tip / n,
    fee_allowance: obj.amnt.fee_allowance / n,
  },
  amnt_usd: {
    base: obj.amnt_usd.base / n,
    tip: obj.amnt_usd.tip / n,
    fee_allowance: obj.amnt_usd.fee_allowance / n,
  },
  fa: {
    base: obj.fa.base / n,
    tip: obj.fa.tip / n,
    fee_allowance: obj.fa.fee_allowance / n,
  },
  sttl: {
    base: obj.sttl.base / n,
    tip: obj.sttl.tip / n,
    fee_allowance: obj.sttl.fee_allowance / n,
  },
  sttl_fee: {
    base: obj.sttl_fee.base / n,
    tip: obj.sttl_fee.tip / n,
    fee_allowance: obj.sttl_fee.fee_allowance / n,
  },
  sttl_fa: {
    base: obj.sttl_fa.base / n,
    tip: obj.sttl_fa.tip / n,
    fee_allowance: obj.sttl_fa.fee_allowance / n,
  },
});

/** @param routed_to - the npo's connected account when this share routes to
 * it, null to settle it pooled (`npo_plan` in `.server/settlement` decides) */
export function calc_settlement_plan(
  i: IInput,
  ctx: NpoSettlementContext,
  routed_to: null
): PooledSettlementPlan;
export function calc_settlement_plan(
  i: IInput,
  ctx: NpoSettlementContext,
  routed_to: string
): RoutedSettlementPlan;
export function calc_settlement_plan(
  i: IInput,
  ctx: NpoSettlementContext,
  routed_to: string | null
): SettlementPlan;
export function calc_settlement_plan(
  i: IInput,
  ctx: NpoSettlementContext,
  routed_to: string | null
): SettlementPlan {
  const { net, pcfs, fa_excess, tip, tip_fa_excess } = npo_share(i.ps, ctx);

  const pooled = pooled_allocation(ctx.allocation);
  const settings: IToSettings = {
    fiscal_sponsored: ctx.fiscal_sponsored,
    // a routed net leaves in one transfer, so none of it can be invested
    alloc: routed_to === null ? pooled.alloc : ALL_CASH,
  };

  const id = crypto.randomUUID();
  const date = new Date(i.sttl.date);

  const referrer_id = ctx.referrer_user ?? ctx.referrer_npo;
  const has_referrer =
    !!referrer_id &&
    !!ctx.referrer_expiry &&
    new Date(ctx.referrer_expiry) >= new Date();

  const cf_from_tip = has_referrer ? tip * referral_commission_rate : 0;
  const cf_from_base = has_referrer ? pcfs.base * referral_commission_rate : 0;
  const cf_from_fsa = has_referrer ? pcfs.fsa * referral_commission_rate : 0;
  const cf_total = cf_from_tip + cf_from_base + cf_from_fsa;

  const dist: IDonationDist = {
    id: i.sttl.id,
    gross: i.ps.sttl.base,
    net,
    currency: i.sttl.currency,
    fees: { ...pcfs, processing: i.ps.sttl_fee.base },
    fee_allowance: i.ps.sttl_fa.base,
    // recorded here and nowhere else. the npo is credited the full processing
    // fee either way (`credit_fa`), so a positive excess stays with bg
    // implicitly and a negative one is bg shouldering the gap — by design, not
    // a bug. neither side reaches a revenue log: the tip's `fa_excess` below
    // is a detail field on the tip log, not a booking, so there is no mirror
    // to copy. naming it would mean a new `RevenueType` (a check-constraint
    // migration in `.server/pg/schema/revenue.ts`), an `ILtdItems` bucket, the
    // admin revenue page, and two accounting calls the code does not answer:
    // whether a referrer commission applies to surplus allowance, and whether
    // the negative side is a loss log.
    fee_allowance_excess: fa_excess,
    parent: i.prnt,
    to_settings: settings,
  };
  if (i.source) dist.form_tag = i.source.tag;
  if (has_referrer && cf_total > 0 && referrer_id) {
    dist.referrer = {
      id: referrer_id,
      cf_from_fee: cf_from_fsa + cf_from_base,
      cf_from_tip,
    };
  }

  const don: IDonation = {
    id,
    // tip is extracted from donation
    amount: { tip: 0, fee_allowance: i.ps.fa.base, base: i.ps.amnt.base },
    created_at: date.toISOString(),
    to_id: ctx.id.toString(),
    to_name: ctx.name,
    to_type: "npo" satisfies TToType,
    to_tip_allowed: ctx.hide_bg_tip ?? false,
    // settlement records has empty to_members
    to_members: [],
    dist,
    form_id: i.source?.id,
    program: i.program,
    ...i.tx,
  };

  const revenue_logs: IRevenueLog[] = [];
  const tip_log: IRevenueLog | null =
    tip > 0
      ? {
          id: crypto.randomUUID(),
          status: "final",
          date: i.sttl.date,
          donation_id: id,
          npo_id: ctx.id,
          fund_id: null,
          npo_name: ctx.name,
          type: "tip",
          gross: tip,
          commission: cf_from_tip,
          revenue: tip - cf_from_tip,
          type_tip: {
            denom: i.tx.currency,
            input: i.ps.amnt.tip,
            input_usd: i.ps.amnt_usd.tip,
            pf: i.ps.sttl_fee.tip,
            fa_excess: tip_fa_excess,
          },
        }
      : null;
  if (tip_log) revenue_logs.push(tip_log);
  if (pcfs.base > 0) {
    revenue_logs.push({
      id: crypto.randomUUID(),
      status: "final",
      date: i.sttl.date,
      donation_id: id,
      npo_id: ctx.id,
      fund_id: null,
      npo_name: ctx.name,
      type: "base-fee",
      gross: pcfs.base,
      commission: cf_from_base,
      revenue: pcfs.base - cf_from_base,
    });
  }
  if (pcfs.fsa > 0) {
    revenue_logs.push({
      id: crypto.randomUUID(),
      status: "final",
      date: i.sttl.date,
      donation_id: id,
      npo_id: ctx.id,
      fund_id: null,
      npo_name: ctx.name,
      type: "fsa-fee",
      gross: pcfs.fsa,
      commission: cf_from_fsa,
      revenue: pcfs.fsa - cf_from_fsa,
    });
  }

  const commission: ICommission | null =
    has_referrer && cf_total > 0
      ? {
          date: date.toISOString(),
          referrer_user: ctx.referrer_user ?? undefined,
          referrer_npo: ctx.referrer_npo ?? undefined,
          donation_id: id,
          npo_id: ctx.id,
          amount: cf_total,
          status: "pending",
        }
      : null;

  const tip_msgs: IMsg[] = tip_log
    ? [
        msg("tip-received", {
          id: tip_log.id,
          date: tip_log.date,
          npo_name: ctx.name,
          npo_id: ctx.id,
          is_recurring: don.frequency !== "one-time",
          type_tip: tip_log.type_tip!,
        }),
      ]
    : [];

  // the dist row takes the don's id
  const dist_id = don.id;
  if (routed_to !== null) {
    return {
      kind: "routed",
      routed_to,
      dist_id,
      dist,
      don,
      revenue_logs,
      commission,
      msgs: [
        ...tip_msgs,
        don_dist_msg(i, ctx, don, dist),
        transfer_msg(i, dist_id),
      ],
      alloc_fell_back: false,
    };
  }

  const { msgs: lock_msgs, ...booking } = pooled_booking({
    net,
    alloc: settings.alloc,
    nav_price: i.nav_price,
    npo: ctx,
    dist_id,
    date: don.created_at,
  });

  return {
    kind: "pooled",
    dist_id,
    dist,
    don,
    revenue_logs,
    commission,
    ...booking,
    msgs: [...tip_msgs, ...lock_msgs, don_dist_msg(i, ctx, don, dist)],
    alloc_fell_back: pooled.fell_back,
  };
}

interface IPooledShare {
  net: number;
  /** a resolved split (`pooled_allocation`) */
  alloc: IAllocation;
  nav_price: number;
  npo: Pick<NpoSettlementContext, "id" | "lock_units" | "liq">;
  dist_id: string;
  /** the share's settlement date */
  date: string;
}

/** what bg books for `net` of a share it keeps, split by `alloc` */
export function pooled_booking({
  net,
  alloc,
  nav_price,
  npo,
  dist_id,
  date,
}: IPooledShare): IPooledBooking {
  const net_alloc: IAllocation = {
    cash: (alloc.cash / 100) * net,
    liq: (alloc.liq / 100) * net,
    lock: (alloc.lock / 100) * net,
  };

  const balance_deltas: IBalanceDeltas = {
    liq: net_alloc.liq,
    lock: net_alloc.lock,
    lock_units: net_alloc.lock ? net_alloc.lock / nav_price : 0,
    cash: net_alloc.cash,
  };

  const balance_txs: IBalanceTx[] = [];
  const msgs: IMsg[] = [];

  let nav_log_entry: NavLogEntry | null = null;

  if (net_alloc.lock || net_alloc.liq) {
    const lock_units = npo.lock_units ?? 0;
    const liq = npo.liq ?? 0;

    if (net_alloc.lock) {
      const purchased_units = net_alloc.lock / nav_price;

      // new investments are allocated to cash portion and rebalanced later.
      // load-bearing: distinct per call so batch settlements get distinct ordering timestamps
      nav_log_entry = {
        reason: `npo:${npo.id} donation allocation to lock`,
        date: nav_log_date(),
        cash_delta: net_alloc.lock,
        holder_deltas: [{ npo_id: npo.id, units_delta: purchased_units }],
      };

      const lock_tx: IBalanceTx = {
        id: crypto.randomUUID(),
        date_created: date,
        date_updated: date,
        npo_id: npo.id,
        account: "lock",
        bal_begin: lock_units,
        bal_end: lock_units + purchased_units,
        amount: net_alloc.lock,
        amount_units: purchased_units,
        status: "final",
        account_other_id: dist_id,
        account_other: "donation",
        account_other_bal_begin: net_alloc.lock,
        account_other_bal_end: 0,
      };
      balance_txs.push(lock_tx);
      msgs.push(
        msg("lock-tx-created", {
          npo_id: lock_tx.npo_id,
          account: lock_tx.account,
          account_other: lock_tx.account_other!,
          bal_begin: lock_tx.bal_begin,
          bal_end: lock_tx.bal_end,
          amount: lock_tx.amount,
          date_created: lock_tx.date_created,
        })
      );
    }

    if (net_alloc.liq) {
      balance_txs.push({
        id: crypto.randomUUID(),
        date_created: date,
        date_updated: date,
        npo_id: npo.id,
        account: "liq",
        bal_begin: liq,
        bal_end: liq + net_alloc.liq,
        amount: net_alloc.liq,
        amount_units: net_alloc.liq,
        status: "final",
        account_other_id: dist_id,
        account_other: "donation",
        account_other_bal_begin: net_alloc.liq,
        account_other_bal_end: 0,
      });
    }
  }

  const payout: IPayout | null =
    net_alloc.cash > 0
      ? {
          id: crypto.randomUUID(),
          source_id: dist_id,
          npo_id: npo.id,
          source: "donation",
          date,
          amount: net_alloc.cash,
          type: "pending",
        }
      : null;

  return { balance_txs, payout, nav_log_entry, balance_deltas, msgs };
}

const don_dist_msg = (
  i: IInput,
  ctx: NpoSettlementContext,
  don: IDonation,
  dist: IDonationDist
): IMsg =>
  msg("don-dist", {
    id: don.id,
    date_created: don.created_at,
    amount: don.amount.base,
    amount_usd: don.amount.base / don.upusd,
    amount_denom: don.currency,
    frequency: don.frequency,
    via: don.via,
    source: don.source,
    to_id: ctx.id,
    to_name: ctx.name,
    net: dist.net,
    sttl_date: don.created_at,
    from_email: don.from_email,
    from: {
      name: don.from_name,
      company: don.from_company_name,
      // the same fields the receipt prints. every part is optional and the
      // consumer joins whatever is present, so a donor who gave no address
      // renders as none rather than as a row of separators.
      address: {
        street: don.from_addr_street,
        city: don.from_addr_city,
        state: don.from_addr_state,
        zip: don.from_addr_zip_code,
        country: don.from_addr_country,
      },
    },
    program: don.program,
    form: i.source,
  });

/** the transfer owed to the routed dist `dist_id` of `i`'s share */
export const transfer_msg = (i: IInput, dist_id: string): IMsg =>
  msg("connect-transfer", {
    dist_id,
    donation_id: i.prnt.id,
    // the stripe rail's settlement id is the payment intent's
    intent_id: i.sttl.id,
  });
