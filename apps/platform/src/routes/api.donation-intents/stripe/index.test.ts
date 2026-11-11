import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "../types";

const pi_create_mock = vi.hoisted(() => vi.fn());
const si_create_mock = vi.hoisted(() => vi.fn());
const npo_get_mock = vi.hoisted(() => vi.fn());
const routing = vi.hoisted(() => ({ on: false }));

vi.mock("$/kit/stripe", () => ({
  stripe: {
    paymentIntents: { create: pi_create_mock },
    setupIntents: { create: si_create_mock },
  },
}));
vi.mock("#/.server/unit-per-usd", () => ({ unit_per_usd: async () => 1 }));
vi.mock("./customer-with-currency", () => ({
  customer_with_currency: async () => "cus_1",
}));
vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("$/pg/queries/npo", () => ({ npo_get: npo_get_mock }));
vi.mock("$/env", async (importOriginal) => {
  const env = await importOriginal<typeof import("$/env")>();
  return {
    ...env,
    stripe: {
      ...env.stripe,
      get connect_routing() {
        return routing.on;
      },
    },
  };
});
const donation_update_mock = vi.hoisted(() => vi.fn());
vi.mock("$/pg/queries/donation", () => ({
  donation_put: async (_db: unknown, r: unknown) => r,
  donation_update: donation_update_mock,
}));

const { stripe_intent } = await import("./index");

const ctx = (patch: Partial<Ctx["intent"]> = {}, via: Ctx["via"] = "bank") =>
  ({
    to: { to_id: "1", to_type: "npo", to_name: "ACME" },
    from: { from_email: "a@b.co" },
    donor: { email: "a@b.co" },
    via,
    via_extra: "",
    intent: {
      amount: { base: 10_000, tip: 0, fee_allowance: 0 },
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      ...patch,
    },
  }) as unknown as Ctx;

/** the shape stripe-node throws for a 400 from the api */
const stripe_refusal = (code: string, message: string) =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code,
    message,
  });

beforeEach(() => {
  vi.clearAllMocks();
  donation_update_mock.mockResolvedValue({});
  routing.on = false;
});

describe("stripe_intent refusals", () => {
  const above =
    "This amount is above the limit for this payment method. Try a smaller amount or a different payment method.";
  const below =
    "This amount is below the minimum for this payment method. Try a larger amount or a different payment method.";

  it.each([
    ["amount_too_large", above],
    ["charge_exceeds_transaction_limit", above],
    ["amount_too_small", below],
  ])("answers %s with a donor-safe 400", async (code, reason) => {
    pi_create_mock.mockRejectedValue(
      stripe_refusal(code, "stripe's own account-specific wording")
    );

    const res = (await stripe_intent(ctx())) as Response;

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    expect(await res.text()).toBe(reason);
  });

  it("logs a mapped refusal with stripe's code, raw message and the donation id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    pi_create_mock.mockRejectedValue(
      stripe_refusal("amount_too_large", "greater than $3,000.00 CAD")
    );

    await stripe_intent(ctx());

    const don_id = pi_create_mock.mock.calls[0]![0].metadata.order_id;
    const line = info.mock.calls.map((c) => c.join(" ")).join("\n");
    info.mockRestore();
    expect(line).toContain("amount_too_large");
    expect(line).toContain("greater than $3,000.00 CAD");
    expect(line).toContain(don_id);
  });

  it("answers an amount under the platform minimum with a donor-safe 400", async () => {
    const res = (await stripe_intent(
      ctx({ amount: { base: 1, tip: 0, fee_allowance: 0 } })
    )) as Response;

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    expect(await res.text()).toBe(
      "The minimum donation is $2. Try a larger amount."
    );
    expect(pi_create_mock).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-stripe error", new Error("socket hang up")],
    [
      "a stripe error with no code",
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        message: "no code here",
      }),
    ],
  ])("rethrows %s without logging", async (_, err) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    pi_create_mock.mockRejectedValue(err);

    const outcome = stripe_intent(ctx());
    await expect(outcome).rejects.toBe(err);
    const logged = info.mock.calls.length;
    info.mockRestore();
    expect(logged).toBe(0);
  });

  it("marks the donation failed when the intent could not be created, refused or not", async () => {
    pi_create_mock.mockRejectedValue(
      stripe_refusal("amount_too_large", "too much")
    );
    await stripe_intent(ctx());
    const don_id = pi_create_mock.mock.calls[0]![0].metadata.order_id;
    expect(donation_update_mock).toHaveBeenCalledWith({}, don_id, {
      status: "failed",
    });

    donation_update_mock.mockClear();
    pi_create_mock.mockRejectedValue(new Error("socket hang up"));
    await expect(stripe_intent(ctx())).rejects.toThrow("socket hang up");
    expect(donation_update_mock).toHaveBeenCalledTimes(1);
  });

  it("leaves the donation alone when the intent was created", async () => {
    pi_create_mock.mockResolvedValue({ client_secret: "pi_secret" });
    await stripe_intent(ctx());
    expect(donation_update_mock).not.toHaveBeenCalled();
  });

  it("rethrows a stripe error the donor can't act on", async () => {
    const err = stripe_refusal("parameter_invalid_integer", "bad amount");
    pi_create_mock.mockRejectedValue(err);

    await expect(stripe_intent(ctx())).rejects.toBe(err);
  });
});

describe("recurring setup: acss mandate currency", () => {
  beforeEach(() => {
    si_create_mock.mockResolvedValue({ client_secret: "seti_secret" });
  });

  const setup_params = () => si_create_mock.mock.calls[0]![0];

  it("mandates acss in the order's currency", async () => {
    await stripe_intent(ctx({ frequency: "monthly", currency: "USD" }));

    expect(setup_params().payment_method_options.acss_debit.currency).toBe(
      "usd"
    );
    expect(setup_params().payment_method_types).toContain("acss_debit");
  });

  it("offers both bank methods for a USD order on the bank tab", async () => {
    await stripe_intent(ctx({ frequency: "monthly", currency: "USD" }, "bank"));

    expect(setup_params().payment_method_types).toEqual([
      "us_bank_account",
      "acss_debit",
    ]);
  });

  it("offers only acss for a CAD order on the bank tab", async () => {
    await stripe_intent(ctx({ frequency: "monthly", currency: "CAD" }, "bank"));

    expect(setup_params().payment_method_types).toEqual(["acss_debit"]);
  });

  it("refuses a EUR order on the bank tab before any setup intent exists", async () => {
    const res = (await stripe_intent(
      ctx({ frequency: "monthly", currency: "EUR" }, "bank")
    )) as Response;

    expect(res.status).toBe(400);
    expect(res.headers.get("x-refusal")).toBe("1");
    expect(await res.text()).toBe(
      "Recurring bank payments are available in USD and CAD. Choose one of those currencies or pay by card."
    );
    expect(si_create_mock).not.toHaveBeenCalled();
  });

  it("excludes both bank methods for a EUR order among dynamic methods", async () => {
    await stripe_intent(ctx({ frequency: "monthly", currency: "EUR" }, "card"));

    expect(setup_params().payment_method_options?.acss_debit).toBeUndefined();
    expect(setup_params().automatic_payment_methods).toEqual({ enabled: true });
    expect(setup_params().excluded_payment_method_types).toEqual([
      "us_bank_account",
      "acss_debit",
    ]);
  });

  it("excludes us bank accounts for a CAD order among dynamic methods", async () => {
    await stripe_intent(ctx({ frequency: "monthly", currency: "CAD" }, "card"));

    expect(setup_params().excluded_payment_method_types).toEqual([
      "us_bank_account",
    ]);
  });

  it("excludes no bank method for a USD order among dynamic methods", async () => {
    await stripe_intent(ctx({ frequency: "monthly", currency: "USD" }, "card"));

    expect(setup_params().excluded_payment_method_types).toBeUndefined();
  });
});

describe("one-time card: statement descriptor suffix", () => {
  /** the npo row fields routing reads, ready to route */
  const routable = {
    name: "Cáritas",
    stripe_account_id: "acct_1",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_details_submitted: true,
    stripe_requirements_due: [],
    fiscal_sponsored: false,
    hq_country: "Spain",
    stripe_deauthorized_at: null,
  };

  beforeEach(() => {
    routing.on = true;
    npo_get_mock.mockResolvedValue(routable);
    pi_create_mock.mockResolvedValue({ client_secret: "pi_secret" });
  });

  const pi_params = () => pi_create_mock.mock.calls[0]![0];

  it("names a routable npo beside our prefix", async () => {
    await stripe_intent(ctx({}, "card"));

    expect(npo_get_mock).toHaveBeenCalledWith(1);
    expect(pi_params().statement_descriptor_suffix).toBe("CARITAS");
  });

  it.each([
    ["routing is switched off", () => (routing.on = false)],
    [
      "the npo is fiscally sponsored",
      () =>
        npo_get_mock.mockResolvedValue({ ...routable, fiscal_sponsored: true }),
    ],
    [
      "the npo's country is outside the transfer set",
      () =>
        npo_get_mock.mockResolvedValue({
          ...routable,
          hq_country: "Philippines",
        }),
    ],
    [
      "the npo disconnected us",
      () =>
        npo_get_mock.mockResolvedValue({
          ...routable,
          stripe_deauthorized_at: "2026-10-01T00:00:00.000Z",
        }),
    ],
    [
      "the npo's name has nothing printable",
      () => npo_get_mock.mockResolvedValue({ ...routable, name: "希望基金会" }),
    ],
  ])("leaves the intent as it was when %s", async (_case, arrange) => {
    arrange();
    await stripe_intent(ctx({}, "card"));

    expect(pi_params()).not.toHaveProperty("statement_descriptor_suffix");
  });

  it("leaves a fund's intent as it was", async () => {
    await stripe_intent({
      ...ctx({}, "card"),
      to: {
        to_id: "4f3b2a10-9c8d-4e7f-a6b5-c4d3e2f1a0b9",
        to_type: "fund",
        to_name: "Relief Fund",
        to_tip_allowed: true,
        to_members: ["1"],
      },
    });

    expect(npo_get_mock).not.toHaveBeenCalled();
    expect(pi_params()).not.toHaveProperty("statement_descriptor_suffix");
  });

  // a bank debit takes the account's full descriptor, never a suffix
  it("leaves a bank-tab intent as it was", async () => {
    await stripe_intent(ctx({}, "bank"));

    expect(npo_get_mock).not.toHaveBeenCalled();
    expect(pi_params()).not.toHaveProperty("statement_descriptor_suffix");
  });
});
