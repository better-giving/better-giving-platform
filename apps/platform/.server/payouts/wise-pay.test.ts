import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const wise = vi.hoisted(() => ({
  v2_account: vi.fn(),
  quote: vi.fn(),
  transfer: vi.fn(),
  fund_transfer: vi.fn(),
  cancel_transfer: vi.fn(),
}));
const own = vi.hoisted(() => ({ is_own_recipient: vi.fn() }));
const slack = vi.hoisted(() => ({ send_alert: vi.fn() }));
const report_error = vi.hoisted(() => vi.fn());

vi.mock("../env", () => ({ stage: "test", wise: { profile_id: "42" } }));
vi.mock("#/errors/report", () => ({ report_error }));
vi.mock("../kit/wise", () => ({ wise }));
vi.mock("../kit/slack", () => ({ aws_monitor: slack }));
vi.mock("./own-accounts", () => own);

const { wise_pay } = await import("./wise-pay");
const { NotFundedError } = await import("./transfer");

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
  slack.send_alert.mockReset().mockResolvedValue(undefined);
  report_error.mockReset();
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

  test("the quote is asked for the run's total, priced for funding from the balance", async () => {
    await wise_pay(777, 100, REF);
    expect(wise.quote).toHaveBeenCalledWith(
      "42",
      expect.objectContaining({ sourceAmount: 100, preferredPayIn: "BALANCE" })
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

  test("a recipient that is one of our own wise accounts is paid as normal, and ops is warned once", async () => {
    own.is_own_recipient.mockResolvedValue(true);
    wise.v2_account.mockResolvedValue({
      currency: "EUR",
      name: { fullName: "Better Giving Inc" },
    });

    await expect(wise_pay(881063184, 72.82, REF)).resolves.toBe(TRANSFER_ID);

    expect(wise.quote).toHaveBeenCalledOnce();
    expect(wise.transfer).toHaveBeenCalledOnce();
    expect(wise.fund_transfer).toHaveBeenCalledOnce();
    expect(slack.send_alert).toHaveBeenCalledOnce();
    const [alert] = slack.send_alert.mock.calls[0]!;
    expect(alert.title).toBe(
      "payout to one of Better Giving's own Wise accounts"
    );
    expect(alert.fields).toEqual(
      expect.arrayContaining([
        { name: "recipient", value: "881063184" },
        { name: "holder", value: "Better Giving Inc" },
        { name: "customerTransactionId", value: REF },
      ])
    );
  });

  test("a failed lookup of our own accounts pays as normal and tells ops the check could not run", async () => {
    own.is_own_recipient.mockRejectedValue("account-details 503");

    await expect(wise_pay(777, 100, REF)).resolves.toBe(TRANSFER_ID);

    expect(wise.fund_transfer).toHaveBeenCalledOnce();
    expect(slack.send_alert).toHaveBeenCalledOnce();
    const [alert] = slack.send_alert.mock.calls[0]!;
    expect(alert.title).toBe("own-account check could not run before a payout");
    expect(alert.body).toContain("account-details 503");
    expect(alert.fields).toEqual(
      expect.arrayContaining([
        { name: "recipient", value: "777" },
        { name: "customerTransactionId", value: REF },
      ])
    );
  });

  test("an ordinary recipient raises no alert", async () => {
    await wise_pay(777, 100, REF);
    expect(slack.send_alert).not.toHaveBeenCalled();
  });

  test("a warning that fails to send never blocks the payout, and is reported", async () => {
    own.is_own_recipient.mockResolvedValue(true);
    slack.send_alert.mockRejectedValue(new Error("slack down"));

    await expect(wise_pay(881063184, 72.82, REF)).resolves.toBe(TRANSFER_ID);

    expect(wise.fund_transfer).toHaveBeenCalledOnce();
    expect(slack.send_alert).toHaveBeenCalledOnce();
    expect(report_error).toHaveBeenCalledWith(expect.any(Error), {
      alert: "payout to one of Better Giving's own Wise accounts",
    });
  });

  test("the warning goes out after funding was accepted, not before the money moves", async () => {
    own.is_own_recipient.mockResolvedValue(true);

    await wise_pay(881063184, 72.82, REF);

    expect(wise.fund_transfer.mock.invocationCallOrder[0]!).toBeLessThan(
      slack.send_alert.mock.invocationCallOrder[0]!
    );
  });

  test.each([
    [
      "the transfer is answered with errors",
      () =>
        wise.transfer.mockResolvedValue({
          id: TRANSFER_ID,
          errors: [{ code: "x" }],
        }),
    ],
    [
      "funding is rejected",
      () =>
        wise.fund_transfer.mockResolvedValue({
          status: "REJECTED",
          errorCode: "balance",
        }),
    ],
  ])(
    "no warning goes out when %s: nothing was paid",
    async (_name, arrange) => {
      own.is_own_recipient.mockResolvedValue(true);
      arrange();

      await expect(wise_pay(881063184, 72.82, REF)).rejects.toBeInstanceOf(
        NotFundedError
      );

      expect(slack.send_alert).not.toHaveBeenCalled();
    }
  );

  describe("a hung dependency never strands a payout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("a Slack call that never answers is given up on after a few seconds", async () => {
      own.is_own_recipient.mockResolvedValue(true);
      slack.send_alert.mockReturnValue(new Promise(() => {}));

      const paid = wise_pay(881063184, 72.82, REF);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(paid).resolves.toBe(TRANSFER_ID);
    });

    test("an own-account lookup that never answers is treated as a check that could not run, and the payout goes ahead", async () => {
      own.is_own_recipient.mockReturnValue(new Promise(() => {}));

      const paid = wise_pay(777, 100, REF);
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(paid).resolves.toBe(TRANSFER_ID);
      expect(slack.send_alert).toHaveBeenCalledOnce();
      expect(slack.send_alert.mock.calls[0]![0].title).toBe(
        "own-account check could not run before a payout"
      );
    });
  });
});
