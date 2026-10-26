import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send_email_mock = vi.hoisted(() => vi.fn());
const get_session_mock = vi.hoisted(() => vi.fn());
const to_fn_mock = vi.hoisted(() => vi.fn());
const campaign_by_id_mock = vi.hoisted(() => vi.fn());
const template_mock = vi.hoisted(() =>
  vi.fn((_d: any) => ({ node: null, subject: "transfer notif" }))
);

vi.mock("emails", () => ({
  donation_transfer_notif: { template: template_mock },
}));
vi.mock("#/.server/auth", () => ({ get_session: get_session_mock }));
vi.mock("#/.server/donation-recipient", () => ({ to_fn: to_fn_mock }));
vi.mock("$/pg/queries/campaign", () => ({
  campaign_by_id: campaign_by_id_mock,
  campaign_accepts: (
    row: { status: string; ends_at: string | null },
    now: Date
  ) => {
    if (row.status !== "live") return false;
    if (row.ends_at && new Date(row.ends_at).getTime() <= now.getTime()) {
      return false;
    }
    return true;
  },
}));
vi.mock("$/email", () => ({ send_email: send_email_mock }));
vi.mock("$/env", () => ({ base_url: "https://bg.test" }));
vi.mock("#/errors/report", () => ({ report_null: vi.fn() }));

// re-imported per test (see beforeEach) — the route's dedup map is module
// state, and a fresh module is what isolates one test's entries from the next
let action: typeof import("./route").action;

const DEDUP_TTL = 5 * 60 * 1000;
const NPO_ID = "42";
const FUND_ID = "0195c1f0-4c37-7c1a-b8f1-1f1f0a2f9d3e";

const notif = (ticker: string, recipient_id = NPO_ID) => ({
  type: "stocks",
  recipient_id,
  details: { ticker, shares: "10", amount: "100" },
});

const stocks = (details: Record<string, string>) => ({
  ...notif("AAPL"),
  details: { ...notif("AAPL").details, ...details },
});

const ira = (details: Record<string, string>) => ({
  type: "ira_qcd",
  recipient_id: NPO_ID,
  details: { amount: "100", ...details },
});

const post = (body: unknown): Request =>
  new Request("https://x/api/donation-notifications", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const invoke = async (request: Request): Promise<Response> =>
  (await action({ request } as any)) as Response;

let now = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({ action } = await import("./route"));
  template_mock.mockReturnValue({ node: null, subject: "transfer notif" });
  now = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  get_session_mock.mockResolvedValue({ user: { email: "a@b.co" } });
  send_email_mock.mockResolvedValue(undefined);
  to_fn_mock.mockResolvedValue({
    to_id: NPO_ID,
    to_type: "npo",
    to_name: "Freegan Food Foundation",
    to_tip_allowed: true,
    to_members: [],
  });
  campaign_by_id_mock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api.donation-notifications recipient identity", () => {
  it("names the recipient from the record, not from the caller", async () => {
    await invoke(
      post({
        ...notif("AAPL"),
        // an unauthenticated caller reaches four internal inboxes here, so a
        // name it supplies is a recipient it invented
        recipient_name: "Totally Real Charity",
        recipient_url: "https://phish.invalid/pay",
      })
    );

    expect(template_mock).toHaveBeenCalledOnce();
    const d = template_mock.mock.calls[0]![0] as any;
    expect(d.recipient_name).toBe("Freegan Food Foundation");
    expect(d.recipient_url).toBe(`https://bg.test/org/${NPO_ID}`);
  });

  it("links a fund recipient to its own page", async () => {
    to_fn_mock.mockResolvedValue({
      to_id: FUND_ID,
      to_type: "fund",
      to_name: "Ocean Fund",
      to_tip_allowed: true,
      to_members: ["1"],
    });

    await invoke(post(notif("AAPL", FUND_ID)));

    const d = template_mock.mock.calls[0]![0] as any;
    expect(d.recipient_url).toBe(`https://bg.test/campaigns/${FUND_ID}`);
  });

  it("mails nobody when the id names no live recipient", async () => {
    // to_fn also refuses a deactivated npo, so this is the same answer for an
    // id that never existed and one that is no longer receiving
    to_fn_mock.mockResolvedValue(undefined);

    const res = await invoke(post(notif("AAPL")));

    expect(res.status).toBe(400);
    expect(send_email_mock).not.toHaveBeenCalled();
  });

  it("names a live campaign this nonprofit owns", async () => {
    campaign_by_id_mock.mockResolvedValue({
      id: "c0ffee00-0000-4000-8000-000000000001",
      owner_npo_id: Number(NPO_ID),
      status: "live",
      ends_at: null,
      name: "Winter Drive",
      slug: "winter",
      owner_slug: "verify-test",
    });
    await invoke(
      post({
        ...notif("AAPL"),
        campaign_id: "c0ffee00-0000-4000-8000-000000000001",
      })
    );
    const d = template_mock.mock.calls[0]![0] as any;
    expect(d.campaign_name).toBe("Winter Drive");
    expect(d.campaign_url).toBe("https://bg.test/org/verify-test/winter");
  });

  it("drops a campaign another nonprofit owns and still mails the gift", async () => {
    campaign_by_id_mock.mockResolvedValue({
      id: "c0ffee00-0000-4000-8000-000000000001",
      owner_npo_id: 99,
      status: "live",
      ends_at: null,
      name: "Someone else",
      slug: "else",
      owner_slug: "other",
    });
    const res = await invoke(
      post({
        ...notif("AAPL"),
        campaign_id: "c0ffee00-0000-4000-8000-000000000001",
      })
    );
    expect(res.status).toBe(200);
    const d = template_mock.mock.calls[0]![0] as any;
    expect(d.campaign_name).toBeUndefined();
    expect(d.recipient_name).toBe("Freegan Food Foundation");
  });

  it("still names a campaign after it has ended", async () => {
    campaign_by_id_mock.mockResolvedValue({
      id: "c0ffee00-0000-4000-8000-000000000001",
      owner_npo_id: Number(NPO_ID),
      status: "ended",
      ends_at: null,
      name: "Winter Drive",
      slug: "winter",
      owner_slug: "verify-test",
    });
    const res = await invoke(
      post({
        ...notif("AAPL"),
        campaign_id: "c0ffee00-0000-4000-8000-000000000001",
      })
    );
    expect(res.status).toBe(200);
    const d = template_mock.mock.calls[0]![0] as any;
    expect(d.campaign_name).toBe("Winter Drive");
    expect(send_email_mock).toHaveBeenCalledOnce();
  });

  it("drops a draft campaign and still mails the gift", async () => {
    campaign_by_id_mock.mockResolvedValue({
      id: "c0ffee00-0000-4000-8000-000000000001",
      owner_npo_id: Number(NPO_ID),
      status: "draft",
      ends_at: null,
      name: "Hidden",
      slug: "hidden",
      owner_slug: "verify-test",
    });
    const res = await invoke(
      post({
        ...notif("AAPL"),
        campaign_id: "c0ffee00-0000-4000-8000-000000000001",
      })
    );
    expect(res.status).toBe(200);
    const d = template_mock.mock.calls[0]![0] as any;
    expect(d.campaign_name).toBeUndefined();
  });

  it("rejects a payload carrying no recipient id at all", async () => {
    const res = await invoke(
      post({
        type: "stocks",
        recipient_name: "ACME",
        recipient_url: "https://phish.invalid",
        details: { ticker: "AAPL", shares: "10", amount: "100" },
      })
    );

    expect(res.status).toBe(400);
    expect(to_fn_mock).not.toHaveBeenCalled();
    expect(send_email_mock).not.toHaveBeenCalled();
  });
});

describe("api.donation-notifications body validation", () => {
  it("answers a body that isn't JSON with 400 and mails nobody", async () => {
    const res = await invoke(
      new Request("https://x/api/donation-notifications", {
        method: "POST",
        body: "ticker=AAPL",
        headers: { "content-type": "application/json" },
      })
    );

    expect(res.status).toBe(400);
    expect(send_email_mock).not.toHaveBeenCalled();
  });

  // every accepted field lands in a team-wide mail under the platform's own
  // sender, so a field that takes prose is a phishing line with our provenance
  const lure = "URGENT wire update, see https://evil.invalid/pay";

  it.each([
    ["a ticker carrying sentence text", stocks({ ticker: lure })],
    ["a share count carrying sentence text", stocks({ shares: lure })],
    ["a stock amount carrying sentence text", stocks({ amount: lure })],
    ["an ira amount carrying sentence text", ira({ amount: lure })],
    ["a zero amount", ira({ amount: "0.00" })],
    ["a custodian past 100 characters", ira({ custodian: "a".repeat(101) })],
    ["a custodian carrying sentence text", ira({ custodian: lure })],
    // mail clients autolink a bare host as readily as a full url
    ["a custodian naming a bare host", ira({ custodian: "evil.com" })],
    ["a custodian naming a host and path", ira({ custodian: "evil.com/pay" })],
    ["a custodian carrying an email", ira({ custodian: "ops@evil.invalid" })],
    ["a custodian carrying a #", ira({ custodian: "Schwab #2" })],
    ["a custodian carrying a +", ira({ custodian: "Schwab+Co" })],
  ])("refuses %s and mails nobody", async (_, body) => {
    const res = await invoke(post(body));

    expect(res.status).toBe(400);
    expect(send_email_mock).not.toHaveBeenCalled();
  });

  // the donor's form shows this under the field, so it is our copy and never
  // the caller's input read back
  it.each([
    ["sentence text", lure],
    ["a bare host", "evil.invalid"],
    ["a #", "Schwab #2"],
    ["over 100 characters", `evil.invalid${"a".repeat(100)}`],
    ["a non-string", 12345],
  ])(
    "answers a custodian carrying %s with a message for the field",
    async (_, custodian) => {
      const res = await invoke(post(ira({ custodian } as any)));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.errors.custodian).toMatch(/\w/);
      expect(JSON.stringify(body)).not.toContain(
        String(custodian).slice(0, 12)
      );
    }
  );

  it("answers a failure outside the custodian with no field message", async () => {
    const res = await invoke(
      post(ira({ amount: lure, custodian: "Fidelity" }))
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
  });

  // the shapes the stocks and ira/qcd checkouts post: a curated class-share
  // ticker, an Intl-formatted share count, a Number#toString amount
  it.each([
    [
      "a class-share stock notice",
      stocks({ ticker: "BRK.B", shares: "3.25", amount: "1234.5" }),
    ],
    ...[
      "Fidelity",
      "Charles Schwab & Co., Inc.",
      "T. Rowe Price",
      "Vanguard",
      "TD Ameritrade",
      "Crédit Agricole",
      "E*Trade",
      "BNY Mellon/Pershing",
    ].map(
      (custodian) =>
        [
          `an ira notice naming ${custodian}`,
          ira({ amount: "250.75", custodian }),
        ] as const
    ),
  ] as const)("mails the team %s", async (_, body) => {
    const res = await invoke(post(body));

    expect(res.status).toBe(200);
    expect(send_email_mock).toHaveBeenCalledOnce();
    expect(template_mock.mock.calls[0]![0]).toMatchObject({
      details: body.details,
    });
  });

  it("trims the custodian before it reaches the mail", async () => {
    await invoke(post(ira({ custodian: "  Fidelity  " })));

    const d = template_mock.mock.calls[0]![0] as any;
    expect(d.details.custodian).toBe("Fidelity");
  });

  // ios smart punctuation types ’ for ' by default
  it.each([
    ["Charles Schwab’s Trust Co.", "Charles Schwab's Trust Co."],
    ["‘Schwab’ Trust Co.", "'Schwab' Trust Co."],
  ])("mails %s with straight apostrophes", async (custodian, mailed) => {
    const res = await invoke(post(ira({ custodian })));

    expect(res.status).toBe(200);
    const d = template_mock.mock.calls[0]![0] as any;
    expect(d.details.custodian).toBe(mailed);
  });
});

describe("api.donation-notifications dedup guard", () => {
  it("the sweep an admitted notification runs spares entries still in window", async () => {
    // the sweep is age-based and runs on every admit — one that reclaimed the
    // whole map would let a duplicate through the moment any other
    // notification arrived
    await invoke(post(notif("AAPL")));

    now += 60_000;
    await invoke(post(notif("MSFT")));
    await invoke(post(notif("AAPL")));

    expect(send_email_mock).toHaveBeenCalledTimes(2);
  });

  it("re-admits the same notification once its window has passed", async () => {
    await invoke(post(notif("AAPL")));

    now += DEDUP_TTL + 1;
    const second = await invoke(post(notif("AAPL")));

    expect(send_email_mock).toHaveBeenCalledTimes(2);
    expect(second.status).toBe(200);
  });

  it("still suppresses a repeat within the window on the same instance", async () => {
    const first = await invoke(post(notif("AAPL")));

    now += 60_000;
    const second = await invoke(post(notif("AAPL")));

    expect(send_email_mock).toHaveBeenCalledOnce();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
