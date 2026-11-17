import { beforeEach, describe, expect, it, vi } from "vitest";

const reg_get = vi.hoisted(() => vi.fn());
const wise = vi.hoisted(() => ({ v2_account: vi.fn() }));

vi.mock("$/pg/queries/registration", () => ({ reg_get }));
vi.mock("$/kit/wise", () => ({ wise }));
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
});

describe("registration review", () => {
  it("reads the bank on file from wise", async () => {
    const d = await review_get(REG_ID);

    expect(wise.v2_account).toHaveBeenCalledWith(40000001);
    expect(d.wacc_unavailable).toBe(false);
  });

  it("asks wise nothing when the registration has no bank (Stripe only)", async () => {
    reg_get.mockResolvedValue({ id: REG_ID, status: "02", o_bank_id: "" });

    const d = await review_get(REG_ID);

    expect(wise.v2_account).not.toHaveBeenCalled();
    expect(d.wacc_unavailable).toBe(false);
  });

  it("is unavailable when wise can't return the account", async () => {
    wise.v2_account.mockRejectedValue(new Error("wise down"));

    const d = await review_get(REG_ID);

    expect(d.wacc_unavailable).toBe(true);
  });
});
