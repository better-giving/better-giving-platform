import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
  get_npos: vi.fn(),
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

vi.mock("#/.server/npos", () => ({ get_npos: mocks.get_npos }));
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

const local_page = {
  items: [
    {
      id: 7,
      name: "Verify Test Nonprofit",
      registration_number: "VERIFY0001",
      hq_country: "United States",
    },
  ],
  page: 1,
  pages: 3,
};

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
      ...local_page.items[0],
      registration_number: "88-8888888",
    };
    const canada = {
      id: 8,
      name: "Canadian Twin",
      registration_number: "111111111",
      hq_country: "Canada",
    };
    mocks.get_npos.mockResolvedValue({
      items: [on_page, canada],
      page: 1,
      pages: 3,
    });
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
    expect(result).toEqual(expect.objectContaining({ page: 1, pages: 3 }));
    expect(result.external_lookup).toBe("ok");
    expect(result.not_on_better_giving.map((entry) => entry.name)).toEqual([
      "Eligible",
    ]);
    expect(JSON.stringify(result)).not.toContain("Revoked");
    expect(JSON.stringify(result)).not.toContain("222222222");
    expect(JSON.stringify(result)).not.toContain("999999999");
  });

  test.each([500, 503])(
    "HTTP %s returns local results and external_lookup unavailable",
    async (status) => {
      stub_fetch(() => http(status, { code: "data_unavailable" }));
      mocks.get_npos.mockResolvedValue(local_page);

      const result = await find_nonprofit({ query: "acme" }, caller());

      expect(result.items).toEqual(local_page.items);
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
      mocks.get_npos.mockResolvedValue(local_page);

      const result = await find_nonprofit({ query }, caller());

      expect(fetch).not.toHaveBeenCalled();
      expect(result.items).toEqual(local_page.items);
      expect(result.not_on_better_giving).toEqual([]);
      expect(result.external_lookup).toBe("invalid_query");
    }
  );

  test("a two-character query that contains a letter still fetches", async () => {
    const fetch = stub_fetch(() =>
      http(200, { query: "'a", limit: 10, results: [] })
    );
    mocks.get_npos.mockResolvedValue(local_page);

    const result = await find_nonprofit({ query: "'a" }, caller());

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.items).toEqual(local_page.items);
    expect(result.external_lookup).toBe("ok");
  });

  test.each(["invalid_query", "invalid_ein", "invalid_limit"])(
    "HTTP 400 %s keeps local results and is invalid_query",
    async (code) => {
      stub_fetch(() => http(400, { code }));
      mocks.get_npos.mockResolvedValue(local_page);

      const result = await find_nonprofit({ query: "acme" }, caller());

      expect(result.items).toEqual(local_page.items);
      expect(result.not_on_better_giving).toEqual([]);
      expect(result.external_lookup).toBe("invalid_query");
    }
  );

  test("HTTP 400 with another code stays unavailable", async () => {
    stub_fetch(() => http(400, { code: "something_else" }));
    mocks.get_npos.mockResolvedValue(local_page);

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
    mocks.get_npos.mockResolvedValue(local_page);

    const result = await find_nonprofit({ query: "acme" }, caller());

    expect(result.items).toEqual(local_page.items);
    expect(result.external_lookup).toBe("unavailable");
  });

  test("a 401 is reported once, without the key, and local results stay", async () => {
    const fetch = stub_fetch(() =>
      http(401, { code: "revoked_api_key", token: KEY })
    );
    mocks.get_npos.mockResolvedValue(local_page);

    const first = await find_nonprofit({ query: "one" }, caller());
    const second = await find_nonprofit({ query: "two" }, caller());

    expect(first.items).toEqual(local_page.items);
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
    mocks.get_npos.mockResolvedValue(local_page);

    const first = await find_nonprofit({ query: "acme" }, caller());
    const second = await find_nonprofit({ query: "other" }, caller());

    expect(first.external_lookup).toBe("rate_limited");
    expect(first.items).toEqual(local_page.items);
    expect(second.external_lookup).toBe("rate_limited");
    expect(second.items).toEqual(local_page.items);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("a 429 without Retry-After cools down for 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00.000Z"));
    const fetch = stub_fetch(() =>
      http(429, { code: "per_minute_limit_exceeded" })
    );
    mocks.get_npos.mockResolvedValue(local_page);

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
    mocks.get_npos.mockResolvedValue(local_page);

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
    mocks.get_npos.mockResolvedValue(local_page);

    const first = await find_nonprofit({ query: "acme" }, caller());
    const second = await find_nonprofit({ query: "acme" }, caller());

    expect(first.external_lookup).toBe("unavailable");
    expect(first.items).toEqual(local_page.items);
    expect(second.external_lookup).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("no key means no fetch and external_lookup disabled", async () => {
    env.app.nonprofits_api_key = undefined;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mocks.get_npos.mockResolvedValue(local_page);

    const by_query = await find_nonprofit({ query: "acme" }, caller());
    const by_ein = await find_nonprofit({ ein: ELIGIBLE_EIN }, caller());

    expect(by_query.items).toEqual(local_page.items);
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
    mocks.get_npos.mockResolvedValue(local_page);

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
    mocks.get_npos.mockResolvedValue(local_page);
    const req = caller("192.0.2.250");

    for (let i = 0; i < 20; i++) {
      const result = await find_nonprofit({ query: `name ${i}` }, req);
      expect(result.external_lookup).toBe("ok");
    }
    const skipped = await find_nonprofit({ query: "name 21" }, req);
    expect(skipped.external_lookup).toBe("skipped");
    expect(skipped.items).toEqual(local_page.items);
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
    mocks.get_npos.mockResolvedValue(local_page);
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
    expect(skipped.items).toEqual(local_page.items);
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
