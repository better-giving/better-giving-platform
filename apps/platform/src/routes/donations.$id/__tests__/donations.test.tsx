import { eq } from "drizzle-orm";
import { createRoutesStub } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { user } from "$/pg/schema/auth";
import {
  donation_donors,
  donation_recipients,
  donation_tributes,
  donations,
} from "$/pg/schema/donation";
import { donation_messages } from "$/pg/schema/donation-message";
import { funds } from "$/pg/schema/fund";
import { donation_match_events } from "$/pg/schema/match";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const send_email_mock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const get_session_mock = vi.hoisted(() => vi.fn());
const to_auth_mock = vi.hoisted(() =>
  vi.fn(() => new Response(null, { status: 302 }))
);
const cookie_parse_mock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const enqueue_mock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));

vi.mock("$/email", () => ({ send_email: send_email_mock }));

vi.mock("$/kit/queue", () => ({ enqueue: enqueue_mock }));

vi.mock("#/.server/auth", () => ({
  get_session: get_session_mock,
  to_auth: to_auth_mock,
}));

vi.mock("#/.server/cookie", () => ({
  donations_cookie: { parse: cookie_parse_mock },
}));

vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((data, msg) => ({ data, toast: msg })),
}));

vi.mock("#/helpers/confetti", () => ({
  confetti: vi.fn().mockResolvedValue(undefined),
}));

// --- imports after mocks ---

import { ADDRESS, EIN, LEGAL_NAME } from "@better-giving/brand";
import { npo_donors } from "#/.server/npo-donors";
import { emails } from "@/constants/common";
import { create_test_db } from "$/pg/test-utils/pglite";
import { PrivateMsgForm } from "../private-msg-form";
import { PublicMsgForm } from "../public-msg-form";
import Page, { action, loader } from "../route";
import { ShareBtn, socials } from "../share";
import { TributeForm } from "../tribute-form";

// --- helpers ---

const DON_ID = "don-test-001";
const DONOR_EMAIL = "donor@test.com";

function make_loader_data(overrides: Record<string, any> = {}) {
  return {
    id: DON_ID,
    to_id: "123",
    to_name: "Test NPO",
    to_type: "npo" as const,
    to_tip_allowed: true,
    to_members: [],
    from_email: DONOR_EMAIL,
    from_name: "Test Donor",
    from_public_msg_to_npo: undefined,
    from_private_msg_to_npo: undefined,
    from_public: undefined,
    tribute: undefined,
    status: "confirmed",
    amount: { base: 100, tip: 0, fee_allowance: 0 },
    currency: "USD",
    frequency: "one-time",
    upusd: 1,
    via: "stripe:card",
    source: "bg-marketplace",
    form_id: undefined,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    match_filed: false,
    is_donor: true,
    donate_url: "http://localhost/donate/123",
    donate_thanks_url: `http://localhost/donations/${DON_ID}`,
    profile_url: "http://localhost/org/123",
    ...overrides,
  };
}

/** the loader's projection for a visitor who is not the donor */
function make_public_loader_data(overrides: Record<string, any> = {}) {
  return {
    id: DON_ID,
    created_at: "2025-01-01T00:00:00Z",
    amount: { base: 100 },
    currency: "USD",
    to_id: "123",
    to_name: "Test NPO",
    to_type: "npo" as const,
    source: "bg-marketplace",
    form_id: undefined,
    from_public_msg_to_npo: "Keep up the good work",
    is_donor: false,
    donate_url: "http://localhost/donate/123",
    donate_thanks_url: `http://localhost/donations/${DON_ID}`,
    profile_url: "http://localhost/org/123",
    ...overrides,
  };
}

function render_page(data: object) {
  const Stub = createRoutesStub([
    {
      path: "/donations/:id",
      Component: Page,
      loader: () => data,
    },
  ]);
  return render(<Stub initialEntries={[`/donations/${DON_ID}`]} />);
}

// renders donor messages for an NPO as a cross-page UI assertion
async function render_donor_msgs(npo_id: number) {
  const { items } = await npo_donors(npo_id.toString());
  function DonorList() {
    if (items.length === 0) return <p>No donors</p>;
    return (
      <ul>
        {items.map((d: any) => (
          <li key={d.donor_name}>{d.donor_message}</li>
        ))}
      </ul>
    );
  }
  const Stub = createRoutesStub([
    { path: "/", Component: DonorList, HydrateFallback: () => null },
  ]);
  return render(<Stub />);
}

// --- setup ---

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  send_email_mock.mockClear();
  get_session_mock.mockReset().mockResolvedValue({ user: undefined });
  to_auth_mock.mockClear();
  cookie_parse_mock.mockReset().mockResolvedValue({});
  enqueue_mock.mockClear();

  // clean tables in correct FK order
  await test_db.current!.db.delete(donation_match_events);
  await test_db.current!.db.delete(donation_messages);
  await test_db.current!.db.delete(donation_tributes);
  await test_db.current!.db.delete(donation_donors);
  await test_db.current!.db.delete(donation_recipients);
  await test_db.current!.db.delete(donations);
  await test_db.current!.db.delete(user_npo_memberships);
  await test_db.current!.db.delete(funds);
  await test_db.current!.db.delete(user);
  await test_db.current!.db.delete(npos);
});

async function seed_npo() {
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({
      registration_number: "REG001",
      name: "Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: true,
      active: true,
    })
    .returning();
  return row;
}

async function seed_user_admin(npo_id: number) {
  const user_id = globalThis.crypto.randomUUID();
  await test_db.current!.db.insert(user).values({
    id: user_id,
    name: "Admin User",
    email: "admin@npo.org",
    first_name: "Admin",
    last_name: "User",
  });
  await test_db.current!.db.insert(user_npo_memberships).values({
    user_id,
    npo_id,
  });
  return { user_id, email: "admin@npo.org" };
}

async function seed_donation(
  npo_id: number,
  overrides: Record<string, any> = {}
) {
  const id = overrides.id ?? DON_ID;
  const date = new Date().toISOString();

  await test_db.current!.db.insert(donations).values({
    id,
    upusd: 1,
    status: overrides.status ?? "confirmed",
    amount_base: 100,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: overrides.source ?? "bg-marketplace",
    via: "stripe:card",
    created_at: date,
    updated_at: date,
  });
  await test_db.current!.db.insert(donation_recipients).values({
    donation_id: id,
    npo_id,
    name: "Test NPO",
    type: overrides.to_type ?? "npo",
  });
  await test_db.current!.db.insert(donation_donors).values({
    donation_id: id,
    email: overrides.from_email ?? DONOR_EMAIL,
    name: overrides.from_name ?? "Test Donor",
    public_msg: overrides.public_msg ?? null,
    private_msg: overrides.private_msg ?? null,
    is_public: overrides.is_public ?? null,
  });

  if (overrides.tribute) {
    await test_db.current!.db.insert(donation_tributes).values({
      donation_id: id,
      name: overrides.tribute.full_name,
      notif_email: overrides.tribute.notif?.to_email ?? null,
      notif_fullname: overrides.tribute.notif?.to_fullname ?? null,
      notif_msg: overrides.tribute.notif?.from_msg ?? null,
    });
  }

  return id;
}

function make_action_request(body: Record<string, string>, cookie_header = "") {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) {
    form.set(k, v);
  }
  return new Request(`http://localhost/donations/${DON_ID}`, {
    method: "POST",
    body: form,
    headers: cookie_header ? { cookie: cookie_header } : {},
  });
}

function action_args(request: Request, id = DON_ID) {
  return {
    request,
    params: { id },
    context: {} as any,
    url: new URL(request.url),
    pattern: "/donations/:id",
  } as any;
}

// --- tests ---

describe("Page — rendering", () => {
  it("NPO donation shows public msg, private msg, tribute, share, and nav links", async () => {
    const screen = await render_page(make_loader_data());

    await expect.element(screen.getByText(/share a message in/i)).toBeVisible();
    await expect
      .element(screen.getByText(/send a private message/i))
      .toBeVisible();
    await expect
      .element(screen.getByText(/dedicate your donation/i))
      .toBeVisible();
    await expect.element(screen.getByText(/spread the word/i)).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /my donations/i }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /browse nonprofits/i }))
      .toBeVisible();
  });

  it("fund donation shows public msg but hides private msg and tribute", async () => {
    const screen = await render_page(make_loader_data({ to_type: "fund" }));

    await expect.element(screen.getByText(/spread the word/i)).toBeVisible();
    await expect.element(screen.getByText(/share a message in/i)).toBeVisible();
    await expect
      .element(screen.getByText(/send a private message/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/dedicate your donation/i))
      .not.toBeInTheDocument();
  });

  it("widget version hides public msg, share, and nav links; shows Go Back", async () => {
    const screen = await render_page(make_loader_data({ source: "bg-widget" }));

    await expect
      .element(screen.getByRole("link", { name: /go back/i }))
      .toBeVisible();
    await expect
      .element(screen.getByText(/share a message in/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/spread the word/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /my donations/i }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /browse nonprofits/i }))
      .not.toBeInTheDocument();
  });

  it("widget without form_id: Go Back links to /donate-widget/:to_id", async () => {
    const screen = await render_page(
      make_loader_data({ source: "bg-widget", to_id: "456" })
    );
    await vi.waitFor(() => {
      const el = screen
        .getByRole("link", { name: /go back/i })
        .element() as HTMLElement;
      expect(el.getAttribute("href")).toContain("/donate-widget/456");
    });
  });

  it("widget with form_id: Go Back links to /forms/:form_id", async () => {
    const screen = await render_page(
      make_loader_data({ source: "bg-widget", form_id: "form-abc" })
    );
    await vi.waitFor(() => {
      const el = screen
        .getByRole("link", { name: /go back/i })
        .element() as HTMLElement;
      expect(el.getAttribute("href")).toContain("/forms/form-abc");
    });
  });

  it("submitted public msg shows success icon", async () => {
    const screen = await render_page(
      make_loader_data({ from_public_msg_to_npo: "Thanks!" })
    );
    await vi.waitFor(() => {
      const trigger = screen
        .getByText(/share a message in/i)
        .element() as HTMLElement;
      const svg = trigger.closest("button")?.querySelector("svg");
      expect(svg?.classList.contains("stroke-success")).toBe(true);
    });
  });

  it("submitted private msg shows success icon", async () => {
    const screen = await render_page(
      make_loader_data({ from_private_msg_to_npo: "Private note" })
    );
    await vi.waitFor(() => {
      const trigger = screen
        .getByText(/send a private message/i)
        .element() as HTMLElement;
      const svg = trigger.closest("button")?.querySelector("svg");
      expect(svg?.classList.contains("stroke-success")).toBe(true);
    });
  });

  it("submitted tribute shows success icon", async () => {
    const screen = await render_page(
      make_loader_data({ tribute: { full_name: "Jane Doe" } })
    );
    await vi.waitFor(() => {
      const trigger = screen
        .getByText(/dedicate your donation/i)
        .element() as HTMLElement;
      const svg = trigger.closest("button")?.querySelector("svg");
      expect(svg?.classList.contains("stroke-success")).toBe(true);
    });
  });
});

describe("Page — a visitor who is not the donor", () => {
  it("sees the gift and its public message but none of the donor's controls", async () => {
    const screen = await render_page(make_public_loader_data());

    await expect.element(screen.getByText(/share a message in/i)).toBeVisible();
    await screen.getByText(/share a message in/i).click();
    await expect
      .element(screen.getByLabelText(/public message/i))
      .toHaveValue("Keep up the good work");
    await expect.element(screen.getByText(/spread the word/i)).toBeVisible();

    // the action refuses every one of these to a non-donor
    await expect
      .element(screen.getByText(/send a private message/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/dedicate your donation/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByLabelText(/where do you work/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /filed this/i }))
      .not.toBeInTheDocument();
  });

  it("is not offered an empty public message form", async () => {
    const screen = await render_page(
      make_public_loader_data({ from_public_msg_to_npo: undefined })
    );

    await expect.element(screen.getByText(/spread the word/i)).toBeVisible();
    await expect
      .element(screen.getByText(/share a message in/i))
      .not.toBeInTheDocument();
  });

  it("leaves the donor every control", async () => {
    const screen = await render_page(make_loader_data());

    await expect.element(screen.getByText(/share a message in/i)).toBeVisible();
    await expect
      .element(screen.getByText(/send a private message/i))
      .toBeVisible();
    await expect
      .element(screen.getByText(/dedicate your donation/i))
      .toBeVisible();
    await expect
      .element(screen.getByLabelText(/where do you work/i))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /filed this/i }))
      .toBeVisible();
  });
});

describe("Page — a refunded donation", () => {
  it("prints no filing paperwork for money that went back", async () => {
    const screen = await render_page(
      make_loader_data({ status: "refunded", match_voided: true })
    );

    await expect
      .element(screen.getByText(/this donation was refunded/i))
      .toBeVisible();
    // walking a donor into filing a claim against a gift we no longer hold is
    // the harm this branch exists to prevent
    await expect.element(screen.getByText(EIN)).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /i've filed this/i }))
      .not.toBeInTheDocument();
  });

  it("prints no remittance details for money that went back", async () => {
    const screen = await render_page(
      make_loader_data({ status: "refunded", match_voided: true })
    );

    // an employer who mailed a check against a returned gift would be sending
    // money we hold nothing to match, and quoting a reference for a gift we
    // already gave back
    await expect
      .element(screen.getByText(/if your employer sends the match directly/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(`Donation ${DON_ID}`))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/^make checks payable to$/i))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText(emails.hi)).not.toBeInTheDocument();
  });

  it("tells a donor who already filed that the claim no longer applies", async () => {
    const screen = await render_page(
      make_loader_data({
        status: "refunded",
        match_voided: true,
        match_filed: true,
      })
    );

    await expect.element(screen.getByText(/no longer applies/i)).toBeVisible();
  });

  it("asks nothing about an employer", async () => {
    // the void gate would refuse the pack, so the field would be promising an
    // email that never comes
    const screen = await render_page(
      make_loader_data({ status: "refunded", match_voided: true })
    );

    await expect
      .element(screen.getByLabelText(/where do you work/i))
      .not.toBeInTheDocument();
  });

  it("names no employer back, even one already on record", async () => {
    // nothing about the panel's voided branch mentions an employer; the gift is
    // gone and who they work for has no bearing left
    const screen = await render_page(
      make_loader_data({
        status: "refunded",
        match_voided: true,
        from_company_name: "Acme Corp",
      })
    );

    await expect.element(screen.getByText("Acme Corp")).not.toBeInTheDocument();
  });
});

describe("Page — a matched donation", () => {
  it("confirms the match instead of printing the paperwork again", async () => {
    const screen = await render_page(
      make_loader_data({
        from_company_name: "Acme Corp",
        match_arrived: { amount: 250, currency: "USD" },
      })
    );

    await expect
      .element(screen.getByText(/acme corp matched this gift/i))
      .toBeVisible();
    // the paperwork has done its job; printing it beside a completed match
    // invites the donor to file a second claim for the same gift
    await expect
      .element(screen.getByText(/^ein \(tax id\)$/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/^make checks payable to$/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /i've filed this/i }))
      .not.toBeInTheDocument();
  });

  it("names the amount that arrived and the nonprofit it went to", async () => {
    const screen = await render_page(
      make_loader_data({
        to_name: "Test NPO",
        from_company_name: "Acme Corp",
        // the employer's own row is born-settled in usd; the panel prints what
        // actually arrived, not the donor's gift
        match_arrived: { amount: 250, currency: "usd" },
      })
    );

    await expect
      .element(screen.getByText(/250\.00 USD reached Test NPO/i))
      .toBeVisible();
  });

  it("falls back to a nameless employer when none was captured", async () => {
    // capture is optional and money can arrive for a donor who never named
    // anyone — an admin recording a cheque needs no help from the donor
    const screen = await render_page(
      make_loader_data({ match_arrived: { amount: 100, currency: "USD" } })
    );

    await expect
      .element(screen.getByText(/your employer matched this gift/i))
      .toBeVisible();
  });

  it("still shows the refund when a matched gift was later returned", async () => {
    // the arrival claim gates on `voided_at`, but voiding gates on nothing, so
    // this pair is reachable — and a returned gift is the more urgent of the
    // two things to tell a donor
    const screen = await render_page(
      make_loader_data({
        status: "refunded",
        match_voided: true,
        from_company_name: "Acme Corp",
        match_arrived: { amount: 250, currency: "USD" },
      })
    );

    await expect
      .element(screen.getByText(/this donation was refunded/i))
      .toBeVisible();
    await expect
      .element(screen.getByText(/matched this gift/i))
      .not.toBeInTheDocument();
  });
});

describe("Page — filing details", () => {
  it("shows the recipient's legal name, EIN and address", async () => {
    const screen = await render_page(make_loader_data());

    // the remittance block prints the same name and address again, so each
    // assertion names the identity row it belongs to
    await vi.waitFor(() => {
      expect(row_value(screen, /^recipient legal name$/i)).toBe(LEGAL_NAME);
      expect(row_value(screen, /^ein \(tax id\)$/i)).toBe(EIN);
      expect(row_value(screen, /^mailing address$/i)).toBe(ADDRESS);
    });
  });

  it("shows this donation's own date, amount and record url", async () => {
    const screen = await render_page(
      make_loader_data({
        // an instant that is already the 15th in UTC but still the 14th in the
        // americas — the receipt stamps UTC, so the panel must too or the two
        // documents an employer compares disagree on the gift's date
        created_at: "2025-03-15T03:00:00Z",
        amount: { base: 250, tip: 10, fee_allowance: 0 },
        currency: "usd",
      })
    );

    await expect.element(screen.getByText("Mar 15, 2025")).toBeVisible();
    await expect.element(screen.getByText("250.00 USD")).toBeVisible();
    await expect
      .element(screen.getByText(`http://localhost/donations/${DON_ID}`))
      .toBeVisible();
  });

  // the grid lays each row out as dt, an aria-hidden divider, then dd
  function row_value(
    screen: Awaited<ReturnType<typeof render_page>>,
    label: RegExp
  ) {
    const dt = screen.getByText(label).element();
    return dt.nextElementSibling?.nextElementSibling?.textContent;
  }

  it("shows an employer paying us directly where to send it and what to quote", async () => {
    const screen = await render_page(make_loader_data());

    await expect
      .element(screen.getByText(/if your employer sends the match directly/i))
      .toBeVisible();
    await vi.waitFor(() => {
      expect(row_value(screen, /^make checks payable to$/i)).toBe(LEGAL_NAME);
      expect(row_value(screen, /^mail to$/i)).toBe(ADDRESS);
      // the only thing that ties an arriving payment back to the gift it matches
      expect(row_value(screen, /^reference$/i)).toBe(`Donation ${DON_ID}`);
      expect(row_value(screen, /^employer questions$/i)).toBe(emails.hi);
    });
  });

  it("shows this donation's own id", async () => {
    const screen = await render_page(make_loader_data());

    // the pack email prints a transaction id and the page did not — a donor
    // copying from the screen had no reference to hand their employer
    await expect
      .element(screen.getByText(DON_ID, { exact: true }))
      .toBeVisible();
  });

  // the payload is ours and employer-independent — every donor gets it, whether
  // or not they named a company, and whichever surface they donated from
  it.each([
    ["no employer named", {}],
    ["employer named", { from_company_name: "Acme Corp" }],
    ["fund donation", { to_type: "fund" as const }],
    ["widget donation", { source: "bg-widget" }],
  ])("shows for %s", async (_, overrides) => {
    const screen = await render_page(make_loader_data(overrides));

    await expect
      .element(screen.getByText(/ask your employer to match this gift/i))
      .toBeVisible();
    await expect.element(screen.getByText(EIN)).toBeVisible();
  });

  it("offers a submit button, never a link, when nothing is filed", async () => {
    const screen = await render_page(make_loader_data());

    const btn = screen.getByRole("button", { name: /i've filed this/i });
    await expect.element(btn).toBeVisible();
    // a POST, not a GET: corporate mail security prefetches inbound urls, and a
    // prefetch must not be able to mark a claim filed
    await vi.waitFor(() => {
      const el = btn.element() as HTMLButtonElement;
      expect(el.getAttribute("type")).toBe("submit");
      expect(el.closest("form")?.getAttribute("method")?.toLowerCase()).toBe(
        "post"
      );
    });
  });

  it("shows the confirmation instead of the button once filed", async () => {
    const screen = await render_page(make_loader_data({ match_filed: true }));

    await expect
      .element(screen.getByText(/you told us you filed this/i))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /i've filed this/i }))
      .not.toBeInTheDocument();
  });
});

describe("Page — employer capture", () => {
  it("asks inside the filing panel, not in a card of its own", async () => {
    const screen = await render_page(make_loader_data());

    // one card, one subject. the field and the paperwork it offers to email
    // must share a section, or the donor meets matching twice on one page.
    const heading = screen
      .getByText(/ask your employer to match this gift/i)
      .element();
    const input = screen.getByLabelText(/where do you work/i).element();
    expect(heading.closest("section")).toBe(input.closest("section"));
  });

  it("shows the field without anything to expand first", async () => {
    const screen = await render_page(make_loader_data());

    // no collapsible: the one action here with a consequence beyond the screen
    // is not something a donor should have to discover
    await expect
      .element(screen.getByLabelText(/where do you work/i))
      .toBeVisible();
  });

  it("shows the recorded employer instead of a field", async () => {
    const screen = await render_page(
      make_loader_data({ from_company_name: "Acme Corp" })
    );

    await expect.element(screen.getByText("Acme Corp")).toBeVisible();
    // no input to overwrite it with — the action ignores a second submit
    await expect
      .element(screen.getByLabelText(/where do you work/i))
      .not.toBeInTheDocument();
  });

  it("keeps asking after the donor says they filed", async () => {
    const screen = await render_page(make_loader_data({ match_filed: true }));

    // there is no pack left to offer, but the name is worth more than ever —
    // the employer's verification request is coming to us
    await expect
      .element(screen.getByLabelText(/where do you work/i))
      .toBeVisible();
    await expect
      .element(screen.getByText(/verification request to expect/i))
      .toBeVisible();
  });

  // a fund donation reaches the same nonprofits and is just as matchable, so
  // unlike its neighbours this card is not recipient-gated
  it("shows for a fund donation", async () => {
    const screen = await render_page(make_loader_data({ to_type: "fund" }));

    await expect
      .element(screen.getByLabelText(/where do you work/i))
      .toBeVisible();
  });

  it("submits type=employer with the typed name", async () => {
    const submitted: Record<string, string> = {};
    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: () => make_loader_data(),
        action: async ({ request }) => {
          const fd = await request.formData();
          for (const [k, v] of fd.entries()) submitted[k] = String(v);
          return null;
        },
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByLabelText(/where do you work/i).fill("Acme Corp");
    await screen.getByRole("button", { name: /save/i }).click();

    // remix-hook-form json-encodes each field; the action decodes it again
    await vi.waitFor(() => {
      expect(JSON.parse(submitted.type!)).toBe("employer");
      expect(JSON.parse(submitted.company_name!)).toBe("Acme Corp");
    });
  });
});

describe("PublicMsgForm", () => {
  function render_form(init?: string) {
    const Stub = createRoutesStub([
      {
        path: "/test",
        Component: () => <PublicMsgForm init={init} />,
        action: () => null,
      },
    ]);
    return render(<Stub initialEntries={["/test"]} />);
  }

  it("renders textarea, char counter at 0/500, and enabled submit", async () => {
    const screen = await render_form();
    await expect
      .element(screen.getByLabelText(/public message/i))
      .toBeVisible();
    await expect.element(screen.getByText("0/500")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeEnabled();
  });

  it("disables textarea and submit when init provided", async () => {
    const screen = await render_form("Already sent");
    await expect
      .element(screen.getByLabelText(/public message/i))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeDisabled();
  });

  it("updates char counter on input", async () => {
    const screen = await render_form();
    await screen.getByLabelText(/public message/i).fill("Hello");
    await expect.element(screen.getByText("5/500")).toBeVisible();
  });
});

describe("PrivateMsgForm", () => {
  function render_form(init?: string) {
    const Stub = createRoutesStub([
      {
        path: "/test",
        Component: () => <PrivateMsgForm init={init} />,
        action: () => null,
      },
    ]);
    return render(<Stub initialEntries={["/test"]} />);
  }

  it("renders with unique IDs (no collision with public form)", async () => {
    const screen = await render_form();
    await vi.waitFor(() => {
      const textarea = screen.container.querySelector("#private-msg-textarea");
      expect(textarea).not.toBeNull();
      // ensure no element with old id
      const old = screen.container.querySelector("#msg-textarea");
      expect(old).toBeNull();
    });
  });

  it("disables textarea and submit when init provided", async () => {
    const screen = await render_form("Private note");
    await expect
      .element(screen.getByLabelText(/private message/i))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeDisabled();
  });
});

describe("TributeForm", () => {
  function render_form(init?: any) {
    const Stub = createRoutesStub([
      {
        path: "/test",
        Component: () => <TributeForm init={init} />,
        action: () => null,
      },
    ]);
    return render(<Stub initialEntries={["/test"]} />);
  }

  it("renders honoree name and unchecked notification checkbox", async () => {
    const screen = await render_form();
    await expect.element(screen.getByLabelText(/honoree/i)).toBeVisible();
    const checkbox = screen.getByRole("checkbox", { name: /notify someone/i });
    await expect.element(checkbox).not.toBeChecked();
  });

  it("checking notification reveals recipient fields", async () => {
    const screen = await render_form();
    await screen.getByRole("checkbox", { name: /notify someone/i }).click();
    await expect
      .element(screen.getByLabelText(/recipient name/i))
      .toBeVisible();
    await expect.element(screen.getByLabelText(/email address/i)).toBeVisible();
    await expect
      .element(screen.getByLabelText(/custom message/i))
      .toBeVisible();
  });

  it("all fields and submit disabled when init has full_name + notif", async () => {
    const screen = await render_form({
      full_name: "Jane",
      notif: { to_email: "a@b.com", to_fullname: "Bob", from_msg: "hi" },
    });
    await expect.element(screen.getByLabelText(/honoree/i)).toBeDisabled();
    await expect
      .element(screen.getByRole("checkbox", { name: /notify someone/i }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeDisabled();
  });

  it("submit enabled when init has full_name but no notif", async () => {
    const screen = await render_form({ full_name: "Jane" });
    await expect.element(screen.getByLabelText(/honoree/i)).toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeEnabled();
  });
});

describe("ShareBtn", () => {
  function render_share(id: "x" | "fb" | "linkedin" | "telegram" = "x") {
    const social = socials.find((s) => s.id === id)!;
    return render(
      <ShareBtn
        {...social}
        recipient={{ id: "123", name: "Test NPO" }}
        donate_url="http://localhost/donate/123"
        donate_thanks_url="http://localhost/donations/don-001"
      />
    );
  }

  it("clicking opens modal with share text and Share now link", async () => {
    const screen = await render_share("x");
    await screen.getByRole("button").click();
    await expect.element(screen.getByText(/i just donated to/i)).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /share now/i }))
      .toBeVisible();
  });

  it("X share link contains x.com/intent/tweet", async () => {
    const screen = await render_share("x");
    await screen.getByRole("button").click();
    await vi.waitFor(() => {
      const link = screen
        .getByRole("link", { name: /share now/i })
        .element() as HTMLElement;
      expect(link.getAttribute("href")).toContain("x.com/intent/tweet");
    });
  });

  it("Facebook share link contains facebook.com/dialog/share", async () => {
    const screen = await render_share("fb");
    await screen.getByRole("button").click();
    await vi.waitFor(() => {
      const link = screen
        .getByRole("link", { name: /share now/i })
        .element() as HTMLElement;
      expect(link.getAttribute("href")).toContain("facebook.com/dialog/share");
    });
  });
});

describe("Integration — loader", () => {
  it("NPO: returns data with correct URLs", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id);

    const request = new Request(`http://localhost/donations/${DON_ID}`);
    const result = await loader(action_args(request) as any);

    expect(result.id).toBe(DON_ID);
    expect(result.donate_url).toContain("/donate/");
    expect(result.profile_url).toContain("/org/");
    expect(result.donate_thanks_url).toContain(`/donations/${DON_ID}`);
  });

  it("matched: reports the amount off the employer's own donation row", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "settled" });
    // the match outcome is the donor's alone
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    // the employer's payment is a second, born-settled donation row — the only
    // place the amount that actually arrived is written. the donor's own row
    // still holds the donor's own gift, which is a different number.
    const match_don_id = "don-employer-001";
    const now = new Date().toISOString();
    await test_db.current!.db.insert(donations).values({
      id: match_don_id,
      upusd: 1,
      status: "settled",
      amount_base: 400,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "match",
      created_at: now,
      updated_at: now,
    });
    await test_db.current!.db.insert(donation_match_events).values({
      id: globalThis.crypto.randomUUID(),
      donation_id: DON_ID,
      matched_donation_id: match_don_id,
      matched_at: now,
    });

    const result = await loader(
      action_args(new Request(`http://localhost/donations/${DON_ID}`)) as any
    );

    expect(result.match_arrived).toEqual({ amount: 400, currency: "USD" });
  });

  it("unmatched: reports no arrival for an event that only got as far as filed", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "settled" });
    // the match outcome is the donor's alone
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });
    await test_db.current!.db.insert(donation_match_events).values({
      id: globalThis.crypto.randomUUID(),
      donation_id: DON_ID,
      submitted_at: new Date().toISOString(),
    });

    const result = await loader(
      action_args(new Request(`http://localhost/donations/${DON_ID}`)) as any
    );

    // the donor said they filed; no employer money has landed
    expect(result.match_filed).toBe(true);
    expect(result.match_arrived).toBeUndefined();
  });

  it("fund: returns donate-fund and campaigns URLs", async () => {
    const fund_id = globalThis.crypto.randomUUID();
    const don_id = "don-fund-001";
    const date = new Date().toISOString();

    const creator_id = globalThis.crypto.randomUUID();
    await test_db.current!.db.insert(user).values({
      id: creator_id,
      name: "Fund Creator",
      email: `creator-${creator_id.slice(0, 8)}@test.com`,
      first_name: "Fund",
      last_name: "Creator",
    });
    await test_db.current!.db.insert(funds).values({
      id: fund_id,
      name: "Test Fund",
      description_pt: "A test fund",
      banner: "banner.webp",
      logo: "logo.webp",
      creator_id,
    });

    await test_db.current!.db.insert(donations).values({
      id: don_id,
      upusd: 1,
      status: "confirmed",
      amount_base: 50,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
      created_at: date,
      updated_at: date,
    });
    await test_db.current!.db.insert(donation_recipients).values({
      donation_id: don_id,
      fund_id,
      name: "Test Fund",
      type: "fund",
    });
    await test_db.current!.db.insert(donation_donors).values({
      donation_id: don_id,
      email: DONOR_EMAIL,
    });

    const request = new Request(`http://localhost/donations/${don_id}`);
    const result = await loader(action_args(request, don_id) as any);

    expect(result.donate_url).toContain("/donate-fund/");
    expect(result.profile_url).toContain("/campaigns/");
  });

  it("throws 404 for missing donation", async () => {
    const request = new Request("http://localhost/donations/nonexistent");
    await expect(
      loader(action_args(request, "nonexistent") as any)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("Integration — action", () => {
  // --- auth tests ---

  it("cookie auth: valid cookie allows action without session", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id);

    cookie_parse_mock.mockResolvedValue({
      [DON_ID]: Date.now() + 60_000,
    });
    get_session_mock.mockResolvedValue({ user: null });

    const request = make_action_request({
      type: "public_msg",
      msg: "Hello from cookie!",
    });

    const result = await action(action_args(request));

    expect(result).toHaveProperty("toast");
    expect(to_auth_mock).not.toHaveBeenCalled();
  });

  it("session auth: falls back to session when cookie missing", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id);

    cookie_parse_mock.mockResolvedValue({});
    get_session_mock.mockResolvedValue({ user: { email: DONOR_EMAIL } });

    const request = make_action_request({
      type: "public_msg",
      msg: "Hello from session!",
    });

    const result = await action(action_args(request));

    expect(result).toHaveProperty("toast");
  });

  it("wrong email throws 403", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id);

    cookie_parse_mock.mockResolvedValue({});
    get_session_mock.mockResolvedValue({ user: { email: "other@test.com" } });

    const request = make_action_request({
      type: "public_msg",
      msg: "Unauthorized",
    });

    await expect(action(action_args(request))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("no auth calls to_auth", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id);

    cookie_parse_mock.mockResolvedValue({});
    get_session_mock.mockResolvedValue({ user: null });

    const request = make_action_request({
      type: "public_msg",
      msg: "No auth",
    });

    await action(action_args(request));
    expect(to_auth_mock).toHaveBeenCalled();
  });

  // --- public_msg flow ---

  it("public_msg paid: submit via UI, revalidates, appears on profile", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "confirmed" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    // open public msg, fill, submit
    await screen.getByText(/share a message in/i).click();
    await screen.getByLabelText(/public message/i).fill("Great cause!");
    await screen.getByRole("button", { name: /submit/i }).click();

    // revalidation proof: textarea disabled
    await expect
      .element(screen.getByLabelText(/public message/i))
      .toBeDisabled();

    // cross-page: verify message appears on NPO profile
    await cleanup();
    const profile = await render_donor_msgs(npo.id);
    await expect.element(profile.getByText("Great cause!")).toBeInTheDocument();
  });

  it("public_msg unpaid: submit via UI, revalidates, not on profile yet", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "intent" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/share a message in/i).click();
    await screen.getByLabelText(/public message/i).fill("Pending msg");
    await screen.getByRole("button", { name: /submit/i }).click();

    // revalidation proof: textarea disabled (message saved)
    await expect
      .element(screen.getByLabelText(/public message/i))
      .toBeDisabled();

    // not yet on profile (unpaid — no donation_message row created)
    await cleanup();
    const profile = await render_donor_msgs(npo.id);
    await expect.element(profile.getByText("No donors")).toBeInTheDocument();
  });

  it("public_msg already exists: textarea pre-disabled, submit blocked", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { public_msg: "Already sent" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/share a message in/i).click();
    await expect
      .element(screen.getByLabelText(/public message/i))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeDisabled();
  });

  // --- private_msg flow ---

  it("private_msg paid: submit via UI, revalidates, sends email", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "settled" });
    await seed_user_admin(npo.id);
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/send a private message/i).click();
    await screen.getByLabelText(/private message/i).fill("Thank you so much");
    await screen.getByRole("button", { name: /submit/i }).click();

    // revalidation proof
    await expect
      .element(screen.getByLabelText(/private message/i))
      .toBeDisabled();
    // side effect
    await vi.waitFor(() => expect(send_email_mock).toHaveBeenCalledOnce());
  });

  it("private_msg unpaid: submit via UI, revalidates, no email", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "created" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/send a private message/i).click();
    await screen.getByLabelText(/private message/i).fill("Pending private");
    await screen.getByRole("button", { name: /submit/i }).click();

    await expect
      .element(screen.getByLabelText(/private message/i))
      .toBeDisabled();
    expect(send_email_mock).not.toHaveBeenCalled();
  });

  it("private_msg already exists: textarea pre-disabled", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { private_msg: "Already sent" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/send a private message/i).click();
    await expect
      .element(screen.getByLabelText(/private message/i))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeDisabled();
  });

  // --- tribute flow ---

  it("tribute without notif: submit via UI, revalidates, no email", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id);
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/dedicate your donation/i).click();
    await screen.getByLabelText(/honoree/i).fill("Jane Doe");
    await screen.getByRole("button", { name: /submit/i }).click();

    // revalidation proof: honoree field disabled
    await expect.element(screen.getByLabelText(/honoree/i)).toBeDisabled();
    expect(send_email_mock).not.toHaveBeenCalled();
  });

  it("tribute with notif paid: submit via UI, sends email", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "confirmed" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/dedicate your donation/i).click();
    await screen.getByLabelText(/honoree/i).fill("Jane Doe");
    await screen.getByRole("checkbox", { name: /notify someone/i }).click();
    await screen.getByLabelText(/recipient name/i).fill("Friend");
    await screen.getByLabelText(/email address/i).fill("friend@test.com");
    await screen.getByLabelText(/custom message/i).fill("In memory of");
    await screen.getByRole("button", { name: /submit/i }).click();

    // revalidation proof
    await expect.element(screen.getByLabelText(/honoree/i)).toBeDisabled();
    // side effect: tribute notification email sent
    await vi.waitFor(() => expect(send_email_mock).toHaveBeenCalledOnce());
    expect(send_email_mock.mock.calls[0][0].to).toContain("friend@test.com");
  });

  it("tribute with notif unpaid: submit via UI, no email", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "intent" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/dedicate your donation/i).click();
    await screen.getByLabelText(/honoree/i).fill("Jane Doe");
    await screen.getByRole("checkbox", { name: /notify someone/i }).click();
    await screen.getByLabelText(/recipient name/i).fill("Friend");
    await screen.getByLabelText(/email address/i).fill("friend@test.com");
    await screen.getByLabelText(/custom message/i).fill("In memory of");
    await screen.getByRole("button", { name: /submit/i }).click();

    await expect.element(screen.getByLabelText(/honoree/i)).toBeDisabled();
    expect(send_email_mock).not.toHaveBeenCalled();
  });

  it("tribute already exists: fields pre-disabled", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, {
      tribute: {
        full_name: "Existing",
        notif: { to_email: "a@b.com", to_fullname: "Bob", from_msg: "hi" },
      },
    });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    await screen.getByText(/dedicate your donation/i).click();
    await expect.element(screen.getByLabelText(/honoree/i)).toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeDisabled();
  });

  // --- employer flow ---

  it("employer: records the name against the donation", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id);
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const result = await action(
      action_args(
        make_action_request({ type: "employer", company_name: "Acme Corp" })
      )
    );
    expect(result).toHaveProperty("toast");

    const after = await loader(
      action_args(new Request(`http://localhost/donations/${DON_ID}`)) as any
    );
    expect(after.from_company_name).toBe("Acme Corp");
  });

  it("employer: a second submit does not overwrite the first", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id);
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    await action(
      action_args(
        make_action_request({ type: "employer", company_name: "Acme Corp" })
      )
    );
    await action(
      action_args(
        make_action_request({ type: "employer", company_name: "Other Inc" })
      )
    );

    const after = await loader(
      action_args(new Request(`http://localhost/donations/${DON_ID}`)) as any
    );
    expect(after.from_company_name).toBe("Acme Corp");
  });

  it("employer: queues the filing pack for a paid donation", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "settled" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    await action(
      action_args(
        make_action_request({ type: "employer", company_name: "Acme Corp" })
      )
    );

    expect(enqueue_mock).toHaveBeenCalledTimes(1);
    expect(enqueue_mock.mock.calls[0]![0]).toMatchObject({
      id: "don-match",
      dedupe: `don.match_${DON_ID}`,
      payload: { id: DON_ID, from_company_name: "Acme Corp" },
    });
  });

  it("employer: queues nothing for a donation that hasn't been paid", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "intent" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    await action(
      action_args(
        make_action_request({ type: "employer", company_name: "Acme Corp" })
      )
    );

    // the name is still recorded — settlement picks it up and emits the same
    // message itself, so an abandoned intent can never produce a pack
    const after = await loader(
      action_args(new Request(`http://localhost/donations/${DON_ID}`)) as any
    );
    expect(after.from_company_name).toBe("Acme Corp");
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  // --- filed flow ---

  // a donor who never named an employer has no event row, so the branch has to
  // open one before it can claim — the button is on the universal panel
  async function match_event(donation_id = DON_ID) {
    const [row] = await test_db
      .current!.db.select()
      .from(donation_match_events)
      .where(eq(donation_match_events.donation_id, donation_id));
    return row;
  }

  it("filed: stamps the claim and mails the heads-up once", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "settled" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const result = await action(
      action_args(make_action_request({ type: "filed" }))
    );
    expect(result).toHaveProperty("toast");

    expect((await match_event())?.submitted_at).not.toBeNull();
    expect(send_email_mock).toHaveBeenCalledOnce();
    // never the beneficiary nonprofit — we are the filing entity, so we are the
    // ones an employer verifies with
    expect(send_email_mock.mock.calls[0][0].to).toEqual(["hi@better.giving"]);
  });

  it("filed: a second submit mails nothing and keeps the first stamp", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, { status: "settled" });
    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    await action(action_args(make_action_request({ type: "filed" })));
    const first = (await match_event())?.submitted_at;

    const again = await action(
      action_args(make_action_request({ type: "filed" }))
    );

    // the donor sees the same thing either way — they did the same thing
    expect(again).toHaveProperty("toast");
    expect((await match_event())?.submitted_at).toBe(first);
    expect(send_email_mock).toHaveBeenCalledOnce();
  });

  // a fund donation reaches the same nonprofits and is just as matchable, so
  // the claim is not recipient-gated any more than employer capture is
  it("filed: accepted for a fund donation", async () => {
    const fund_id = globalThis.crypto.randomUUID();
    const date = new Date().toISOString();

    const creator_id = globalThis.crypto.randomUUID();
    await test_db.current!.db.insert(user).values({
      id: creator_id,
      name: "Fund Creator",
      email: `creator-${creator_id.slice(0, 8)}@test.com`,
      first_name: "Fund",
      last_name: "Creator",
    });
    await test_db.current!.db.insert(funds).values({
      id: fund_id,
      name: "Test Fund",
      description_pt: "A test fund",
      banner: "banner.webp",
      logo: "logo.webp",
      creator_id,
    });
    await test_db.current!.db.insert(donations).values({
      id: DON_ID,
      upusd: 1,
      status: "confirmed",
      amount_base: 50,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
      created_at: date,
      updated_at: date,
    });
    await test_db.current!.db.insert(donation_recipients).values({
      donation_id: DON_ID,
      fund_id,
      name: "Test Fund",
      type: "fund",
    });
    await test_db.current!.db.insert(donation_donors).values({
      donation_id: DON_ID,
      email: DONOR_EMAIL,
    });

    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const result = await action(
      action_args(make_action_request({ type: "filed" }))
    );
    expect(result).toHaveProperty("toast");
    expect((await match_event())?.submitted_at).not.toBeNull();

    const after = await loader(
      action_args(new Request(`http://localhost/donations/${DON_ID}`)) as any
    );
    expect(after.match_filed).toBe(true);
  });

  // --- fund guard ---

  it("fund donation: rejects tribute and private_msg at action level", async () => {
    const fund_id = globalThis.crypto.randomUUID();
    const date = new Date().toISOString();

    const creator_id = globalThis.crypto.randomUUID();
    await test_db.current!.db.insert(user).values({
      id: creator_id,
      name: "Fund Creator",
      email: `creator-${creator_id.slice(0, 8)}@test.com`,
      first_name: "Fund",
      last_name: "Creator",
    });
    await test_db.current!.db.insert(funds).values({
      id: fund_id,
      name: "Test Fund",
      description_pt: "A test fund",
      banner: "banner.webp",
      logo: "logo.webp",
      creator_id,
    });

    await test_db.current!.db.insert(donations).values({
      id: DON_ID,
      upusd: 1,
      status: "confirmed",
      amount_base: 50,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
      created_at: date,
      updated_at: date,
    });
    await test_db.current!.db.insert(donation_recipients).values({
      donation_id: DON_ID,
      fund_id,
      name: "Test Fund",
      type: "fund",
    });
    await test_db.current!.db.insert(donation_donors).values({
      donation_id: DON_ID,
      email: DONOR_EMAIL,
    });

    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    // tribute → 400
    await expect(
      action(
        action_args(make_action_request({ type: "tribute", full_name: "Jane" }))
      )
    ).rejects.toMatchObject({ status: 400 });

    // private_msg → 400
    await expect(
      action(
        action_args(make_action_request({ type: "private_msg", msg: "Hello" }))
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it("fund donation: accepts employer capture", async () => {
    const fund_id = globalThis.crypto.randomUUID();
    const date = new Date().toISOString();

    const creator_id = globalThis.crypto.randomUUID();
    await test_db.current!.db.insert(user).values({
      id: creator_id,
      name: "Fund Creator",
      email: `creator-${creator_id.slice(0, 8)}@test.com`,
      first_name: "Fund",
      last_name: "Creator",
    });
    await test_db.current!.db.insert(funds).values({
      id: fund_id,
      name: "Test Fund",
      description_pt: "A test fund",
      banner: "banner.webp",
      logo: "logo.webp",
      creator_id,
    });
    await test_db.current!.db.insert(donations).values({
      id: DON_ID,
      upusd: 1,
      status: "confirmed",
      amount_base: 50,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
      created_at: date,
      updated_at: date,
    });
    await test_db.current!.db.insert(donation_recipients).values({
      donation_id: DON_ID,
      fund_id,
      name: "Test Fund",
      type: "fund",
    });
    await test_db.current!.db.insert(donation_donors).values({
      donation_id: DON_ID,
      email: DONOR_EMAIL,
    });

    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const result = await action(
      action_args(
        make_action_request({ type: "employer", company_name: "Acme Corp" })
      )
    );
    expect(result).toHaveProperty("toast");

    const after = await loader(
      action_args(new Request(`http://localhost/donations/${DON_ID}`)) as any
    );
    expect(after.from_company_name).toBe("Acme Corp");
  });

  it("fund donation: submitting public msg via UI succeeds", async () => {
    const fund_id = globalThis.crypto.randomUUID();
    const date = new Date().toISOString();

    const creator_id = globalThis.crypto.randomUUID();
    await test_db.current!.db.insert(user).values({
      id: creator_id,
      name: "Fund Creator",
      email: `creator-${creator_id.slice(0, 8)}@test.com`,
      first_name: "Fund",
      last_name: "Creator",
    });
    await test_db.current!.db.insert(funds).values({
      id: fund_id,
      name: "Test Fund",
      description_pt: "A test fund",
      banner: "banner.webp",
      logo: "logo.webp",
      creator_id,
    });

    await test_db.current!.db.insert(donations).values({
      id: DON_ID,
      upusd: 1,
      status: "confirmed",
      amount_base: 50,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
      created_at: date,
      updated_at: date,
    });
    await test_db.current!.db.insert(donation_recipients).values({
      donation_id: DON_ID,
      fund_id,
      name: "Test Fund",
      type: "fund",
    });
    await test_db.current!.db.insert(donation_donors).values({
      donation_id: DON_ID,
      email: DONOR_EMAIL,
    });

    cookie_parse_mock.mockResolvedValue({ [DON_ID]: Date.now() + 60_000 });

    const Stub = createRoutesStub([
      {
        path: "/donations/:id",
        Component: Page,
        loader: loader as any,
        action: action as any,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/donations/${DON_ID}`]} />
    );

    // open public msg section
    await screen.getByText(/share a message in/i).click();
    await expect
      .element(screen.getByLabelText(/public message/i))
      .toBeVisible();

    // fill and submit
    await screen.getByLabelText(/public message/i).fill("Go fund!");
    await screen.getByRole("button", { name: /submit/i }).click();

    // after revalidation, textarea should be disabled (init is now set)
    await expect
      .element(screen.getByLabelText(/public message/i))
      .toBeDisabled();
  });
});
