import { beforeEach, describe, expect, it, vi } from "vitest";
import { doc_args } from "#/__tests__/fixtures/route-args";

// --- mocks (hoisted) ---

const m = vi.hoisted(() => ({
  donation_get: vi.fn(),
  match_event_get: vi.fn(),
  get_session: vi.fn(),
  cookie_parse: vi.fn(),
}));

vi.mock("$/pg/db", () => ({
  db: { transaction: (fn: (tx: unknown) => unknown) => fn({}) },
}));
vi.mock("$/pg/queries/donation", () => ({
  donation_get: m.donation_get,
  donation_update: vi.fn(),
}));
vi.mock("$/pg/queries/match", () => ({
  match_event_get: m.match_event_get,
  claim_submitted: vi.fn(),
  open_match_event: vi.fn(),
}));
vi.mock("$/pg/queries/donation-message", () => ({
  donation_message_put: vi.fn(),
}));
vi.mock("$/pg/queries/user", () => ({ npo_admins: vi.fn() }));
vi.mock("$/email", () => ({ send_email: vi.fn() }));
vi.mock("$/kit/queue", () => ({ enqueue: vi.fn() }));
vi.mock("#/.server/toast", () => ({ dataWithSuccess: vi.fn() }));
vi.mock("#/.server/cookie", () => ({
  donations_cookie: { parse: m.cookie_parse },
}));
vi.mock("#/.server/auth", async () => ({
  ...(await import("$/auth/test-utils")).make_auth_mock(),
  get_session: m.get_session,
}));

// --- imports (after mocks hoisted) ---

import { to_auth } from "#/.server/auth";
import { donation_message_put } from "$/pg/queries/donation-message";
import { action, loader } from "./api";

const DON_ID = "don-001";
const DONOR_EMAIL = "donor@test.com";

const DONOR_PRIVATE = {
  from_email: DONOR_EMAIL,
  from_name: "Dana Donor",
  from_title: "Dr",
  from_company_name: "Acme Corp",
  from_addr_street: "1 Main St",
  from_addr_city: "Springfield",
  from_addr_state: "IL",
  from_addr_zip_code: "62701",
  from_addr_country: "United States",
  from_private_msg_to_npo: "for your eyes only",
  from_wallet_addr: "0xabc",
  via_extra: "https://verify.stripe.test/secret",
  tribute: {
    full_name: "Grandma",
    notif: {
      to_email: "honoree@test.com",
      to_fullname: "Aunt May",
      from_msg: "in her memory",
    },
  },
  settlement: {
    id: "s1",
    date: "2026-01-01",
    currency: "USD",
    net: 97,
    fee: 3,
  },
};

const don = {
  id: DON_ID,
  to_id: "42",
  to_name: "Save the Whales",
  to_type: "npo",
  to_tip_allowed: true,
  to_members: [],
  upusd: 1,
  status: "settled",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  amount: { base: 100, tip: 5, fee_allowance: 2 },
  currency: "USD",
  source: "bg-marketplace",
  frequency: "one-time",
  via: "stripe:card",
  from_public_msg_to_npo: "keep it up!",
  ...DONOR_PRIVATE,
};

const MATCHED_DON = {
  id: "don-employer",
  amount: { base: 400 },
  currency: "USD",
};
const MATCH_EVENT = {
  submitted_at: "2026-01-02T00:00:00.000Z",
  matched_at: "2026-01-03T00:00:00.000Z",
  matched_donation_id: MATCHED_DON.id,
};
const MATCH_KEYS = ["match_filed", "match_voided", "match_arrived"];

const LEGACY_ID = "legacy-v1-001";

const call = (id = DON_ID) =>
  (loader as any)({
    ...doc_args(new Request(`https://app.test/donations/${id}`)),
    params: { id },
    context: {},
  });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  vi.mocked(to_auth).mockClear();
  m.donation_get.mockResolvedValue(don);
  m.match_event_get.mockResolvedValue(undefined);
  m.cookie_parse.mockResolvedValue(null);
  m.get_session.mockResolvedValue({ user: undefined });
});

describe("donation thank-you loader", () => {
  it("gives an anonymous visitor the public record and none of the donor's private fields", async () => {
    const d = await call();

    for (const k of Object.keys(DONOR_PRIVATE)) expect(d).not.toHaveProperty(k);
    expect(d).toMatchObject({
      id: DON_ID,
      to_id: "42",
      to_name: "Save the Whales",
      to_type: "npo",
      amount: { base: 100 },
      currency: "USD",
      source: "bg-marketplace",
      from_public_msg_to_npo: "keep it up!",
      donate_url: "https://app.test/donate/42",
      donate_thanks_url: `https://app.test/donations/${DON_ID}`,
      profile_url: "https://app.test/org/42",
      is_donor: false,
    });
  });

  it("withholds the private fields from a signed-in user who is not the donor", async () => {
    m.get_session.mockResolvedValue({ user: { email: "other@test.com" } });
    m.match_event_get.mockResolvedValue(MATCH_EVENT);
    m.donation_get.mockImplementation(async (id: string) =>
      id === MATCHED_DON.id ? MATCHED_DON : don
    );

    const d = await call();

    for (const k of Object.keys(DONOR_PRIVATE)) expect(d).not.toHaveProperty(k);
    // the tip and fee allowance are the donor's, not the share link's
    expect(d.amount).toEqual({ base: 100 });
    for (const k of MATCH_KEYS) expect(d).not.toHaveProperty(k);
  });

  it("withholds the private fields when the checkout cookie has expired", async () => {
    m.cookie_parse.mockResolvedValue({ [DON_ID]: Date.now() - 1 });

    const d = await call();

    for (const k of Object.keys(DONOR_PRIVATE)) expect(d).not.toHaveProperty(k);
  });

  it("gives the checkout cookie holder the whole record", async () => {
    m.cookie_parse.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const d = await call();

    expect(d).toMatchObject({ ...DONOR_PRIVATE, is_donor: true });
  });

  it("gives the checkout cookie holder the whole record when they open it by its legacy id", async () => {
    // checkout keys the cookie by the donation's current id
    m.cookie_parse.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const d = await call(LEGACY_ID);

    expect(d).toMatchObject(DONOR_PRIVATE);
  });

  it("gives the signed-in donor the whole record", async () => {
    m.get_session.mockResolvedValue({ user: { email: DONOR_EMAIL } });

    const d = await call();

    expect(d).toMatchObject(DONOR_PRIVATE);
  });

  it("recognizes the donor whatever the case of the stored email", async () => {
    m.donation_get.mockResolvedValue({ ...don, from_email: "Donor@Test.com" });
    m.get_session.mockResolvedValue({ user: { email: DONOR_EMAIL } });

    const d = await call();

    expect(d).toHaveProperty("from_email", "Donor@Test.com");
  });

  it("gives the donor the match outcome", async () => {
    m.cookie_parse.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });
    m.match_event_get.mockResolvedValue(MATCH_EVENT);
    m.donation_get.mockImplementation(async (id: string) =>
      id === MATCHED_DON.id ? MATCHED_DON : don
    );

    const d = await call();

    expect(d).toMatchObject({
      amount: { base: 100, tip: 5, fee_allowance: 2 },
      match_filed: true,
      match_voided: false,
      match_arrived: { amount: 400, currency: "USD" },
    });
  });
});

describe("donation thank-you action", () => {
  const post = (id = DON_ID) => {
    const form = new FormData();
    form.set("type", "public_msg");
    form.set("msg", "hello");
    return (action as any)({
      ...doc_args(
        new Request(`https://app.test/donations/${id}`, {
          method: "POST",
          body: form,
        })
      ),
      params: { id },
      context: {},
    });
  };

  it("sends an anonymous visitor to sign in", async () => {
    await post();

    expect(to_auth).toHaveBeenCalled();
  });

  it("refuses a signed-in user who is not the donor with 403", async () => {
    m.get_session.mockResolvedValue({ user: { email: "other@test.com" } });

    await expect(post()).rejects.toMatchObject({ status: 403 });
  });

  it("lets the checkout cookie holder post through the legacy id", async () => {
    m.cookie_parse.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    await post(LEGACY_ID);

    expect(to_auth).not.toHaveBeenCalled();
    expect(m.get_session).not.toHaveBeenCalled();
  });

  it("posts a confirmed php gift in the gift's currency", async () => {
    m.donation_get.mockResolvedValue({
      ...don,
      status: "confirmed",
      currency: "PHP",
      upusd: 50,
      amount: { base: 250, tip: 0, fee_allowance: 0 },
      from_public_msg_to_npo: undefined,
    });
    m.cookie_parse.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    await post();

    expect(donation_message_put).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 250 })
    );
  });
});
