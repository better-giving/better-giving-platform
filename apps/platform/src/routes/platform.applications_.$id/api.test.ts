import { beforeEach, describe, expect, it, vi } from "vitest";

const reg_get = vi.hoisted(() => vi.fn());
const wise = vi.hoisted(() => ({ v2_account: vi.fn() }));
const own = vi.hoisted(() => ({ is_own_recipient: vi.fn() }));

vi.mock("$/pg/queries/registration", () => ({ reg_get }));
vi.mock("$/kit/wise", () => ({ wise }));
vi.mock("$/payouts/own-accounts", () => own);
vi.mock("#/errors/report", () => ({
  report_degraded: () => {},
  report_degraded_null: () => null,
}));
vi.mock("$/env", () => ({ stripe: { connect_routing: false } }));

import { review_get } from "./api";

const REG_ID = "e0000000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  reg_get.mockReset().mockResolvedValue({
    id: REG_ID,
    status: "02",
    o_bank_id: "40000001",
    o_bank_statement: "https://example.com/s.pdf",
  });
  wise.v2_account.mockReset().mockResolvedValue({ currency: "USD" });
  own.is_own_recipient.mockReset().mockResolvedValue(false);
});

describe("registration review: own-account flag", () => {
  it.each([
    [
      "a confirmed match",
      () => own.is_own_recipient.mockResolvedValue(true),
      true,
    ],
    ["no match", () => own.is_own_recipient.mockResolvedValue(false), false],
    [
      "a check that could not run",
      () => own.is_own_recipient.mockRejectedValue(new Error("503")),
      "unknown",
    ],
  ])("is %s", async (_name, arrange, expected) => {
    arrange();

    expect((await review_get(REG_ID)).own_account).toBe(expected);
  });

  it("is false when the registration has no bank (Stripe only), and asks nothing", async () => {
    reg_get.mockResolvedValue({ id: REG_ID, status: "02", o_bank_id: "" });

    expect((await review_get(REG_ID)).own_account).toBe(false);
    expect(own.is_own_recipient).not.toHaveBeenCalled();
  });

  it("is false when wise can't return the account", async () => {
    wise.v2_account.mockRejectedValue(new Error("wise down"));

    const d = await review_get(REG_ID);

    expect(d.wacc_unavailable).toBe(true);
    expect(d.own_account).toBe(false);
  });
});
