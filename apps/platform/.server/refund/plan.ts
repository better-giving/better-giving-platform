import type { IBalanceTx } from "@/balance-txs";
import { humanize } from "@/helpers/decimal";
import { is_unsent } from "@/payouts";
import type { ILossLog } from "@/revenue/interfaces";
import type { IBalanceDeltas } from "@/types/donation";
import type { IOwedRecord, OwedParty } from "../pg/queries/owed";

export interface PreviewLine {
  label: string;
  pass: boolean;
  reason?: string;
}

export interface RefundDistInput {
  id: string;
  donation_id: string;
  to_id: number;
  to_name: string;
  alloc: { liq?: number; lock?: number; cash?: number };
  net: number;
  amount: number;
  /** null on legacy rows that predate it */
  amount_usd: number | null;
  fee_base: number;
  fee_fsa: number;
  fee_processing: number;
  /** 0 or absent when the donor didn't cover fees */
  fee_allowance?: number;
  /** the share of the charge its refunds had taken off `net` when a refused
   * transfer rebooked it pooled; null or absent when nothing was cut */
  refunds_cut_share?: number | null;
  /** the settled net stored when that rebook cut refunds off `net`; null or
   * absent when nothing was cut and `net` is that settled net */
  settled_net?: number | null;
  /** settled to a connected account: its net leaves in a stripe transfer,
   * once `transferred`, so no balance, investment or payout of it is ours to
   * take back */
  routed?: { transferred: boolean };
}

export type ReferrerParty = Exclude<OwedParty, { npo_id: number }>;

/** the party a commission row names: exactly one is set, by its check */
export const referrer_of = (c: {
  referrer_user?: string | null;
  referrer_npo?: string | null;
}): ReferrerParty =>
  c.referrer_user != null
    ? { referrer_user: c.referrer_user }
    : { referrer_npo: c.referrer_npo! };

export interface RefundInputs {
  dist: RefundDistInput;
  payout: { id: string; type: string | null } | null;
  /** keyed by the dist's id; `amount` in usd */
  commission: {
    donation_id: string;
    amount: number;
    status: string;
    referrer: ReferrerParty;
  } | null;
  rev_log_ids: string[];
  bal: { liq: number; lock_units: number; cash: number };
  nav: { price: number } | null;
  sub_id: string | null;
  /** section 4(h) take-backs — savings, investment, a grant not yet paid —
   * apply only to a donation made on or after the recovery cutoff. absent,
   * they do: a caller that has not dated the gift leaves today's behavior */
  recovery_applies?: boolean;
}

export interface RefundCtx {
  now: string;
  /**
   * separate from `now` because `nav_logs.date` is that table's primary key,
   * and a fund refund plans one distribution at a time — two of them reaching
   * `new Date()` inside the same millisecond would collide. the caller mints
   * this through `nav_log_date`; everything else here can share `now`.
   */
  nav_date: string;
  form_id: string | null;
  program_id: string | null;
}

export interface NavLogAppend {
  reason: string;
  date: string;
  cash_delta: number;
  holder_deltas: { npo_id: number; units_delta: number }[];
}

// effects are emitted in execution order; walker dispatches one PG call per effect.
export type RefundEffect =
  | { kind: "balance_update"; npo_id: number; deltas: IBalanceDeltas }
  | { kind: "bal_tx_put"; tx: IBalanceTx }
  | { kind: "nav_log"; entry: NavLogAppend }
  | {
      kind: "payout_status";
      payout_id: string;
      status: "refunded" | "refunded_loss";
    }
  | {
      kind: "rev_log_status";
      rev_log_id: string;
      status: "refunded" | "refunded_loss";
    }
  | {
      kind: "commission_status";
      donation_id: string;
      status: "refunded" | "refunded_loss";
      /** its referrer's share, recorded once apply finds the commission paid,
       * or claimed by a transfer that may pay it, with what the gift's other
       * reversed dists left that referrer owing */
      owed: OwedFigure & { party: ReferrerParty };
    }
  | { kind: "form_decrement"; form_id: string; net: number }
  | { kind: "program_decrement"; program_id: string; net: number }
  | { kind: "donation_message_del"; donation_id: string }
  | { kind: "owed"; owed: OwedFigure }
  | { kind: "loss_log"; loss: ILossLog };

/** what a party owes back on the dist; the refund or dispute behind it is the caller's */
export type OwedFigure = Omit<IOwedRecord, "source" | "source_ref">;

export interface RefundPreview {
  effects: PreviewLine[];
  blockers: PreviewLine[];
  warnings: PreviewLine[];
}

export interface RefundPlan {
  /** the refund ends `refunded_loss`: the npo is short of what it received
   * (and owes it), or its payout is void (and the platform takes the loss) */
  is_loss: boolean;
  loss_reasons: string[];
  /** what each party owes in usd, as the plan sees it. the npo's — on the loss
   * path — is its settled net less the cash share a cancelled payout recovers
   * or a void one never paid, plus the processing fee; bg's own fees are
   * forgone, not owed. the
   * referrer's is a commission paid or claimed for a transfer, which apply
   * re-reads under its lock */
  amount: { party: OwedParty; usd: number }[];
  effects: RefundEffect[];
  preview: RefundPreview;
}

/** the processing fee a dist cost beyond its `net`, in usd. a fee allowance
 * credits it into `net` (`credit_fa` in `lib/settlement/plan.ts`), so it is 0 then */
export const fee_processing_usd = (
  d: Pick<RefundDistInput, "fee_processing" | "fee_allowance">
): number => (d.fee_allowance ? 0 : d.fee_processing);

/** `usd` scaled by `f`, in whole cents rounded down so a share never passes
 * the whole; the whole as it is. the epsilon keeps 0.3 * 90 from flooring to
 * 26.99 */
export const scaled = (usd: number, f: number) =>
  f >= 1 ? usd : Math.floor(usd * f * 100 + 1e-6) / 100;

/** `taken` of the charge, the refunds a pooled rebook cut off the dist
 * included (`refunds_cut_share`), less that cut: what is left to take of it */
export const past_cut = (cut: number | null | undefined, taken: number) =>
  Math.max(taken - (cut ?? 0), 0);

/** `taken` of the charge beyond the dist's cut, as its share of `net`: a
 * rebook books `net` for the part of the charge its cut left. of the card
 * fee, which is the whole charge's, it is `taken` itself */
export const share_of_net = (
  cut: number | null | undefined,
  taken: number
): number => {
  if (!cut) return taken;
  return cut >= 1 ? 0 : Math.min(taken / (1 - cut), 1);
};

/** the settled net a fee split weighs. a refused transfer's cut stores it
 * beside the booked remainder on `net`; with nothing stored, `net` is it */
export const settled_net = (
  d: Pick<RefundDistInput, "net"> & { settled_net?: number | null }
): number => d.settled_net ?? d.net;

/** what a refund takes back from the books. a partial cut already stored that
 * remainder on `net`. a total cut left the settled net and booked nothing */
export const recoverable_net = (
  d: Pick<RefundDistInput, "net"> & { refunds_cut_share?: number | null }
): number =>
  d.refunds_cut_share != null && d.refunds_cut_share >= 1 ? 0 : d.net;

/** a dist's gross in settled usd, counting the processing fee once */
export const dist_settled_usd = (
  d: Pick<
    RefundDistInput,
    | "net"
    | "settled_net"
    | "fee_base"
    | "fee_fsa"
    | "fee_processing"
    | "fee_allowance"
  >
): number => settled_net(d) + d.fee_base + d.fee_fsa + fee_processing_usd(d);

/** the loss log a reversal books for a dist's void payout */
export const void_loss_id = (dist_id: string) => `void:${dist_id}`;

export function calc_refund_plan(
  inputs: RefundInputs,
  ctx: RefundCtx
): RefundPlan {
  const { dist, commission, rev_log_ids, bal, nav, sub_id } = inputs;
  let { payout } = inputs;
  const recovery_applies = inputs.recovery_applies !== false;
  const { now, nav_date, form_id, program_id } = ctx;

  // reverse what settlement credited: a share missing from the stored jsonb credited 0
  const alloc = {
    liq: dist.alloc.liq ?? 0,
    lock: dist.alloc.lock ?? 0,
    cash: dist.alloc.cash ?? 0,
  };
  // the booked remainder: a total cut left the settled net on the row and
  // put nothing in the books, so there is nothing to take back
  const net = recoverable_net(dist);
  // derive balance deltas from allocation percentages
  const bd = dist.routed
    ? { liq: 0, lock: 0, cash: 0 }
    : {
        liq: (alloc.liq / 100) * net,
        lock: (alloc.lock / 100) * net,
        cash: (alloc.cash / 100) * net,
      };
  // a void payout is not a grant, and its cash left the npo's balance when
  // it settled: the cash share is neither there to take back nor owed, so
  // the platform takes its loss, its part of the card fee included
  const void_payout = payout?.type === "void" ? payout : null;
  const cash_void = void_payout ? bd.cash : 0;
  // the part of the dist its npo can owe for: `owable_part` in ./share
  const owable = void_payout ? 1 - alloc.cash / 100 : 1;
  if (void_payout) {
    bd.cash = 0;
    payout = null;
  }
  // an older donation keeps what has not been granted. a grant already paid
  // still follows the loss path below; the owed ledger withholds it
  if (!recovery_applies) {
    bd.liq = 0;
    bd.lock = 0;
    if (is_unsent(payout?.type)) {
      bd.cash = 0;
      payout = null;
    }
  }
  const refund_lock_units = nav && bd.lock > 0 ? bd.lock / nav.price : 0;

  const preview: RefundPreview = {
    effects: [],
    blockers: [],
    warnings: [],
  };
  const loss_reasons: string[] = [];

  // liq check
  if (bd.liq > 0) {
    if (bal.liq >= bd.liq) {
      preview.effects.push({
        label: "Savings balance",
        pass: true,
        reason: `$${humanize(bd.liq)} will be deducted`,
      });
    } else {
      preview.warnings.push({
        label: "Savings balance",
        pass: false,
        reason: `has $${humanize(bal.liq)}, need $${humanize(bd.liq)}`,
      });
      loss_reasons.push(`liq: has $${bal.liq}, need $${bd.liq}`);
    }
  }

  // lock check
  if (bd.lock > 0) {
    if (bal.lock_units >= refund_lock_units) {
      preview.effects.push({
        label: "Investment balance",
        pass: true,
        reason: `$${humanize(bd.lock)} will be redeemed`,
      });
    } else {
      preview.warnings.push({
        label: "Investment balance",
        pass: false,
        reason: `has ${humanize(bal.lock_units)}u, need ${humanize(refund_lock_units)}u`,
      });
      loss_reasons.push(
        `lock: has ${bal.lock_units}u, need ${refund_lock_units}u`
      );
    }
  }

  if (cash_void > 0) {
    preview.effects.push({
      label: "Grant payout",
      pass: true,
      reason: `$${humanize(cash_void)} payout is void: nothing of it is taken back or owed, and the platform takes the loss`,
    });
  }

  // cash/payout check
  if (bd.cash > 0 && payout) {
    if (is_unsent(payout.type)) {
      preview.effects.push({
        label: "Grant payout",
        pass: true,
        reason: `$${humanize(bd.cash)} ${payout.type} payout will be cancelled`,
      });
    } else {
      preview.warnings.push({
        label: "Grant payout",
        pass: false,
        reason: `$${humanize(bd.cash)} payout is ${payout.type ?? "missing"}, cannot reverse`,
      });
      loss_reasons.push(`payout ${payout.id} is ${payout.type ?? "missing"}`);
    }
  }

  // commission (preview only; apply re-reads it under lock)
  if (commission?.status === "paid") {
    preview.warnings.push({
      label: "Commission",
      pass: false,
      reason: `$${humanize(commission.amount)} was already paid to its referrer, so it will be recovered from the referrer's next commission`,
    });
  } else if (commission?.status === "processing") {
    preview.warnings.push({
      label: "Commission",
      pass: false,
      reason: `$${humanize(commission.amount)} is in a payout to its referrer: if that payout goes through, it will be recovered from the referrer's next commission`,
    });
  } else if (commission) {
    preview.effects.push({
      label: "Commission",
      pass: true,
      reason: `$${humanize(commission.amount)} will be reversed`,
    });
  }

  if (dist.routed) {
    preview.effects.push({
      label: "Stripe transfer",
      pass: true,
      // a refunded gift's transfer is never sent (`transfer_routed_dist`)
      reason: dist.routed.transferred
        ? "the refunded share is reversed from the nonprofit's Stripe account"
        : "not yet sent to the nonprofit's Stripe account, and once refunded it won't be",
    });
  }

  if (sub_id) {
    preview.effects.push({
      label: "Subscription",
      pass: true,
      reason: "will be cancelled",
    });
  }

  if (
    preview.effects.length === 0 &&
    preview.warnings.length === 0 &&
    preview.blockers.length === 0
  ) {
    preview.effects.push({ label: "No balance changes", pass: true });
  }

  // read before the void reason joins: the reasons so far are the npo's,
  // which can't reverse what it received and so owes it
  const npo_short = loss_reasons.length > 0;
  if (void_payout && cash_void > 0) {
    loss_reasons.push(`payout ${void_payout.id} is void`);
  }
  const is_loss = loss_reasons.length > 0;
  const status: "refunded" | "refunded_loss" = is_loss
    ? "refunded_loss"
    : "refunded";

  // an unsent payout hasn't paid out its cash, so it is cancelled and its cash
  // reversed even when a savings/investment shortfall makes the refund a loss
  const payout_cancelled = is_unsent(payout?.type);
  const cash_recovered = payout_cancelled ? bd.cash : 0;
  const owed: OwedFigure = {
    donation_id: dist.donation_id,
    party: { npo_id: dist.to_id },
    received_usd: net - cash_recovered - cash_void,
    fee_processing_usd: scaled(
      fee_processing_usd(dist),
      past_cut(dist.refunds_cut_share, 1) * owable
    ),
    now,
  };

  const effects: RefundEffect[] = [];

  // payout row before the npos row: the grants cron's settle writes payouts
  // then the npos row, so the reverse order deadlocks it
  if (payout) {
    effects.push({
      kind: "payout_status",
      payout_id: payout.id,
      status: payout_cancelled ? "refunded" : status,
    });
  }

  if (npo_short && cash_recovered > 0) {
    effects.push({
      kind: "balance_update",
      npo_id: dist.to_id,
      deltas: { liq: 0, lock: 0, lock_units: 0, cash: cash_recovered },
    });
  }

  // balance/NAV writes — only when fully reversible, and only for a gift
  // the revised terms let us take ungranted funds back from
  if (!npo_short && !dist.routed && recovery_applies) {
    const refund_deltas: IBalanceDeltas = {
      liq: bd.liq,
      lock: bd.lock,
      lock_units: refund_lock_units,
      cash: bd.cash,
    };
    // all zero — nothing credited, a total cut, a void payout's cash share
    // alone — sets no column, which drizzle refuses
    if (refund_deltas.liq || refund_deltas.lock_units || refund_deltas.cash) {
      effects.push({
        kind: "balance_update",
        npo_id: dist.to_id,
        deltas: refund_deltas,
      });
    }

    if (bd.liq > 0) {
      effects.push({
        kind: "bal_tx_put",
        tx: {
          id: crypto.randomUUID(),
          date_created: now,
          date_updated: now,
          npo_id: dist.to_id,
          account: "liq",
          bal_begin: bal.liq,
          bal_end: bal.liq - bd.liq,
          amount: bd.liq,
          amount_units: bd.liq,
          status: "final",
          account_other_id: dist.id,
          account_other: "refund",
          account_other_bal_begin: 0,
          account_other_bal_end: bd.liq,
        },
      });
    }

    if (bd.lock > 0 && nav) {
      const lock_usd = refund_lock_units * nav.price;
      effects.push({
        kind: "bal_tx_put",
        tx: {
          id: crypto.randomUUID(),
          date_created: now,
          date_updated: now,
          npo_id: dist.to_id,
          account: "lock",
          bal_begin: bal.lock_units,
          bal_end: bal.lock_units - refund_lock_units,
          amount: lock_usd,
          amount_units: refund_lock_units,
          status: "final",
          account_other_id: dist.id,
          account_other: "refund",
          account_other_bal_begin: 0,
          account_other_bal_end: lock_usd,
        },
      });
    }

    if (bd.lock > 0 && nav) {
      effects.push({
        kind: "nav_log",
        entry: {
          reason: `refund npo:${dist.to_id}`,
          date: nav_date,
          cash_delta: -bd.lock,
          holder_deltas: [
            { npo_id: dist.to_id, units_delta: -refund_lock_units },
          ],
        },
      });
    }
  }

  // always-reversed: revenue logs
  for (const id of rev_log_ids) {
    effects.push({ kind: "rev_log_status", rev_log_id: id, status });
  }

  // its referrer owes it if apply finds it paid (left paid) or claimed by a
  // transfer, under its lock; the npo never owes it
  if (commission) {
    effects.push({
      kind: "commission_status",
      donation_id: commission.donation_id,
      status,
      owed: {
        donation_id: dist.donation_id,
        party: commission.referrer,
        received_usd: commission.amount,
        fee_processing_usd: 0,
        now,
      },
    });
  }

  // form / program contributions (always decrement)
  if (form_id) {
    effects.push({ kind: "form_decrement", form_id, net: dist.net });
  }
  if (program_id) {
    effects.push({ kind: "program_decrement", program_id, net: dist.net });
  }

  // donation thank-you message
  effects.push({
    kind: "donation_message_del",
    donation_id: dist.donation_id,
  });

  if (npo_short) effects.push({ kind: "owed", owed });

  if (void_payout && cash_void > 0) {
    const void_share = 1 - owable;
    const fees_bg = scaled(dist.fee_base + dist.fee_fsa, void_share);
    const fees_processing = scaled(
      fee_processing_usd(dist),
      past_cut(dist.refunds_cut_share, 1) * void_share
    );
    effects.push({
      kind: "loss_log",
      loss: {
        // one per dist: a retried reversal books nothing more
        id: void_loss_id(dist.id),
        date: now,
        donation_id: dist.donation_id,
        dist_id: dist.id,
        npo_id: dist.to_id,
        referrer_user: null,
        referrer_npo: null,
        type: "payout",
        amount: cash_void + fees_bg + fees_processing,
        npo_amount: cash_void,
        fees_bg,
        fees_processing,
        reason: `payout ${void_payout.id} is void`,
        actor: null,
      },
    });
  }

  const amount: RefundPlan["amount"] = [];
  if (npo_short) {
    const usd = owed.received_usd + owed.fee_processing_usd;
    amount.push({ party: owed.party, usd });
  }
  if (commission?.status === "paid" || commission?.status === "processing") {
    amount.push({ party: commission.referrer, usd: commission.amount });
  }

  return { is_loss, loss_reasons, amount, effects, preview };
}
