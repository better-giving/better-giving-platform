import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks (hoisted) ---

const user_update = vi.hoisted(() => vi.fn());

vi.mock("#/.server/auth", () => ({
  user_ctx: Symbol("user_ctx"),
}));

vi.mock("$/pg/queries/user", () => ({
  user_get: vi.fn(),
  user_update,
}));

// --- imports (after mocks hoisted) ---

import { config } from "#/pages/user-dashboard/referrals/config";
import { action } from "./api";

const call = (body: string) =>
  (action as any)({
    request: new Request("https://app.test/dashboard/referrals/payout-min", {
      method: "PUT",
      body,
    }),
    params: {},
    // the route runs behind the dashboard middleware; the session is a given
    context: { get: () => ({ email: "one@example.com" }) },
  });

beforeEach(() => {
  user_update.mockReset();
  user_update.mockResolvedValue(undefined);
});

describe("payout threshold", () => {
  it("writes an amount at or above the floor", async () => {
    await call(String(config.pay_min));

    expect(user_update).toHaveBeenCalledWith("one@example.com", {
      pay_min: config.pay_min,
    });
  });

  it("refuses a body that is not a number", async () => {
    // `+"abc"` is NaN, which the column accepts
    await expect(call("abc")).rejects.toMatchObject({ status: 400 });

    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses an empty body", async () => {
    await expect(call("")).rejects.toMatchObject({ status: 400 });

    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses an amount below the floor", async () => {
    await expect(call(String(config.pay_min - 1))).rejects.toMatchObject({
      status: 400,
    });

    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses a negative amount", async () => {
    await expect(call("-100")).rejects.toMatchObject({ status: 400 });

    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses cents, which the integer column can't hold", async () => {
    await expect(call(`${config.pay_min}.50`)).rejects.toMatchObject({
      status: 400,
    });

    expect(user_update).not.toHaveBeenCalled();
  });

  it("refuses Infinity", async () => {
    await expect(call("Infinity")).rejects.toMatchObject({ status: 400 });

    expect(user_update).not.toHaveBeenCalled();
  });
});
