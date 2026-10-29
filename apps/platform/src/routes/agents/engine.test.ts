import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { calc_settlement_plan, settled_parts } from "@/settlement/plan";
import type { IQuoteBreakdown } from "./engine";

const KEY = "test-only-not-a-real-nonprofits-key";

const env = vi.hoisted(() => ({
  app: {
    api_encryption_key: "test-quote-key",
    agent_donation_token: "agent-token-test",
    nonprofits_api_key: "test-only-not-a-real-nonprofits-key" as
      | string
      | undefined,
  },
  base_url: "https://better.giving",
}));

const mocks = vi.hoisted(() => ({
  npo_name_search: vi.fn(),
  npos_batch_get: vi.fn(),
  to_fn: vi.fn(),
  reserve: vi.fn(),
  donation_get: vi.fn(),
  checkout_save: vi.fn(),
  npo_get: vi.fn(),
  npo_by_regnum: vi.fn(),
  npos_by_regnums: vi.fn(),
  npo_program_get: vi.fn(),
  checkout_session: vi.fn(),
  checkout_session_state: vi.fn(),
  descriptor: vi.fn(),
  expire: vi.fn(),
  report_error: vi.fn(),
}));

vi.mock("$/env", () => env);

vi.mock("#/.server/donation-recipient", () => ({ to_fn: mocks.to_fn }));
vi.mock("$/pg/queries/donation", () => ({
  agent_checkout_save: mocks.checkout_save,
  agent_donation_expire: mocks.expire,
  agent_donation_reserve: mocks.reserve,
  donation_get: mocks.donation_get,
}));
vi.mock("$/pg/queries/npo", () => ({
  npo_by_regnum: mocks.npo_by_regnum,
  npos_by_regnums: mocks.npos_by_regnums,
  npo_get: mocks.npo_get,
  npo_name_search: mocks.npo_name_search,
  npos_batch_get: mocks.npos_batch_get,
}));
vi.mock("#/errors/report", () => ({ report_error: mocks.report_error }));
vi.mock("$/pg/queries/program", () => ({
  npo_program_get: mocks.npo_program_get,
}));
vi.mock("#/routes/api.donation-intents/stripe/checkout-session", () => ({
  checkout_session: mocks.checkout_session,
  checkout_session_state: mocks.checkout_session_state,
}));
vi.mock("#/routes/api.donation-intents/stripe/descriptor-suffix", () => ({
  npo_descriptor_suffix: mocks.descriptor,
}));

const { reset_nonprofits_client } = await import("$/nonprofits-api");
const {
  AgentDonationError,
  create_quote,
  donate,
  donation_status,
  find_nonprofit,
} = await import("./engine");

const recipient = {
  to_id: "7",
  to_name: "ACME",
  to_type: "npo" as const,
  to_tip_allowed: true,
  to_members: [],
};
const donor = {
  email: "donor@example.com",
  first_name: "Ada",
  last_name: "Lovelace",
};

let caller_n = 0;

function caller(ip?: string): Request {
  caller_n += 1;
  return new Request("https://better.giving/agents/mcp", {
    headers: { "x-forwarded-for": ip ?? `192.0.2.${caller_n}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  env.app.nonprofits_api_key = KEY;
  reset_nonprofits_client();
  vi.stubGlobal("fetch", () => {
    throw new Error("unexpected nonprofits fetch");
  });
  // clearAllMocks keeps implementations, so a test's own setup would otherwise leak into the next
  mocks.npo_name_search.mockResolvedValue([]);
  mocks.npos_by_regnums.mockResolvedValue([]);
  mocks.to_fn.mockResolvedValue(recipient);
  mocks.reserve.mockResolvedValue("created");
  mocks.donation_get.mockResolvedValue(undefined);
  mocks.checkout_save.mockResolvedValue(true);
  mocks.npo_get.mockResolvedValue({ donor_address_required: false });
  mocks.descriptor.mockResolvedValue("ACME");
  mocks.expire.mockResolvedValue(true);
  mocks.checkout_session.mockResolvedValue({
    id: "cs_test_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
  });
});

function saved(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    source: "bg-agent",
    status: "created",
    from_email: donor.email,
    to_id: "7",
    to_name: "ACME",
    to_type: "npo",
    amount: { base: 10, tip: 0, fee_allowance: 0 },
    ...patch,
  };
}

async function quote(
  patch: Partial<{
    amount: number;
    tip_percent: "none" | "10" | "15" | "20";
    cover_processing_fee: boolean;
  }> = {}
) {
  return create_quote({
    recipient_id: 7,
    amount: 10,
    tip_percent: "none",
    cover_processing_fee: false,
    ...patch,
  });
}

/** how a breakdown breaks the quote's bound: every field a non-negative whole
 * cent, the charge's parts and its destinations each summing to it exactly */
function unbalanced(b: IQuoteBreakdown): string[] {
  const errors = Object.entries(b)
    .filter(([, x]) => x < 0 || x !== Math.round(x * 100) / 100)
    .map(([k, x]) => `${k} ${x}`);
  const cents = (xs: number[]) =>
    xs.reduce((sum, x) => sum + Math.round(x * 100), 0);
  const total = cents([b.total_charged]);
  if (cents([b.amount, b.tip, b.fee_allowance]) !== total) {
    errors.push("charge parts don't sum");
  }
  const destinations = cents([
    b.nonprofit_receives,
    b.platform_fee,
    b.fiscal_sponsor_fee,
    b.processing_fee,
    b.better_giving_receives,
  ]);
  if (destinations !== total) errors.push("destinations don't sum");
  return errors;
}

describe("agent quote", () => {
  test("returns the same USD amount split the card form uses", async () => {
    const result = await quote({
      tip_percent: "10",
      cover_processing_fee: true,
    });

    expect(result).toMatchObject({
      recipient: { id: "7", name: "ACME", type: "npo" },
      currency: "USD",
      frequency: "one-time",
      amount: { base: 10, tip: 1, fee_allowance: 0.56, total: 11.56 },
    });
  });

  test.each([
    {
      label: "$10, 10% tip, fee covered",
      npo: {},
      patch: { tip_percent: "10", cover_processing_fee: true },
      breakdown: {
        amount: 10,
        tip: 1,
        fee_allowance: 0.56,
        total_charged: 11.56,
        processing_fee: 0.55,
        platform_fee: 0,
        fiscal_sponsor_fee: 0,
        nonprofit_receives: 10,
        better_giving_receives: 1.01,
      },
    },
    {
      label: "the same to a fiscally sponsored nonprofit",
      npo: { fiscal_sponsored: true },
      patch: { tip_percent: "10", cover_processing_fee: true },
      breakdown: {
        amount: 10,
        tip: 1,
        fee_allowance: 0.56,
        total_charged: 11.56,
        processing_fee: 0.55,
        platform_fee: 0,
        fiscal_sponsor_fee: 0.29,
        nonprofit_receives: 9.71,
        better_giving_receives: 1.01,
      },
    },
    {
      label: "a nonprofit that turned off tips",
      npo: { hide_bg_tip: true },
      patch: { tip_percent: "none", cover_processing_fee: true },
      breakdown: {
        amount: 10,
        tip: 0,
        fee_allowance: 0.54,
        total_charged: 10.54,
        processing_fee: 0.53,
        platform_fee: 0.15,
        fiscal_sponsor_fee: 0,
        nonprofit_receives: 9.85,
        better_giving_receives: 0.01,
      },
    },
    {
      label: "fee not covered, so the gift pays its share of it",
      npo: {},
      patch: { tip_percent: "10", cover_processing_fee: false },
      breakdown: {
        amount: 10,
        tip: 1,
        fee_allowance: 0,
        total_charged: 11,
        processing_fee: 0.54,
        platform_fee: 0,
        fiscal_sponsor_fee: 0,
        nonprofit_receives: 9.51,
        better_giving_receives: 0.95,
      },
    },
    {
      label: "$100 uncovered to a fiscally sponsored nonprofit",
      npo: { fiscal_sponsored: true },
      patch: { amount: 100, tip_percent: "none", cover_processing_fee: false },
      breakdown: {
        amount: 100,
        tip: 0,
        fee_allowance: 0,
        total_charged: 100,
        processing_fee: 2.5,
        platform_fee: 0,
        fiscal_sponsor_fee: 2.9,
        nonprofit_receives: 94.6,
        better_giving_receives: 0,
      },
    },
    {
      label: "$100 uncovered to a nonprofit that turned off tips",
      npo: { hide_bg_tip: true },
      patch: { amount: 100, tip_percent: "none", cover_processing_fee: false },
      breakdown: {
        amount: 100,
        tip: 0,
        fee_allowance: 0,
        total_charged: 100,
        processing_fee: 2.5,
        platform_fee: 1.5,
        fiscal_sponsor_fee: 0,
        nonprofit_receives: 96,
        better_giving_receives: 0,
      },
    },
  ] as const)(
    "breaks the charge down: $label",
    async ({ npo, patch, breakdown }) => {
      mocks.npo_get.mockResolvedValue({
        donor_address_required: false,
        ...npo,
      });

      const { amount, breakdown: b } = await quote(patch);

      expect(b).toEqual(breakdown);
      expect(b.total_charged).toBe(amount.total);
      expect(unbalanced(b)).toEqual([]);
    }
  );

  test("a gift whose floored split drops a cent still balances to the cent", async () => {
    mocks.npo_get.mockResolvedValue({
      donor_address_required: false,
      hide_bg_tip: true,
      fiscal_sponsored: true,
    });

    const { amount, breakdown: b } = await quote({ amount: 10.88 });

    // settlement's unrounded split of the 10.34 net, its fees on the full
    // 10.88: 9.86128 / 0.1632 / 0.31552 / 0. the floors drop a cent, which goes
    // to the .552 fsa
    expect(b).toEqual({
      amount: 10.88,
      tip: 0,
      fee_allowance: 0,
      total_charged: 10.88,
      processing_fee: 0.54,
      platform_fee: 0.16,
      fiscal_sponsor_fee: 0.32,
      nonprofit_receives: 9.86,
      better_giving_receives: 0,
    });
    expect(b.total_charged).toBe(amount.total);
    expect(unbalanced(b)).toEqual([]);
  });

  test.each([
    { tip_percent: "none", cover_processing_fee: false },
    { tip_percent: "none", cover_processing_fee: true },
    { tip_percent: "10", cover_processing_fee: false },
    { tip_percent: "10", cover_processing_fee: true },
  ] as const)(
    "quotes the fees settlement books for the same $100 charge: %o",
    async (patch) => {
      const npo = { hide_bg_tip: true, fiscal_sponsored: true };
      mocks.npo_get.mockResolvedValue({
        donor_address_required: false,
        ...npo,
      });

      const { amount, breakdown: b } = await quote({ amount: 100, ...patch });

      const plan = calc_settlement_plan(
        {
          id: 7,
          ps: settled_parts(amount, 1, {
            net: b.total_charged - b.processing_fee,
            fee: b.processing_fee,
          }),
          sttl: {
            id: "pi_1",
            date: "2026-01-01T00:00:00.000Z",
            currency: "USD",
          },
          prnt: { id: "d-1", ...recipient, type: "npo" },
          source: undefined,
          program: undefined,
          nav_price: 1,
          tx: {
            currency: "USD",
            upusd: 1,
            frequency: "one-time",
            status: "settled",
            source: "bg-agent",
            via: "stripe:card",
            from_email: donor.email,
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        },
        {
          id: 7,
          name: "ACME",
          ...npo,
          allocation: null,
          lock_units: 0,
          liq: 0,
          referrer_user: null,
          referrer_npo: null,
          referrer_expiry: null,
        },
        null
      );
      expect(b.fiscal_sponsor_fee).toBe(2.9);
      expect(b.platform_fee).toBe(1.5);
      expect(b.fiscal_sponsor_fee).toBeCloseTo(plan.dist.fees.fsa, 2);
      expect(b.platform_fee).toBeCloseTo(plan.dist.fees.base, 2);
      expect(b.nonprofit_receives).toBeCloseTo(plan.dist.net, 2);
    }
  );

  test("every quote's breakdown is whole cents that balance", async () => {
    mocks.npo_get.mockResolvedValue({
      donor_address_required: false,
      hide_bg_tip: true,
      fiscal_sponsored: true,
    });
    const failures: string[] = [];
    for (let c = 200; c <= 1500; c++) {
      for (const tip_percent of ["none", "10", "15", "20"] as const) {
        for (const cover_processing_fee of [false, true]) {
          const { amount, breakdown: b } = await quote({
            amount: c / 100,
            tip_percent,
            cover_processing_fee,
          });
          const errors = unbalanced(b);
          if (b.total_charged !== amount.total) errors.push("total differs");
          if (errors.length) {
            failures.push(
              `${c / 100} tip ${tip_percent} cover ${cover_processing_fee}: ${errors.join(", ")}`
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  }, 30_000);

  test("a fund's breakdown counts only the members settlement pays", async () => {
    mocks.to_fn.mockResolvedValue({
      ...recipient,
      to_id: "1b5c9a4e-7f0e-4c39-9d2e-2f8f3b3c1a11",
      to_type: "fund",
      to_members: ["1", "2"],
    });
    mocks.npos_batch_get.mockResolvedValue([
      { id: 1, active: true, fiscal_sponsored: true },
      { id: 2, active: false, fiscal_sponsored: false },
    ]);

    const result = await create_quote({
      recipient_id: "1b5c9a4e-7f0e-4c39-9d2e-2f8f3b3c1a11",
      amount: 10,
      tip_percent: "10",
      cover_processing_fee: true,
    });

    expect(mocks.npos_batch_get).toHaveBeenCalledWith([1, 2]);
    expect(result.breakdown).toMatchObject({
      fiscal_sponsor_fee: 0.29,
      nonprofit_receives: 9.71,
    });
  });

  test("a fund's gift splits evenly across its funded members, each on its own fees", async () => {
    mocks.to_fn.mockResolvedValue({
      ...recipient,
      to_id: "1b5c9a4e-7f0e-4c39-9d2e-2f8f3b3c1a11",
      to_type: "fund",
      to_members: ["1", "2", "3"],
    });
    mocks.npos_batch_get.mockResolvedValue([
      { id: 1, active: true, fiscal_sponsored: true },
      { id: 2, active: true, hide_bg_tip: true },
      { id: 3, active: false },
    ]);

    const { amount, breakdown: b } = await create_quote({
      recipient_id: "1b5c9a4e-7f0e-4c39-9d2e-2f8f3b3c1a11",
      amount: 10,
      tip_percent: "none",
      cover_processing_fee: false,
    });

    expect(mocks.npos_batch_get).toHaveBeenCalledWith([1, 2, 3]);
    // $10, stripe fee 0.52 -> settled 9.48, so each of the two funded members
    // holds 4.74 of a $5 share. fiscally sponsored: fsa 0.145 on the 5, net
    // 4.595. tip-opt-out: base 0.075 on the 5, net 4.665. sums 9.26 / 0.075 /
    // 0.145, apportioned to whole cents 9.26 / 0.08 / 0.14 (the dropped cent
    // goes to the first of the two .5 fractions, the base)
    expect(b).toEqual({
      amount: 10,
      tip: 0,
      fee_allowance: 0,
      total_charged: 10,
      processing_fee: 0.52,
      platform_fee: 0.08,
      fiscal_sponsor_fee: 0.14,
      nonprofit_receives: 9.26,
      better_giving_receives: 0,
    });
    expect(b.total_charged).toBe(amount.total);
    expect(unbalanced(b)).toEqual([]);
  });

  test("refuses a fund whose members settlement would not pay", async () => {
    mocks.to_fn.mockResolvedValue({
      ...recipient,
      to_id: "1b5c9a4e-7f0e-4c39-9d2e-2f8f3b3c1a11",
      to_type: "fund",
      to_members: ["1", "2"],
    });
    mocks.npos_batch_get.mockResolvedValue([
      { id: 1, active: false },
      { id: 2, active: false },
    ]);

    await expect(
      create_quote({
        recipient_id: "1b5c9a4e-7f0e-4c39-9d2e-2f8f3b3c1a11",
        amount: 10,
      })
    ).rejects.toMatchObject({ code: "recipient_unavailable" });
  });

  test("refuses a nonprofit with no record to settle to", async () => {
    mocks.npo_get.mockResolvedValue(undefined);

    await expect(quote()).rejects.toMatchObject({
      code: "recipient_unavailable",
    });
  });

  test("refuses a nonprofit that requires a donor address", async () => {
    mocks.npo_get.mockResolvedValue({ donor_address_required: true });

    await expect(quote()).rejects.toMatchObject({ code: "address_required" });
  });

  test("refuses a tip when the recipient hides Better Giving tips", async () => {
    mocks.to_fn.mockResolvedValue({ ...recipient, to_tip_allowed: false });

    await expect(quote({ tip_percent: "10" })).rejects.toMatchObject({
      code: "tip_not_allowed",
    });
  });

  test.each([1.99, 2.001])(
    "refuses an unsupported amount before creating a quote: %s",
    async (amount) => {
      await expect(quote({ amount })).rejects.toBeInstanceOf(
        AgentDonationError
      );
      expect(mocks.to_fn).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["currency", "EUR"],
    ["frequency", "monthly"],
  ])("refuses unsupported %s", async (field, value) => {
    await expect(
      create_quote({
        recipient_id: 7,
        amount: 10,
        [field]: value,
      })
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(mocks.to_fn).not.toHaveBeenCalled();
  });
});

describe("agent donate", () => {
  test("writes a form-shaped bg-agent donation and returns hosted Checkout", async () => {
    const quoted = await quote({
      tip_percent: "15",
      cover_processing_fee: true,
    });

    const result = await donate(
      { quote_token: quoted.quote_token, donor },
      new Request("https://better.giving/agents", {
        headers: { "x-forwarded-for": "203.0.113.8" },
      })
    );

    expect(result).toStrictEqual({
      donation_id: quoted.quote_id,
      checkout_url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        id: quoted.quote_id,
        source: "bg-agent",
        via: "stripe",
        currency: "USD",
        frequency: "one-time",
        from_email: donor.email,
        amount: { base: 10, tip: 1.5, fee_allowance: 0.57 },
      }),
      expect.any(String),
      5
    );
    expect(mocks.checkout_session).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: quoted.quote_id,
        donor_email: donor.email,
        recipient_name: "ACME",
      })
    );
    expect(mocks.checkout_save).toHaveBeenCalledWith(
      quoted.quote_id,
      "cs_test_1"
    );
  });

  test("same quote returns the existing session without another charge", async () => {
    const quoted = await quote();
    mocks.donation_get.mockResolvedValue(
      saved(quoted.quote_id, { via_extra: "cs_test_existing" })
    );
    mocks.checkout_session_state.mockResolvedValue({
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_test_existing",
    });

    const first = await donate(
      { quote_token: quoted.quote_token, donor },
      new Request("https://better.giving/agents")
    );
    const second = await donate(
      { quote_token: quoted.quote_token, donor },
      new Request("https://better.giving/agents")
    );

    expect(first).toStrictEqual(second);
    expect(mocks.checkout_session).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  test("an edited quote token is refused before anything is written", async () => {
    const quoted = await quote();
    const [body, mac] = quoted.quote_token.split(".");
    const edited = JSON.parse(Buffer.from(body!, "base64url").toString());
    edited.amount = 1000;
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${mac}`;

    await expect(
      donate(
        { quote_token: forged, donor },
        new Request("https://better.giving/agents")
      )
    ).rejects.toMatchObject({ code: "invalid_quote" });
    expect(mocks.donation_get).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  test("a retry after a failed Stripe call charges the saved row, not the token", async () => {
    const quoted = await quote();
    mocks.donation_get.mockResolvedValue(
      saved(quoted.quote_id, {
        amount: { base: 25, tip: 0, fee_allowance: 0 },
      })
    );

    await donate(
      { quote_token: quoted.quote_token, donor },
      new Request("https://better.giving/agents")
    );

    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.checkout_session).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: quoted.quote_id,
        base: 25,
        tip: 0,
        fee_allowance: 0,
        cancel_path: "/donate/7",
      })
    );
  });

  test("a different donor cannot take over a reserved quote", async () => {
    const quoted = await quote();
    mocks.donation_get.mockResolvedValue(saved(quoted.quote_id));

    await expect(
      donate(
        {
          quote_token: quoted.quote_token,
          donor: { ...donor, email: "other@example.com" },
        },
        new Request("https://better.giving/agents")
      )
    ).rejects.toMatchObject({ code: "quote_conflict" });
    expect(mocks.checkout_session).not.toHaveBeenCalled();
  });

  test("an expired Checkout can be donated again", async () => {
    const quoted = await quote();
    mocks.donation_get.mockResolvedValue(
      saved(quoted.quote_id, { via_extra: "cs_test_old" })
    );
    mocks.checkout_session_state.mockResolvedValue({ status: "expired" });
    mocks.checkout_session.mockResolvedValue({
      id: "cs_test_new",
      url: "https://checkout.stripe.com/c/pay/cs_test_new",
    });

    const result = await donate(
      { quote_token: quoted.quote_token, donor },
      new Request("https://better.giving/agents")
    );

    expect(result).toStrictEqual({
      donation_id: quoted.quote_id,
      checkout_url: "https://checkout.stripe.com/c/pay/cs_test_new",
    });
    expect(mocks.expire).toHaveBeenCalledWith(quoted.quote_id, "cs_test_old");
    expect(mocks.checkout_session).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: quoted.quote_id,
        idempotency_key: `agent-checkout:${quoted.quote_id}:after:cs_test_old`,
      })
    );
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  test("a save that loses to a paid gift does not report a new checkout", async () => {
    const quoted = await quote();
    mocks.checkout_save.mockResolvedValue(false);

    await expect(
      donate(
        { quote_token: quoted.quote_token, donor },
        new Request("https://better.giving/agents")
      )
    ).rejects.toMatchObject({ code: "quote_used" });
  });

  test("an expired quote is rejected before anything is written", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
      const quoted = await quote();
      vi.setSystemTime(new Date("2026-10-16T14:00:00Z"));

      await expect(
        donate(
          { quote_token: quoted.quote_token, donor },
          new Request("https://better.giving/agents")
        )
      ).rejects.toMatchObject({ code: "quote_expired" });
      expect(mocks.donation_get).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.checkout_session).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("rate limit keys on the agent token, then the trusted address", async () => {
    const authed = await quote();
    await donate(
      { quote_token: authed.quote_token, donor },
      new Request("https://better.giving/agents", {
        headers: {
          authorization: "Bearer agent-token-test",
          "x-forwarded-for": "203.0.113.8, 10.0.0.1",
          "cf-connecting-ip": "198.51.100.9",
        },
      })
    );
    const spoofed = await quote();
    await donate(
      { quote_token: spoofed.quote_token, donor },
      new Request("https://better.giving/agents", {
        headers: {
          authorization: "Bearer not-the-token",
          "x-forwarded-for": "198.51.100.20, 10.0.0.2",
          "cf-connecting-ip": "198.51.100.21",
        },
      })
    );
    const spoofed_again = await quote();
    await donate(
      { quote_token: spoofed_again.quote_token, donor },
      new Request("https://better.giving/agents", {
        headers: {
          authorization: "Bearer a-different-token",
          "x-forwarded-for": "203.0.113.50, 10.0.0.3",
          "cf-connecting-ip": "198.51.100.99",
        },
      })
    );
    const trusted = await quote();
    await donate(
      { quote_token: trusted.quote_token, donor },
      new Request("https://better.giving/agents", {
        headers: { "x-forwarded-for": "203.0.113.8" },
      })
    );

    const ids = mocks.reserve.mock.calls.map((call) => call[0].source_id);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[3]).not.toBe(ids[0]);
    expect(ids[3]).not.toBe(ids[1]);
  });

  test("rate limit keys on one trusted address, not a caller-supplied header", async () => {
    const spoofed = {
      "cf-connecting-ip": "198.51.100.9",
      "x-forwarded-for": "203.0.113.8, 10.0.0.1",
    };
    const first = await quote();
    await donate(
      { quote_token: first.quote_token, donor },
      new Request("https://better.giving/agents", { headers: spoofed })
    );
    const second = await quote();
    await donate(
      { quote_token: second.quote_token, donor },
      new Request("https://better.giving/agents", {
        headers: { ...spoofed, "cf-connecting-ip": "198.51.100.10" },
      })
    );
    const trusted = await quote();
    await donate(
      { quote_token: trusted.quote_token, donor },
      new Request("https://better.giving/agents", {
        headers: { "x-forwarded-for": "203.0.113.8" },
      })
    );

    const ids = mocks.reserve.mock.calls.map((call) => call[0].source_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  test("customer or IP cap refuses before writing or calling Stripe", async () => {
    const quoted = await quote();
    mocks.reserve.mockResolvedValue("limited");

    await expect(
      donate(
        { quote_token: quoted.quote_token, donor },
        new Request("https://better.giving/agents")
      )
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(mocks.checkout_session).not.toHaveBeenCalled();
  });
});

describe("agent status", () => {
  test("returns status and amounts without donor data", async () => {
    mocks.donation_get.mockResolvedValue({
      id: "6e2ee494-1cda-4b0b-9867-37a25b9c76c4",
      source: "bg-agent",
      status: "settled",
      currency: "USD",
      amount: { base: 10, tip: 1, fee_allowance: 0.5 },
    });

    const result = await donation_status({
      donation_id: "6e2ee494-1cda-4b0b-9867-37a25b9c76c4",
    });

    expect(result).toStrictEqual({
      donation_id: "6e2ee494-1cda-4b0b-9867-37a25b9c76c4",
      status: "settled",
      currency: "USD",
      amount: { base: 10, tip: 1, fee_allowance: 0.5, total: 11.5 },
    });
    expect(result).not.toHaveProperty("from_email");
  });

  test("reports an abandoned Checkout as expired", async () => {
    const id = "6e2ee494-1cda-4b0b-9867-37a25b9c76c4";
    mocks.donation_get.mockResolvedValue({
      ...saved(id, { via_extra: "cs_test_old" }),
      currency: "USD",
    });
    mocks.checkout_session_state.mockResolvedValue({ status: "expired" });

    const result = await donation_status({ donation_id: id });

    expect(result.status).toBe("expired");
    expect(mocks.expire).toHaveBeenCalledWith(id, "cs_test_old");
  });

  test("an open Checkout stays created", async () => {
    const id = "6e2ee494-1cda-4b0b-9867-37a25b9c76c4";
    mocks.donation_get.mockResolvedValue({
      ...saved(id, { via_extra: "cs_test_open" }),
      currency: "USD",
    });
    mocks.checkout_session_state.mockResolvedValue({
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_test_open",
    });

    const result = await donation_status({ donation_id: id });

    expect(result.status).toBe("created");
    expect(mocks.expire).not.toHaveBeenCalled();
  });
});

const ELIGIBLE_EIN = "131624082";

function search_org(patch: Record<string, unknown> = {}) {
  return {
    ein: ELIGIBLE_EIN,
    name: "Off Market Charity",
    city: "New York",
    state: "NY",
    is501c3: true,
    deductible: true,
    revoked: false,
    revocationDate: null,
    provenance: "irs",
    mission: "secret mission",
    finances: { revenue: 1 },
    ...patch,
  };
}

function org_detail(patch: Record<string, unknown> = {}) {
  const row = search_org(patch);
  return {
    ...row,
    address: {
      street: "1 Main",
      city: row.city,
      state: row.state,
      zip: "10001",
    },
  };
}

function http(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function stub_fetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
) {
  const fn = vi.fn(async (url: string, init?: RequestInit) =>
    handler(url, init)
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const local_hits = [
  {
    id: 7,
    name: "Verify Test Nonprofit",
    registration_number: "VERIFY0001",
    hq_country: "United States",
    tagline: null,
    active: true,
    match: "close",
  },
];

describe("find_nonprofit IRS fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("an eligible off-marketplace EIN is flagged and has no id", async () => {
    const fetch = stub_fetch((url, init) => {
      expect(url).toBe(
        `https://nonprofits.better.giving/v1/orgs/${ELIGIBLE_EIN}`
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${KEY}`
      );
      return http(200, org_detail());
    });

    const result = await find_nonprofit({ ein: ELIGIBLE_EIN }, caller());

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.items).toEqual([]);
    expect(result.external_lookup).toBe("ok");
    expect(result.not_on_better_giving).toEqual([
      {
        ein: ELIGIBLE_EIN,
        name: "Off Market Charity",
        city: "New York",
        state: "NY",
        donatable: false,
        status: "not_on_better_giving",
        onboarding_url: "https://better.giving/register",
        message:
          "Not on Better Giving yet, so it can't take a donation here. The nonprofit can join at https://better.giving/register.",
      },
    ]);
    const entry = result.not_on_better_giving[0];
    expect(entry).not.toHaveProperty("id");
    expect(entry).not.toHaveProperty("recipient_id");
    expect(entry).not.toHaveProperty("mission");
    expect(entry).not.toHaveProperty("finances");
    expect(entry).not.toHaveProperty("provenance");
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("secret mission");
  });

  test("a marketplace EIN, dashed or not, is local and does not fetch", async () => {
    const row = {
      id: 7,
      name: "ACME",
      hq_country: "United States",
      registration_number: "13-1624082",
    };
    mocks.npos_by_regnums.mockResolvedValue([row]);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const dashed = await find_nonprofit({ ein: "13-1624082" }, caller());
    const plain = await find_nonprofit({ ein: ELIGIBLE_EIN }, caller());

    expect(dashed.items).toEqual([row]);
    expect(plain.items).toEqual([row]);
    expect(dashed.not_on_better_giving).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.npos_by_regnums).toHaveBeenCalledWith([ELIGIBLE_EIN]);
  });

  test("a query keeps local items and drops ineligible or already-listed EINs", async () => {
    const on_page = {
      ...local_hits[0],
      registration_number: "88-8888888",
    };
    const canada = {
      id: 8,
      name: "Canadian Twin",
      registration_number: "111111111",
      hq_country: "Canada",
    };
    mocks.npo_name_search.mockResolvedValue([on_page, canada]);
    mocks.npos_by_regnums.mockImplementation(async (eins: string[]) =>
      eins.includes("999999999")
        ? [
            {
              id: 9,
              name: "In table",
              hq_country: "United States",
              registration_number: "999999999",
            },
          ]
        : []
    );
    stub_fetch((url) => {
      expect(url).toContain("https://nonprofits.better.giving/v1/search?");
      expect(url).toContain("limit=10");
      return http(200, {
        query: "charity",
        limit: 10,
        results: [
          search_org({ ein: "111111111", name: "Eligible" }),
          search_org({ ein: "222222222", name: "Not c3", is501c3: false }),
          search_org({ ein: "333333333", name: "Unknown c3", is501c3: null }),
          search_org({
            ein: "444444444",
            name: "Not deductible",
            deductible: false,
          }),
          search_org({
            ein: "555555555",
            name: "Unknown deductible",
            deductible: null,
          }),
          search_org({ ein: "666666666", name: "Revoked", revoked: true }),
          search_org({
            ein: "777777777",
            name: "Unknown revoked",
            revoked: null,
          }),
          search_org({ ein: "888888888", name: "On page" }),
          search_org({ ein: "999999999", name: "In table" }),
        ],
      });
    });

    const result = await find_nonprofit({ query: "charity" }, caller());

    expect(result.items).toEqual([on_page, canada]);
    expect(result).toEqual(
      expect.objectContaining({ page: 1, pages: 1, match: "close" })
    );
    expect(result.external_lookup).toBe("ok");
    expect(result.not_on_better_giving.map((entry) => entry.name)).toEqual([
      "Eligible",
    ]);
    expect(JSON.stringify(result)).not.toContain("Revoked");
    expect(JSON.stringify(result)).not.toContain("222222222");
    expect(JSON.stringify(result)).not.toContain("999999999");
  });

  test("a named org that isn't listed returns no listed items, only the IRS match", async () => {
    mocks.npo_name_search.mockResolvedValue([]);
    stub_fetch(() =>
      http(200, {
        query: "American Red Cross",
        limit: 10,
        results: [
          search_org({ ein: "530196605", name: "American National Red Cross" }),
        ],
      })
    );

    const result = await find_nonprofit(
      { query: "American Red Cross" },
      caller()
    );

    expect(mocks.npo_name_search).toHaveBeenCalledWith("American Red Cross");
    expect(result.items).toEqual([]);
    expect(result.match).toBe("none");
    expect(result.external_lookup).toBe("ok");
    expect(result.not_on_better_giving.map((entry) => entry.ein)).toEqual([
      "530196605",
    ]);
  });

  test("a listed exact match is reported as exact and not offered off-platform", async () => {
    const listed = {
      ...local_hits[0],
      name: "American National Red Cross",
      registration_number: "53-0196605",
      match: "exact",
    };
    mocks.npo_name_search.mockResolvedValue([listed]);
    stub_fetch(() =>
      http(200, {
        query: "American National Red Cross",
        limit: 10,
        results: [
          search_org({ ein: "530196605", name: "American National Red Cross" }),
        ],
      })
    );

    const result = await find_nonprofit(
      { query: "American National Red Cross" },
      caller()
    );

    expect(result.items).toEqual([listed]);
    expect(result.match).toBe("exact");
    expect(result.not_on_better_giving).toEqual([]);
  });

  test("a failed local search is reported and still returns the IRS lookup", async () => {
    const error = new Error("db down");
    mocks.npo_name_search.mockRejectedValueOnce(error);
    stub_fetch(() => http(200, { query: "acme", limit: 10, results: [] }));

    const result = await find_nonprofit({ query: "acme" }, caller());

    expect(mocks.report_error).toHaveBeenCalledWith(error);
    expect(result.items).toEqual([]);
    expect(result.match).toBe("none");
    expect(result.external_lookup).toBe("ok");
  });

  test.each([500, 503])(
    "HTTP %s returns local results and external_lookup unavailable",
    async (status) => {
      stub_fetch(() => http(status, { code: "data_unavailable" }));
      mocks.npo_name_search.mockResolvedValue(local_hits);

      const result = await find_nonprofit({ query: "acme" }, caller());

      expect(result.items).toEqual(local_hits);
      expect(result.not_on_better_giving).toEqual([]);
      expect(result.external_lookup).toBe("unavailable");
    }
  );

  test.each([
    ["one character", "a"],
    ["trimmed to one character", "  a  "],
    ["punctuation only", "??"],
    ["blank", "   "],
    ["over 200 characters", "a".repeat(201)],
  ])(
    "query %s keeps local results, does not fetch, and is invalid_query",
    async (_label, query) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      mocks.npo_name_search.mockResolvedValue(local_hits);

      const result = await find_nonprofit({ query }, caller());

      expect(fetch).not.toHaveBeenCalled();
      expect(result.items).toEqual(local_hits);
      expect(result.not_on_better_giving).toEqual([]);
      expect(result.external_lookup).toBe("invalid_query");
    }
  );

  test("a two-character query that contains a letter still fetches", async () => {
    const fetch = stub_fetch(() =>
      http(200, { query: "'a", limit: 10, results: [] })
    );
    mocks.npo_name_search.mockResolvedValue(local_hits);

    const result = await find_nonprofit({ query: "'a" }, caller());

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.items).toEqual(local_hits);
    expect(result.external_lookup).toBe("ok");
  });

  test.each(["invalid_query", "invalid_ein", "invalid_limit"])(
    "HTTP 400 %s keeps local results and is invalid_query",
    async (code) => {
      stub_fetch(() => http(400, { code }));
      mocks.npo_name_search.mockResolvedValue(local_hits);

      const result = await find_nonprofit({ query: "acme" }, caller());

      expect(result.items).toEqual(local_hits);
      expect(result.not_on_better_giving).toEqual([]);
      expect(result.external_lookup).toBe("invalid_query");
    }
  );

  test("HTTP 400 with another code stays unavailable", async () => {
    stub_fetch(() => http(400, { code: "something_else" }));
    mocks.npo_name_search.mockResolvedValue(local_hits);

    const result = await find_nonprofit({ query: "acme" }, caller());

    expect(result.external_lookup).toBe("unavailable");
  });

  test("an unknown EIN is not_found and the miss is cached", async () => {
    const fetch = stub_fetch(() => http(404, { code: "not_found" }));

    const first = await find_nonprofit({ ein: "123456789" }, caller());
    const second = await find_nonprofit({ ein: "12-3456789" }, caller());

    expect(first).toMatchObject({
      items: [],
      not_on_better_giving: [],
      external_lookup: "not_found",
    });
    expect(second.external_lookup).toBe("not_found");
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("an unexpected payload is unavailable and is not cached", async () => {
    let calls = 0;
    const fetch = stub_fetch(() => {
      calls += 1;
      return calls === 1
        ? http(200, { ein: "123456789", name: "Missing flags" })
        : http(200, org_detail({ ein: "123456789", name: "Missing flags" }));
    });

    const first = await find_nonprofit({ ein: "123456789" }, caller());
    const second = await find_nonprofit({ ein: "123456789" }, caller());

    expect(first.external_lookup).toBe("unavailable");
    expect(first.not_on_better_giving).toEqual([]);
    expect(second.external_lookup).toBe("ok");
    expect(second.not_on_better_giving[0]?.name).toBe("Missing flags");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a timeout returns local results and does not throw", async () => {
    stub_fetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing timeout"));
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason));
        })
    );
    mocks.npo_name_search.mockResolvedValue(local_hits);

    const result = await find_nonprofit({ query: "acme" }, caller());

    expect(result.items).toEqual(local_hits);
    expect(result.external_lookup).toBe("unavailable");
  });

  test("a 401 is reported once, without the key, and local results stay", async () => {
    const fetch = stub_fetch(() =>
      http(401, { code: "revoked_api_key", token: KEY })
    );
    mocks.npo_name_search.mockResolvedValue(local_hits);

    const first = await find_nonprofit({ query: "one" }, caller());
    const second = await find_nonprofit({ query: "two" }, caller());

    expect(first.items).toEqual(local_hits);
    expect(first.external_lookup).toBe("unavailable");
    expect(second.external_lookup).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.report_error).toHaveBeenCalledOnce();
    expect(mocks.report_error.mock.calls[0]?.[1]).toEqual({
      code: "revoked_api_key",
    });
    const reported = JSON.stringify(mocks.report_error.mock.calls);
    expect(reported).not.toContain(KEY);
    expect(JSON.stringify(first)).not.toContain(KEY);
  });

  test("a 429 cooldown skips the next fetch and keeps local results", async () => {
    const fetch = stub_fetch(() =>
      http(429, { code: "per_minute_limit_exceeded" }, { "retry-after": "120" })
    );
    mocks.npo_name_search.mockResolvedValue(local_hits);

    const first = await find_nonprofit({ query: "acme" }, caller());
    const second = await find_nonprofit({ query: "other" }, caller());

    expect(first.external_lookup).toBe("rate_limited");
    expect(first.items).toEqual(local_hits);
    expect(second.external_lookup).toBe("rate_limited");
    expect(second.items).toEqual(local_hits);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("a 429 without Retry-After cools down for 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00.000Z"));
    const fetch = stub_fetch(() =>
      http(429, { code: "per_minute_limit_exceeded" })
    );
    mocks.npo_name_search.mockResolvedValue(local_hits);

    await find_nonprofit({ query: "first" }, caller());
    vi.setSystemTime(new Date("2026-10-17T12:00:59.000Z"));
    await find_nonprofit({ query: "still" }, caller());
    expect(fetch).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date("2026-10-17T12:01:00.000Z"));
    await find_nonprofit({ query: "after" }, caller());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a daily quota cooldown lasts until the next UTC midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T23:00:00.000Z"));
    const fetch = stub_fetch(() => http(429, { code: "daily_quota_exceeded" }));
    mocks.npo_name_search.mockResolvedValue(local_hits);

    await find_nonprofit({ query: "day" }, caller());
    vi.setSystemTime(new Date("2026-10-17T23:30:00.000Z"));
    await find_nonprofit({ query: "later" }, caller());
    expect(fetch).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date("2026-10-18T00:00:00.000Z"));
    await find_nonprofit({ query: "tomorrow" }, caller());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a malformed body is unavailable and is not cached", async () => {
    const fetch = stub_fetch(() => http(200, "not-json"));
    mocks.npo_name_search.mockResolvedValue(local_hits);

    const first = await find_nonprofit({ query: "acme" }, caller());
    const second = await find_nonprofit({ query: "acme" }, caller());

    expect(first.external_lookup).toBe("unavailable");
    expect(first.items).toEqual(local_hits);
    expect(second.external_lookup).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("no key means no fetch and external_lookup disabled", async () => {
    env.app.nonprofits_api_key = undefined;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mocks.npo_name_search.mockResolvedValue(local_hits);

    const by_query = await find_nonprofit({ query: "acme" }, caller());
    const by_ein = await find_nonprofit({ ein: ELIGIBLE_EIN }, caller());

    expect(by_query.items).toEqual(local_hits);
    expect(by_query.external_lookup).toBe("disabled");
    expect(by_query.not_on_better_giving).toEqual([]);
    expect(by_ein).toMatchObject({
      items: [],
      external_lookup: "disabled",
      not_on_better_giving: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a repeat query or EIN is served from cache", async () => {
    const fetch = stub_fetch((url) =>
      String(url).includes("/v1/orgs/")
        ? http(200, org_detail())
        : http(200, { query: "red cross", limit: 10, results: [search_org()] })
    );

    await find_nonprofit({ query: "Red  Cross" }, caller());
    await find_nonprofit({ query: "red cross" }, caller());
    await find_nonprofit({ ein: ELIGIBLE_EIN }, caller());
    await find_nonprofit({ ein: "13-1624082" }, caller());

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a failed lookup is not cached", async () => {
    let calls = 0;
    const fetch = stub_fetch(() => {
      calls += 1;
      return calls === 1
        ? http(500, { code: "data_unavailable" })
        : http(200, { query: "once", limit: 10, results: [] });
    });
    mocks.npo_name_search.mockResolvedValue(local_hits);

    const failed = await find_nonprofit({ query: "once" }, caller());
    const retried = await find_nonprofit({ query: "once" }, caller());

    expect(failed.external_lookup).toBe("unavailable");
    expect(retried.external_lookup).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a spent per-caller cap skips the remote lookup and keeps local results", async () => {
    const fetch = stub_fetch(() =>
      http(200, { query: "q", limit: 10, results: [] })
    );
    mocks.npo_name_search.mockResolvedValue(local_hits);
    const req = caller("192.0.2.250");

    for (let i = 0; i < 20; i++) {
      const result = await find_nonprofit({ query: `name ${i}` }, req);
      expect(result.external_lookup).toBe("ok");
    }
    const skipped = await find_nonprofit({ query: "name 21" }, req);
    expect(skipped.external_lookup).toBe("skipped");
    expect(skipped.items).toEqual(local_hits);
    expect(skipped.not_on_better_giving).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(20);

    const cached = await find_nonprofit({ query: "name 0" }, req);
    expect(cached.external_lookup).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  test("concurrent identical searches share one fetch and one quota slot", async () => {
    let entered = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = stub_fetch(async () => {
      entered += 1;
      await gate;
      return http(200, {
        query: "same",
        limit: 10,
        results: [search_org({ ein: "111111111", name: "Eligible" })],
      });
    });
    mocks.npo_name_search.mockResolvedValue(local_hits);
    const req = caller("192.0.2.251");

    const pending = Promise.all([
      find_nonprofit({ query: "Same" }, req),
      find_nonprofit({ query: "  same  " }, req),
    ]);
    for (let i = 0; i < 10 && entered < 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(entered).toBe(1);
    release();
    const [first, second] = await pending;

    expect(fetch).toHaveBeenCalledOnce();
    expect(first.external_lookup).toBe("ok");
    expect(second.external_lookup).toBe("ok");
    expect(second.not_on_better_giving).toEqual(first.not_on_better_giving);

    for (let i = 0; i < 19; i++) {
      const result = await find_nonprofit({ query: `other ${i}` }, req);
      expect(result.external_lookup).toBe("ok");
    }
    const skipped = await find_nonprofit({ query: "over the cap" }, req);
    expect(skipped.external_lookup).toBe("skipped");
    expect(skipped.items).toEqual(local_hits);
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  test("concurrent EIN lookups share one fetch", async () => {
    let entered = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = stub_fetch(async () => {
      entered += 1;
      await gate;
      return http(200, org_detail());
    });

    const pending = Promise.all([
      find_nonprofit({ ein: ELIGIBLE_EIN }, caller("192.0.2.252")),
      find_nonprofit({ ein: "13-1624082" }, caller("192.0.2.253")),
    ]);
    for (let i = 0; i < 10 && entered < 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(entered).toBe(1);
    release();
    const [first, second] = await pending;

    expect(fetch).toHaveBeenCalledOnce();
    expect(first.not_on_better_giving).toEqual(second.not_on_better_giving);
    expect(first.external_lookup).toBe("ok");
  });

  test("an EIN that is not 9 digits is invalid_input before any lookup", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      find_nonprofit({ ein: "12-345" }, caller())
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(mocks.npos_by_regnums).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("quote_donation refuses an EIN", () => {
  test("an EIN string is refused before any write", async () => {
    await expect(
      create_quote({ recipient_id: ELIGIBLE_EIN, amount: 10 })
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(mocks.to_fn).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  test("an EIN taken from not_on_better_giving is refused before any write", async () => {
    stub_fetch(() => http(200, org_detail()));
    const found = await find_nonprofit({ ein: ELIGIBLE_EIN }, caller());
    const ein = found.not_on_better_giving[0]?.ein;

    await expect(
      create_quote({ recipient_id: ein, amount: 10 })
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(mocks.to_fn).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(JSON.stringify(found)).not.toContain(KEY);
  });
});
