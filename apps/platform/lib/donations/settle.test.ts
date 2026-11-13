import { describe, expect, test } from "vitest";
import type { IDonation, IDonationSettled, ISettlement } from "./interfaces";
import {
  calc_donation_settle,
  is_cancelled_duplicate,
  type SettleResult,
} from "./settle";

const sttl = (overrides: Partial<ISettlement> = {}): ISettlement => ({
  id: "sttl-1",
  date: "2026-01-01T00:00:00.000Z",
  currency: "USD",
  net: 95,
  fee: 5,
  ...overrides,
});

const make_don = (overrides: Partial<IDonation> = {}): IDonation => ({
  id: "don-1",
  to_id: "1",
  to_name: "n",
  to_type: "npo",
  to_tip_allowed: false,
  to_members: [],
  from_email: "d@e.com",
  status: "confirmed",
  upusd: 1,
  amount: { base: 100, tip: 0, fee_allowance: 0 },
  currency: "USD",
  source: "bg-marketplace",
  frequency: "one-time",
  via: "stripe:card",
  created_at: "2025-12-01T00:00:00.000Z",
  updated_at: "2025-12-01T00:00:00.000Z",
  ...overrides,
});

describe("calc_donation_settle - one-time", () => {
  test("returns update op with status+settlement patch", () => {
    const r = calc_donation_settle({
      kind: "one-time",
      order_id: "don-1",
      prior: make_don(),
      settlement: sttl(),
    });
    expect(r.op).toBe("update");
    if (r.op !== "update") throw new Error("expected update");
    expect(r.order_id).toBe("don-1");
    expect(r.patch).toEqual({ status: "settled", settlement: sttl() });
  });

  test("merges via when provided", () => {
    const r = calc_donation_settle({
      kind: "one-time",
      order_id: "don-1",
      prior: make_don(),
      settlement: sttl(),
      via: "stripe:link",
    });
    if (r.op !== "update") throw new Error("expected update");
    expect(r.patch.via).toBe("stripe:link");
  });

  test("omits via when not provided", () => {
    const r = calc_donation_settle({
      kind: "one-time",
      order_id: "don-1",
      prior: make_don(),
      settlement: sttl(),
    });
    if (r.op !== "update") throw new Error("expected update");
    expect("via" in r.patch).toBe(false);
  });

  test("does not include subscription_id", () => {
    const r = calc_donation_settle({
      kind: "one-time",
      order_id: "don-1",
      prior: make_don(),
      settlement: sttl(),
    });
    if (r.op !== "update") throw new Error("expected update");
    expect("subscription_id" in r.patch).toBe(false);
  });

  test("emits dist+receipt msgs with projected post-write id", () => {
    const r = calc_donation_settle({
      kind: "one-time",
      order_id: "don-1",
      prior: make_don({ id: "don-xyz" }),
      settlement: sttl(),
    });
    expect(r.msgs.map((m) => m.id)).toEqual([
      "don-sttl-dist",
      "don-sttl-receipt",
    ]);
    expect(r.msgs[0].dedupe).toBe("don.sttl-dist_don-xyz");
    expect(r.msgs[1].dedupe).toBe("don.sttl-receipt_don-xyz");
  });

  test("a fund gift queues its receipt beside the split, not behind it", () => {
    const r = calc_donation_settle({
      kind: "one-time",
      order_id: "don-1",
      prior: make_don({ to_type: "fund", to_id: "fund-1", to_members: ["1"] }),
      settlement: sttl(),
    });
    // the split is at-most-once: a receipt it queued would die with it
    expect(r.msgs.map((m) => m.id)).toEqual([
      "don-sttl-dist",
      "don-sttl-receipt",
    ]);
  });
});

describe("calc_donation_settle - don-match", () => {
  const settle = (overrides: Partial<IDonation>, kind = "one-time" as const) =>
    calc_donation_settle({
      kind,
      order_id: "don-1",
      prior: make_don(overrides),
      settlement: sttl(),
    });

  const match = (r: SettleResult) => r.msgs.find((m) => m.id === "don-match");

  test("emitted when the donor named an employer", () => {
    const r = settle({ id: "don-xyz", from_company_name: "Acme Inc" });
    const m = match(r);
    expect(m?.dedupe).toBe("don.match_don-xyz");
    expect(m?.payload).toEqual({
      id: "don-xyz",
      from_company_name: "Acme Inc",
    });
  });

  test("retries so a transient handler failure is re-driven", () => {
    expect(match(settle({ from_company_name: "Acme" }))?.retries).toBe(3);
  });

  test("skipped when no employer was given", () => {
    expect(match(settle({}))).toBeUndefined();
  });

  test("skipped when the employer normalizes away entirely", () => {
    // punctuation-only input names nobody, so there is nothing to address
    expect(match(settle({ from_company_name: " -- " }))).toBeUndefined();
  });

  test("junk that survives normalization is still emitted", () => {
    // normalization decides emit-or-not; the name itself rides through raw
    expect(match(settle({ from_company_name: "n/a" }))?.payload).toEqual({
      id: "don-1",
      from_company_name: "n/a",
    });
  });

  test("emitted for the first charge of a subscription", () => {
    const r = calc_donation_settle({
      kind: "first-recurring",
      order_id: "don-1",
      prior: make_don({ frequency: "monthly", from_company_name: "Acme" }),
      settlement: sttl(),
      subs_id: "sub_123",
    });
    const m = match(r);
    expect(m?.dedupe).toBe("don.match_don-1");
    expect(m?.payload).toEqual({ id: "don-1", from_company_name: "Acme" });
  });

  test("never emitted for a rebill", () => {
    const r = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: {
        ...make_don({ frequency: "monthly", from_company_name: "Acme" }),
        settlement: sttl({ id: "sttl-old" }),
      },
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    expect(match(r)).toBeUndefined();
  });
});

describe("calc_donation_settle - already reversed", () => {
  test("a refunded donation is not flipped back to settled", () => {
    const r = calc_donation_settle({
      kind: "one-time",
      order_id: "don-1",
      prior: make_don({ status: "refunded" }),
      settlement: sttl(),
    });
    expect(r.op).toBe("noop");
  });

  test("refunded_loss is reversed too", () => {
    const r = calc_donation_settle({
      kind: "one-time",
      order_id: "don-1",
      prior: make_don({ status: "refunded_loss" }),
      settlement: sttl(),
    });
    expect(r.op).toBe("noop");
  });

  test("emits no dist or receipt msgs", () => {
    const r = calc_donation_settle({
      kind: "first-recurring",
      order_id: "don-1",
      prior: make_don({ status: "refunded", from_company_name: "Acme" }),
      settlement: sttl(),
      subs_id: "sub_123",
    });
    // the redelivery that reaches here already paid out once; re-queueing
    // would mail a second receipt for money that went back
    expect(r.msgs).toEqual([]);
  });

  test("a rebill is not blocked by the order row's status", () => {
    // prior is the order row, not the period being settled: a refunded first
    // charge does not mean this month's charge failed
    const r = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: {
        ...make_don({ status: "refunded", frequency: "monthly" }),
        settlement: sttl({ id: "sttl-old" }),
      },
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    expect(r.op).toBe("put");
  });

  test("a rebill on a refunded order is written settled, not refunded", () => {
    const r = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: {
        ...make_don({ status: "refunded", frequency: "monthly" }),
        settlement: sttl({ id: "sttl-old" }),
      },
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    if (r.op !== "put") throw new Error("expected put");
    // the clone distributes and pays out; carrying the order row's "refunded"
    // over would have the dist and the donation disagree about the same money
    expect(r.row.status).toBe("settled");
  });
});

describe("calc_donation_settle - first-recurring", () => {
  test("patch includes subscription_id", () => {
    const r = calc_donation_settle({
      kind: "first-recurring",
      order_id: "don-1",
      prior: make_don({ frequency: "monthly" }),
      settlement: sttl(),
      subs_id: "sub_123",
    });
    if (r.op !== "update") throw new Error("expected update");
    expect(r.patch).toEqual({
      status: "settled",
      settlement: sttl(),
      subscription_id: "sub_123",
    });
  });

  test("merges via when provided", () => {
    const r = calc_donation_settle({
      kind: "first-recurring",
      order_id: "don-1",
      prior: make_don({ frequency: "monthly" }),
      settlement: sttl(),
      subs_id: "sub_123",
      via: "stripe:us_bank_account",
    });
    if (r.op !== "update") throw new Error("expected update");
    expect(r.patch.via).toBe("stripe:us_bank_account");
  });
});

describe("calc_donation_settle - rebill", () => {
  const prior_settled: IDonationSettled = {
    ...make_don({
      id: "don-1",
      frequency: "monthly",
      subscription_id: "sub_old",
      via: "stripe:card",
    }),
    settlement: sttl({ id: "sttl-old", date: "2025-12-01T00:00:00.000Z" }),
  };

  test("returns put op with new row", () => {
    const r = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: prior_settled,
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    expect(r.op).toBe("put");
  });

  test("clones prior with new id + new settlement + new timestamps", () => {
    const r = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: prior_settled,
      settlement: sttl({ id: "sttl-new", date: "2026-02-01T00:00:00.000Z" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    if (r.op !== "put") throw new Error("expected put");
    expect(r.row.id).toBe("new-uuid");
    expect(r.row.created_at).toBe("2026-02-01T00:00:00.000Z");
    expect(r.row.updated_at).toBe("2026-02-01T00:00:00.000Z");
    expect(r.row.settlement.id).toBe("sttl-new");
    expect(r.row.subscription_id).toBe("sub_new");
  });

  test("preserves donor + to fields from prior", () => {
    const r = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: prior_settled,
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    if (r.op !== "put") throw new Error("expected put");
    expect(r.row.from_email).toBe(prior_settled.from_email);
    expect(r.row.to_id).toBe(prior_settled.to_id);
    expect(r.row.amount).toEqual(prior_settled.amount);
  });

  test("clears id_v1 on the rebill clone", () => {
    const r = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: { ...prior_settled, id_v1: "legacy-id" },
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    if (r.op !== "put") throw new Error("expected put");
    expect(r.row.id_v1).toBeUndefined();
  });

  test("via merges when provided, else preserves prior", () => {
    const r1 = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: prior_settled,
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
      via: "stripe:link",
    });
    if (r1.op !== "put") throw new Error("expected put");
    expect(r1.row.via).toBe("stripe:link");

    const r2 = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: prior_settled,
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    if (r2.op !== "put") throw new Error("expected put");
    expect(r2.row.via).toBe("stripe:card");
  });

  test("msgs reference the new id, not the prior id", () => {
    const r = calc_donation_settle({
      kind: "rebill",
      order_id: "don-1",
      prior: prior_settled,
      settlement: sttl({ id: "sttl-new" }),
      subs_id: "sub_new",
      new_id: "new-uuid",
    });
    expect(r.msgs[0].dedupe).toBe("don.sttl-dist_new-uuid");
    expect(r.msgs[1].dedupe).toBe("don.sttl-receipt_new-uuid");
  });
});

describe("is_cancelled_duplicate", () => {
  test.each([
    ["cancelled", "refunded", true],
    ["cancelled", "refunded_loss", false],
    ["cancelled", "settled", false],
    ["cancelled", null, false],
    ["cancelled", undefined, false],
    ["refunded", "refunded", false],
  ] as const)("%s donation, %s dist: %s", (donation, dist, expected) => {
    expect(is_cancelled_duplicate(donation, dist)).toBe(expected);
  });
});
