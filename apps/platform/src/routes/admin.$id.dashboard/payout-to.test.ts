import { describe, expect, it } from "vitest";
import { payout_to } from "./payout-to";

const npo = (o: Record<string, unknown> = {}) => ({
  stripe_account_id: "acct_1",
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
  stripe_details_submitted: true,
  stripe_requirements_due: [],
  stripe_deauthorized_at: null,
  fiscal_sponsored: false,
  hq_country: "United States",
  ...o,
});

const bank = { bank_summary: "Test Bank ***1234" };

describe("payout_to", () => {
  it("is the bank whenever one is on file", () => {
    expect(payout_to(bank, npo(), true)).toEqual({
      kind: "bank",
      summary: "Test Bank ***1234",
    });
  });

  it("is a ready stripe account with no bank", () => {
    expect(payout_to(undefined, npo(), true)).toEqual({
      kind: "stripe",
      ready: true,
    });
  });

  it("is a stripe account stripe hasn't finished, with no bank", () => {
    expect(
      payout_to(undefined, npo({ stripe_details_submitted: false }), true)
    ).toEqual({ kind: "stripe", ready: false });
  });

  it.each([
    [
      "a disconnected stripe account",
      npo({ stripe_deauthorized_at: "2026-11-01" }),
      true,
    ],
    ["no stripe account", npo({ stripe_account_id: null }), true],
    ["routing off", npo(), false],
    ["a fiscally sponsored npo", npo({ fiscal_sponsored: true }), true],
  ])("is nowhere with no bank and %s", (_, n, routing_on) => {
    expect(payout_to(undefined, n, routing_on)).toEqual({ kind: "none" });
  });
});
