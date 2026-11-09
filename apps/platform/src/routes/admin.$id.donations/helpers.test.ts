import { describe, expect, test } from "vitest";
import type { INpoDonation } from "$/pg/queries/dist";
import { origin_text, to_csv_row } from "./helpers";

describe("origin_text", () => {
  test("names the widget and marketplace channels", () => {
    expect(origin_text("bg-widget")).toBe("Donation Form");
    expect(origin_text("bg-marketplace")).toBe("Marketplace");
  });
});

const dist: INpoDonation = {
  id: "dist-1",
  donation_id: "don-1",
  status: "settled",
  date_created: "2026-08-01T00:00:00.000Z",
  to_id: 1,
  to_name: "Npo",
  to_fiscal_sponsored: false,
  amount: 15,
  amount_usd: 15,
  amount_denom: "USD",
  net: 14.325,
  fee_base: 0.225,
  fee_fsa: 0,
  fee_processing: 0.45,
  fee_allowance: 0,
  fee_allowance_excess: 0,
  fund_id: null,
  alloc: { cash: 100, liq: 0, lock: 0 },
  refund_status: null,
  refund_error: null,
  notice_claimed_at: null,
  notice_sent_at: null,
  metric_counted_at: null,
  hooks_sent_at: null,
  stripe_routed_to: null,
  stripe_transfer_id: null,
  stripe_transfer_created_at: null,
  refunds_cut_share: null,
  settled_net: null,
  frequency: "one-time",
  via: "stripe",
  source: "bg-marketplace",
  form_id: null,
  form_name: null,
  form_tag: null,
  program_id: null,
  program_name: null,
  from_email: "jane@example.com",
  from_name: "Jane Doe",
  from_company: null,
  from_addr: null,
  sttl_id: null,
  sttl_date: null,
  sttl_currency: null,
};

describe("to_csv_row's stripe payout", () => {
  const routed = {
    ...dist,
    stripe_routed_to: "acct_1",
    date_created: new Date().toISOString(),
  };

  test("a pooled dist has none, so its allocation stands", () => {
    expect(to_csv_row(dist)).toMatchObject({
      stripe_payout: undefined,
      allocation: { cash: 100, liq: 0, lock: 0 },
    });
  });

  test("a routed dist with its transfer was paid out", () => {
    const row = to_csv_row({ ...routed, stripe_transfer_id: "tr_1" });
    expect(row.stripe_payout).toBe("paid");
  });

  test("a routed dist with no transfer yet is sending", () => {
    expect(to_csv_row(routed).stripe_payout).toBe("sending");
  });

  test.each(["refunded", "refunded_loss"] as const)(
    "a routed dist %s before its transfer was not sent",
    (status) => {
      expect(to_csv_row({ ...routed, status }).stripe_payout).toBe("not_sent");
    }
  );

  test("a routed dist refunded after its transfer reads fully reversed", () => {
    const row = to_csv_row({
      ...routed,
      status: "refunded",
      stripe_transfer_id: "tr_1",
    });
    expect(row.stripe_payout).toBe("reversed");
  });
});
