import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
vi.mock("./kit/stripe", () => ({
  stripe: { paymentIntents: { search, cancel } },
}));

import { close_stripe_payments } from "./stripe-close";

const NOW = new Date("2026-06-01T12:00:00Z").getTime();
const recent = new Date(NOW - 60_000).toISOString();
const old = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
const row = (id: string, created_at = recent) => ({ id, created_at });
const found = (...status: string[]) => ({
  data: status.map((s, i) => ({ id: `pi_${i}`, status: s })),
});

beforeEach(() => {
  search.mockReset();
  cancel.mockReset();
  cancel.mockResolvedValue({});
});

describe("close_stripe_payments", () => {
  it.each([
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
  ])("cancels an intent that is %s", async (status) => {
    search.mockResolvedValue(found(status));
    expect(await close_stripe_payments([row("d1")], NOW)).toEqual(["d1"]);
    expect(cancel).toHaveBeenCalledWith("pi_0");
  });

  it("finds the intent by the donation id", async () => {
    search.mockResolvedValue(found("canceled"));
    await close_stripe_payments([row("d-1")], NOW);
    expect(search.mock.calls[0][0].query).toBe("metadata['order_id']:'d-1'");
  });

  it("an intent that is already canceled needs no cancel", async () => {
    search.mockResolvedValue(found("canceled"));
    expect(await close_stripe_payments([row("d1")], NOW)).toEqual(["d1"]);
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "processing", "requires_capture"])(
    "refuses an intent that is %s, cancelling nothing",
    async (status) => {
      search.mockResolvedValue(found(status));
      expect(await close_stripe_payments([row("d1")], NOW)).toBeNull();
      expect(cancel).not.toHaveBeenCalled();
    }
  );

  it("refuses when stripe refuses the cancel (the donor got there first)", async () => {
    search.mockResolvedValue(found("requires_action"));
    cancel.mockRejectedValue(new Error("payment_intent_unexpected_state"));
    expect(await close_stripe_payments([row("d1")], NOW)).toBeNull();
  });

  it("refuses when any one of several intents can't be closed", async () => {
    search.mockResolvedValue(found("requires_action", "succeeded"));
    expect(await close_stripe_payments([row("d1")], NOW)).toBeNull();
  });

  it("refuses a recent row the search can't find yet", async () => {
    search.mockResolvedValue(found());
    expect(await close_stripe_payments([row("d1", recent)], NOW)).toBeNull();
  });

  it("an old row with no intent never started a payment", async () => {
    search.mockResolvedValue(found());
    expect(await close_stripe_payments([row("d1", old)], NOW)).toEqual(["d1"]);
  });

  it("one that can't be closed refuses the lot", async () => {
    search
      .mockResolvedValueOnce(found("requires_action"))
      .mockResolvedValueOnce(found("succeeded"));
    expect(await close_stripe_payments([row("d1"), row("d2")], NOW)).toBeNull();
  });
});
