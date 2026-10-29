import { describe, expect, expectTypeOf, test } from "vitest";
import type { IAllocation } from "../donations";
import type { IDonDistPayload } from "../queue";
import type { IRevenueLog } from "../revenue";
import type { IInput, IParts } from "../types/donation-dist";
import {
  calc_settlement_plan,
  type NpoSettlementContext,
  settled_parts,
  shared_parts,
} from "./plan";

const amt = (base: number, tip = 0, fee_allowance = 0) => ({
  base,
  tip,
  fee_allowance,
});

const parts = (overrides: Partial<IParts> = {}): IParts => ({
  amnt: amt(100),
  amnt_usd: amt(100),
  fa: amt(0),
  sttl: amt(100),
  sttl_fee: amt(0),
  sttl_fa: amt(0),
  ...overrides,
});

const make_input = (overrides: Partial<IInput> = {}): IInput => ({
  id: 1,
  ps: parts(),
  sttl: { id: "sttl-1", date: "2026-01-01T00:00:00.000Z", currency: "USD" },
  prnt: {
    id: "parent-1",
    to_id: "1",
    to_name: "n",
    to_members: [],
    type: "npo",
  },
  source: undefined,
  program: undefined,
  nav_price: 1,
  tx: {
    currency: "USD",
    upusd: 1,
    frequency: "one-time",
    status: "settled",
    source: "bg-marketplace",
    via: "stripe:card",
    from_email: "d@e.com",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  ...overrides,
});

const make_ctx = (
  overrides: Partial<NpoSettlementContext> = {}
): NpoSettlementContext => ({
  id: 1,
  name: "Test NPO",
  fiscal_sponsored: false,
  hide_bg_tip: false,
  allocation: { cash: 100, liq: 0, lock: 0 },
  lock_units: 0,
  liq: 0,
  referrer_user: null,
  referrer_npo: null,
  referrer_expiry: null,
  ...overrides,
});

describe("calc_settlement_plan", () => {
  test("baseline: no tip, no fees, all-cash alloc → payout = gross", () => {
    const plan = calc_settlement_plan(make_input(), make_ctx(), null);
    expect(plan.dist.gross).toBe(100);
    expect(plan.dist.net).toBe(100);
    expect(plan.dist.fees).toEqual({ base: 0, fsa: 0, processing: 0 });
    expect(plan.payout?.amount).toBe(100);
    expect(plan.balance_txs).toHaveLength(0);
    expect(plan.revenue_logs).toHaveLength(0);
    expect(plan.commission).toBeNull();
  });

  test("hide_bg_tip → base fee charged; fiscal_sponsored → fsa fee charged", () => {
    const plan = calc_settlement_plan(
      make_input(),
      make_ctx({ hide_bg_tip: true, fiscal_sponsored: true }),
      null
    );
    // base 1.5%, fsa 2.9%
    expect(plan.dist.fees.base).toBeCloseTo(1.5);
    expect(plan.dist.fees.fsa).toBeCloseTo(2.9);
    expect(plan.dist.net).toBeCloseTo(100 - 1.5 - 2.9);
    expect(plan.revenue_logs.map((r) => r.type)).toEqual([
      "base-fee",
      "fsa-fee",
    ]);
  });

  test("invariant: gross == net + base + fsa - fa_excess_credit", () => {
    const plan = calc_settlement_plan(
      make_input(),
      make_ctx({ hide_bg_tip: true, fiscal_sponsored: true }),
      null
    );
    expect(plan.dist.gross).toBeCloseTo(
      plan.dist.net + plan.dist.fees.base + plan.dist.fees.fsa
    );
  });

  test("tip > 0 → tip revenue log + tip_received msg with shared id", () => {
    const plan = calc_settlement_plan(
      make_input({ ps: parts({ sttl: amt(100, 5) }) }),
      make_ctx(),
      null
    );
    const tip_log = plan.revenue_logs.find((r) => r.type === "tip");
    expect(tip_log?.gross).toBe(5);
    const tip_msg = plan.msgs.find((m) => m.id === "tip-received");
    expect((tip_msg!.payload as { id: string }).id).toBe(tip_log!.id);
  });

  test("active referrer → commission = 30% of (tip + base + fsa)", () => {
    const plan = calc_settlement_plan(
      make_input({ ps: parts({ sttl: amt(100, 10) }) }),
      make_ctx({
        hide_bg_tip: true,
        fiscal_sponsored: true,
        referrer_user: "u-1",
        referrer_expiry: "2099-01-01T00:00:00.000Z",
      }),
      null
    );
    const tip_gross = plan.revenue_logs.find((r) => r.type === "tip")!.gross;
    const expected_commission =
      (tip_gross + plan.dist.fees.base + plan.dist.fees.fsa) * 0.3;
    expect(plan.commission?.amount).toBeCloseTo(expected_commission);
    expect(plan.commission?.referrer_user).toBe("u-1");
    expect(plan.dist.referrer?.id).toBe("u-1");
    expect(plan.dist.referrer?.cf_from_tip).toBeCloseTo(tip_gross * 0.3);
  });

  test("expired referrer → no commission, no dist.referrer", () => {
    const plan = calc_settlement_plan(
      make_input(),
      make_ctx({
        hide_bg_tip: true,
        referrer_user: "u-1",
        referrer_expiry: "2020-01-01T00:00:00.000Z",
      }),
      null
    );
    expect(plan.commission).toBeNull();
    expect(plan.dist.referrer).toBeUndefined();
  });

  test("alloc 50/30/20 (lock/liq/cash) → 2 balance txs + payout + nav_log_entry", () => {
    const plan = calc_settlement_plan(
      make_input({ nav_price: 2 }),
      make_ctx({ allocation: { lock: 50, liq: 30, cash: 20 } }),
      null
    );
    expect(plan.balance_txs).toHaveLength(2);
    expect(plan.balance_txs[0].account).toBe("lock");
    expect(plan.balance_txs[0].amount).toBe(50);
    expect(plan.balance_txs[0].amount_units).toBe(25); // 50 / nav_price 2
    expect(plan.balance_txs[1].account).toBe("liq");
    expect(plan.balance_txs[1].amount).toBe(30);
    expect(plan.payout?.amount).toBe(20);
    expect(plan.nav_log_entry?.cash_delta).toBe(50);
    expect(plan.nav_log_entry?.holder_deltas[0].units_delta).toBe(25);
  });

  test("invariant: balance_deltas sums to net", () => {
    const plan = calc_settlement_plan(
      make_input(),
      make_ctx({ allocation: { lock: 50, liq: 30, cash: 20 } }),
      null
    );
    const { liq, lock, cash } = plan.balance_deltas;
    expect(liq + lock + cash).toBeCloseTo(plan.dist.net);
  });

  test("alloc 0/0/100 → no balance txs, no nav log, payout only", () => {
    const plan = calc_settlement_plan(make_input(), make_ctx(), null);
    expect(plan.balance_txs).toHaveLength(0);
    expect(plan.nav_log_entry).toBeNull();
    expect(plan.payout?.amount).toBe(100);
  });

  test("stored allocation missing a share → that share is 0, deltas stay finite", () => {
    const plan = calc_settlement_plan(
      make_input(),
      // jsonb allocation written without a cash key
      make_ctx({ allocation: { liq: 100, lock: 0 } as IAllocation }),
      null
    );
    expect(plan.balance_deltas).toEqual({
      liq: 100,
      lock: 0,
      lock_units: 0,
      cash: 0,
    });
    expect(plan.dist.to_settings.alloc).toEqual({ liq: 100, lock: 0, cash: 0 });
    expect(plan.payout).toBeNull();
  });

  test("stored allocation with no shares → default all-cash, net still lands", () => {
    const plan = calc_settlement_plan(
      make_input(),
      make_ctx({ allocation: {} as IAllocation }),
      null
    );
    expect(plan.dist.to_settings.alloc).toEqual({ liq: 0, lock: 0, cash: 100 });
    expect(plan.balance_deltas.cash).toBe(100);
    expect(plan.payout?.amount).toBe(100);
    expect(plan.alloc_fell_back).toBe(false);
  });

  test("stored allocation missing cash → cash is the remainder", () => {
    const plan = calc_settlement_plan(
      make_input(),
      make_ctx({ allocation: { liq: 30, lock: 20 } as IAllocation }),
      null
    );
    expect(plan.dist.to_settings.alloc).toEqual({
      liq: 30,
      lock: 20,
      cash: 50,
    });
    const { liq, lock, cash } = plan.balance_deltas;
    expect(liq + lock + cash).toBeCloseTo(plan.dist.net);
    expect(plan.alloc_fell_back).toBe(false);
  });

  test("stored allocation summing over 100 → default all-cash, flagged", () => {
    const plan = calc_settlement_plan(
      make_input(),
      make_ctx({ allocation: { liq: 60, lock: 30, cash: 20 } }),
      null
    );
    expect(plan.dist.to_settings.alloc).toEqual({ liq: 0, lock: 0, cash: 100 });
    expect(plan.balance_deltas.cash).toBe(plan.dist.net);
    expect(plan.alloc_fell_back).toBe(true);
  });

  test("stored allocation with cash but short of 100 → default all-cash, flagged", () => {
    const plan = calc_settlement_plan(
      make_input(),
      make_ctx({ allocation: { liq: 30, lock: 20, cash: 0 } }),
      null
    );
    expect(plan.dist.to_settings.alloc).toEqual({ liq: 0, lock: 0, cash: 100 });
    expect(plan.alloc_fell_back).toBe(true);
  });

  test("fee allowance covers processing fee → fa_excess captured, gross unchanged", () => {
    const plan = calc_settlement_plan(
      make_input({
        ps: parts({
          sttl: amt(100),
          sttl_fee: amt(2),
          sttl_fa: amt(3),
        }),
      }),
      make_ctx(),
      null
    );
    expect(plan.dist.gross).toBe(100);
    expect(plan.dist.fee_allowance_excess).toBe(1); // 3 - 2
    expect(plan.dist.net).toBe(102); // 100 + 2 (pf covered by fa)
  });

  test("don_dist msg is always emitted, last", () => {
    const plan = calc_settlement_plan(make_input(), make_ctx(), null);
    expect(plan.msgs.at(-1)?.id).toBe("don-dist");
  });

  test("don_dist carries the donor address the npo notification prints", () => {
    const plan = calc_settlement_plan(
      make_input({
        tx: {
          ...make_input().tx,
          from_addr_street: "12 Fleet St",
          from_addr_city: "London",
          from_addr_zip_code: "EC4Y 1AA",
          from_addr_country: "GB",
        },
      }),
      make_ctx(),
      null
    );

    // this is the only producer of the kind, so an address it drops is one the
    // notification can never show
    const p = plan.msgs.at(-1)?.payload as IDonDistPayload;
    expect(p.from?.address).toMatchObject({
      street: "12 Fleet St",
      city: "London",
      zip: "EC4Y 1AA",
      country: "GB",
    });
  });

  test("don_dist carries the form the donation came through", () => {
    const plan = calc_settlement_plan(
      make_input({ source: { id: "form-1", tag: "gala" } }),
      make_ctx(),
      null
    );

    const p = plan.msgs.at(-1)?.payload as IDonDistPayload;
    expect(p.form).toEqual({ id: "form-1", tag: "gala" });
  });
});

describe("calc_settlement_plan routed to a connected account", () => {
  const ACCT = "acct_routed";
  // fees, a tip, a live referrer and a stored investment split: everything a
  // routed plan keeps or drops is non-zero in the pooled one
  const input = () =>
    make_input({ ps: parts({ sttl: amt(100, 10) }), nav_price: 2 });
  const ctx = () =>
    make_ctx({
      hide_bg_tip: true,
      fiscal_sponsored: true,
      referrer_user: "u-1",
      referrer_expiry: "2099-01-01T00:00:00.000Z",
      allocation: { lock: 50, liq: 30, cash: 20 },
    });
  // both are minted per plan
  const no_ids = (xs: IRevenueLog[]) =>
    xs.map(({ id: _, donation_id: __, ...x }) => x);

  test("books the dist, fees, tip and referral exactly as pooled does", () => {
    const pooled = calc_settlement_plan(input(), ctx(), null);
    const routed = calc_settlement_plan(input(), ctx(), ACCT);

    expect(routed.kind).toBe("routed");
    expect(routed.dist.net).toBeCloseTo(100 - 1.5 - 2.9);
    expect(routed.dist.fees).toEqual(pooled.dist.fees);
    expect(routed.dist.referrer).toEqual(pooled.dist.referrer);
    expect(no_ids(routed.revenue_logs)).toEqual(no_ids(pooled.revenue_logs));
    expect(routed.commission?.amount).toBeCloseTo(pooled.commission!.amount);
  });

  test("lands the whole net as cash, whatever split the npo stored", () => {
    const routed = calc_settlement_plan(input(), ctx(), ACCT);
    expect(routed.dist.to_settings.alloc).toEqual({
      cash: 100,
      liq: 0,
      lock: 0,
    });
    expect(routed.alloc_fell_back).toBe(false);
  });

  test("carries no payout, balance movement or investment", () => {
    const routed = calc_settlement_plan(input(), ctx(), ACCT);
    for (const k of [
      "payout",
      "balance_txs",
      "nav_log_entry",
      "balance_deltas",
    ])
      expect(routed).not.toHaveProperty(k);
    expect(routed.msgs.map((m) => m.id)).not.toContain("lock-tx-created");
  });

  test("a pooled plan of the same donation does carry them", () => {
    const pooled = calc_settlement_plan(input(), ctx(), null);
    expect(pooled.kind).toBe("pooled");
    expect(pooled.payout?.amount).toBeCloseTo(pooled.dist.net * 0.2);
    expect(pooled.balance_txs.map((t) => t.account)).toEqual(["lock", "liq"]);
  });

  test("asks for the transfer of the dist it books", () => {
    const routed = calc_settlement_plan(input(), ctx(), ACCT);
    expect(routed.msgs.map((m) => m.id)).toEqual([
      "tip-received",
      "don-dist",
      "connect-transfer",
    ]);
    // the dist row's id is the plan's don id; sttl id is the payment intent
    expect(routed.msgs.at(-1)?.payload).toEqual({
      dist_id: routed.don.id,
      donation_id: "parent-1",
      intent_id: "sttl-1",
    });
  });

  test("has no payout field at the type level", () => {
    const routed = calc_settlement_plan(input(), ctx(), ACCT);
    expectTypeOf(routed).not.toHaveProperty("payout");
    expectTypeOf(routed).not.toHaveProperty("balance_txs");
    expectTypeOf(routed).not.toHaveProperty("nav_log_entry");
    expectTypeOf(routed).not.toHaveProperty("balance_deltas");
    // @ts-expect-error a routed plan cannot name a payout
    routed.payout;
  });
});

// a $100 card gift to a fiscally sponsored npo, settled at stripe's 2.2% + $0.30
// on the whole charge. the base and fsa fees are on the full gift either way
describe("calc_settlement_plan fee base", () => {
  const card = (base: number, tip: number, fee_allowance: number) => {
    const total = base + tip + fee_allowance;
    const fee = Math.round((total * 0.022 + 0.3) * 100) / 100;
    return make_input({
      ps: settled_parts(amt(base, tip, fee_allowance), 1, {
        net: total - fee,
        fee,
      }),
    });
  };
  const fsa = make_ctx({ fiscal_sponsored: true });
  const fee_logs = (plan: { revenue_logs: IRevenueLog[] }) =>
    plan.revenue_logs
      .filter((r) => r.type !== "tip")
      .map((r) => [r.type, r.gross]);

  test("no tip, uncovered: fsa on $100, npo still absorbs the $2.50 card fee", () => {
    const plan = calc_settlement_plan(card(100, 0, 0), fsa, null);
    expect(plan.dist.fees.fsa).toBeCloseTo(2.9, 10);
    expect(plan.dist.fees.processing).toBeCloseTo(2.5, 10);
    expect(plan.dist.net).toBeCloseTo(100 - 2.5 - 2.9, 10);
    expect(fee_logs(plan)).toEqual([["fsa-fee", plan.dist.fees.fsa]]);
  });

  test("covered: fsa and net are what they were before the base moved", () => {
    // $2.56 allowance on $102.56 is a $2.56 card fee
    const plan = calc_settlement_plan(card(100, 0, 2.56), fsa, null);
    expect(plan.dist.fees.fsa).toBeCloseTo(2.9, 10);
    expect(plan.dist.net).toBeCloseTo(97.1, 10);
  });

  test("$10 tip, uncovered: tip carries no fee, fsa on the $100 gift", () => {
    const plan = calc_settlement_plan(card(100, 10, 0), fsa, null);
    // $2.72 card fee on $110, split 100:10
    expect(plan.dist.fees.fsa).toBeCloseTo(2.9, 10);
    expect(plan.dist.fees.processing).toBeCloseTo(2.72 * (100 / 110), 10);
    expect(plan.dist.net).toBeCloseTo(107.28 * (100 / 110) - 2.9, 10);
    const tip = plan.revenue_logs.find((r) => r.type === "tip")!;
    expect(tip.gross).toBeCloseTo(107.28 * (10 / 110), 10);
    expect(fee_logs(plan)).toEqual([["fsa-fee", plan.dist.fees.fsa]]);
  });

  test("$10 tip, covered: fsa and net are what they were before", () => {
    // $2.78 allowance on $112.78 is a $2.78 card fee
    const plan = calc_settlement_plan(card(100, 10, 2.78), fsa, null);
    expect(plan.dist.fees.fsa).toBeCloseTo(2.9, 10);
    expect(plan.dist.net).toBeCloseTo(97.1, 10);
    const tip = plan.revenue_logs.find((r) => r.type === "tip")!;
    expect(tip.gross).toBeGreaterThan(0);
    expect(fee_logs(plan)).toEqual([["fsa-fee", plan.dist.fees.fsa]]);
  });

  test("tip turned off, uncovered: base fee is 1.5% of $100", () => {
    const plan = calc_settlement_plan(
      card(100, 0, 0),
      make_ctx({ hide_bg_tip: true }),
      null
    );
    expect(plan.dist.fees.base).toBeCloseTo(1.5, 10);
    expect(plan.dist.fees.fsa).toBe(0);
    expect(plan.dist.net).toBeCloseTo(100 - 2.5 - 1.5, 10);
  });

  test("referral commission is 30% of the fees on the full gift", () => {
    const plan = calc_settlement_plan(
      card(100, 0, 0),
      make_ctx({
        fiscal_sponsored: true,
        hide_bg_tip: true,
        referrer_npo: "npo-2",
        referrer_expiry: "2099-01-01T00:00:00.000Z",
      }),
      null
    );
    expect(plan.commission?.amount).toBeCloseTo((1.5 + 2.9) * 0.3, 10);
  });

  test("crypto: fees on the settled value plus its fee share", () => {
    // 0.05 ETH at $2,000, settled to $99 after a $1 processor fee
    const plan = calc_settlement_plan(
      make_input({
        ps: settled_parts(amt(0.05), 0.0005, { net: 99, fee: 1 }),
      }),
      fsa,
      null
    );
    expect(plan.dist.fees.fsa).toBeCloseTo(2.9, 10);
    expect(plan.dist.net).toBeCloseTo(99 - 2.9, 10);
  });

  test("a share with no processor fee, as a manual settlement books, stays on net", () => {
    const plan = calc_settlement_plan(
      make_input({ ps: parts({ sttl: amt(97.5) }) }),
      make_ctx({ fiscal_sponsored: true, hide_bg_tip: true }),
      null
    );
    expect(plan.dist.fees.fsa).toBeCloseTo(97.5 * 0.029, 10);
    expect(plan.dist.fees.base).toBeCloseTo(97.5 * 0.015, 10);
  });
});

describe("shared_parts", () => {
  test("divides every amount by n", () => {
    const p = parts({
      amnt: amt(100, 10, 5),
      sttl: amt(90, 9, 4),
      sttl_fee: amt(2, 0, 0),
    });
    const out = shared_parts(p, 2);
    expect(out.amnt.base).toBe(50);
    expect(out.amnt.tip).toBe(5);
    expect(out.sttl.base).toBe(45);
    expect(out.sttl_fee.base).toBe(1);
  });
});
