import { beforeEach, describe, expect, test, vi } from "vitest";

const wise = vi.hoisted(() => ({
  v2_account: vi.fn(),
  quote: vi.fn(),
  transfer: vi.fn(),
  fund_transfer: vi.fn(),
  cancel_transfer: vi.fn(),
}));
const own = vi.hoisted(() => ({ is_own_recipient: vi.fn() }));

vi.mock("../env", () => ({ wise: { profile_id: "42" } }));
vi.mock("../kit/wise", () => ({ wise }));
vi.mock("./own-accounts", () => own);

const { wise_pay } = await import("./wise-pay");
const { NotFundedError, PayRefused } = await import("./transfer");

const TRANSFER_ID = 9001;
const REF = "0d3c1b52-7a4e-5c1f-9a2b-3c4d5e6f7a8b";
const quote_expired = [{ code: "error.quote.expired" }];

const quote = () => ({ id: "quote-1" });
const waiting = () => ({
  id: TRANSFER_ID,
  status: "incoming_payment_waiting",
});

beforeEach(() => {
  wise.v2_account.mockReset().mockResolvedValue({ currency: "EUR" });
  wise.quote.mockReset().mockResolvedValue(quote());
  wise.transfer.mockReset().mockResolvedValue(waiting());
  wise.fund_transfer.mockReset().mockResolvedValue({ status: "COMPLETED" });
  wise.cancel_transfer
    .mockReset()
    .mockResolvedValue({ id: TRANSFER_ID, status: "cancelled" });
  own.is_own_recipient.mockReset().mockResolvedValue(false);
});

describe("wise_pay", () => {
  test("funds the transfer keyed on the ref and returns its id", async () => {
    await expect(wise_pay(777, 100, REF)).resolves.toBe(TRANSFER_ID);
    expect(wise.transfer).toHaveBeenCalledWith(
      expect.objectContaining({ customerTransactionId: REF })
    );
    expect(wise.fund_transfer).toHaveBeenCalledWith(TRANSFER_ID, 42, {
      type: "BALANCE",
    });
  });

  test.each([
    ["the recipient lookup", "account 404", () => wise.v2_account],
    ["the quote", "quote 503", () => wise.quote],
    ["the transfer call", "transfer 500", () => wise.transfer],
  ])(
    "a throw from %s is not funded, and funding is never asked",
    async (_, cause, step) => {
      step().mockRejectedValue(cause);

      const err = await wise_pay(777, 100, REF).catch((e) => e);

      expect(err).toBeInstanceOf(NotFundedError);
      expect(err.cause).toBe(cause);
      expect(wise.fund_transfer).not.toHaveBeenCalled();
    }
  );

  test("a transfer answered with errors is not funded, and funding is never asked", async () => {
    wise.transfer.mockResolvedValue({ id: TRANSFER_ID, errors: quote_expired });

    const err = await wise_pay(777, 100, REF).catch((e) => e);

    expect(err).toBeInstanceOf(NotFundedError);
    expect(err.cause).toBe(quote_expired);
    expect(wise.fund_transfer).not.toHaveBeenCalled();
  });

  test("funding rejected by wise is not funded", async () => {
    wise.fund_transfer.mockResolvedValue({
      status: "REJECTED",
      errorCode: "balance.payment-option-unavailable",
    });

    const err = await wise_pay(777, 100, REF).catch((e) => e);

    expect(err).toBeInstanceOf(NotFundedError);
    expect(String(err.cause)).toContain("balance.payment-option-unavailable");
  });

  test.each([
    "incoming_payment_initiated",
    "processing",
    "funds_converted",
    "outgoing_payment_sent",
  ])(
    "a ref reused within its claim whose transfer is already funded (%s) is paid, and not funded again",
    async (status) => {
      wise.transfer.mockResolvedValue({ id: TRANSFER_ID, status });

      await expect(wise_pay(777, 100, REF)).resolves.toBe(TRANSFER_ID);
      expect(wise.fund_transfer).not.toHaveBeenCalled();
    }
  );

  test("a reused ref whose transfer wise cancelled unfunded is not funded, and funding is never asked", async () => {
    wise.transfer.mockResolvedValue({ id: TRANSFER_ID, status: "cancelled" });

    const err = await wise_pay(777, 100, REF).catch((e) => e);

    expect(err).toBeInstanceOf(NotFundedError);
    expect(String(err.cause)).toContain(REF);
    expect(wise.fund_transfer).not.toHaveBeenCalled();
  });

  test.each(["funds_refunded", "bounced_back", "charged_back", undefined])(
    "a reused ref whose transfer is %s is neither funded nor called unfunded",
    async (status) => {
      wise.transfer.mockResolvedValue({ id: TRANSFER_ID, status });

      const err = await wise_pay(777, 100, REF).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(NotFundedError);
      expect(String(err)).toContain(REF);
      expect(wise.fund_transfer).not.toHaveBeenCalled();
    }
  );

  test("a throw from the funding call itself is left as funding status unknown", async () => {
    wise.fund_transfer.mockRejectedValue("fetch failed");

    const err = await wise_pay(777, 100, REF).catch((e) => e);

    expect(err).not.toBeInstanceOf(NotFundedError);
    expect(err).toBe("fetch failed");
  });

  test("the quote is asked for the run's total, with no payment method preferred", async () => {
    await wise_pay(777, 100, REF);
    expect(wise.quote).toHaveBeenCalledWith(
      "42",
      expect.objectContaining({ sourceAmount: 100, preferredPayIn: null })
    );
  });

  test("wise's own amounts are not second-guessed: a quote or transfer that reports another figure, or none, is still funded", async () => {
    wise.quote.mockResolvedValue({ id: "quote-1", sourceAmount: 97.07 });
    wise.transfer.mockResolvedValue({
      id: TRANSFER_ID,
      status: "incoming_payment_waiting",
    });

    await expect(wise_pay(777, 100, REF)).resolves.toBe(TRANSFER_ID);

    expect(wise.cancel_transfer).not.toHaveBeenCalled();
    expect(wise.fund_transfer).toHaveBeenCalledOnce();
  });

  test("a recipient that is one of our own wise accounts is refused before any quote", async () => {
    own.is_own_recipient.mockResolvedValue(true);

    const err = await wise_pay(881063184, 72.82, REF).catch((e) => e);

    expect(err).toBeInstanceOf(NotFundedError);
    expect(err.cause).toBeInstanceOf(PayRefused);
    expect(String(err.cause)).toContain("881063184");
    expect(wise.quote).not.toHaveBeenCalled();
    expect(wise.fund_transfer).not.toHaveBeenCalled();
  });

  test("a failed lookup of our own accounts refuses the payout", async () => {
    own.is_own_recipient.mockRejectedValue("account-details 503");

    const err = await wise_pay(777, 100, REF).catch((e) => e);

    expect(err).toBeInstanceOf(NotFundedError);
    expect(err.cause).toBeInstanceOf(PayRefused);
    expect(String(err.cause)).toContain("account-details 503");
    expect(wise.quote).not.toHaveBeenCalled();
  });
});
