import { HttpResponse, http } from "msw";
import { createRoutesStub, href } from "react-router";
import { parse } from "valibot";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import {
  donation_donors,
  donation_recipients,
  donations,
} from "$/pg/schema/donation";
import { donation_match_events } from "$/pg/schema/match";
import { npos } from "$/pg/schema/npo";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

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

// the create action mails the donor when an employer's match attaches, which
// drags nodemailer into the browser bundle; stubbed here so the module graph
// stays loadable and the send stays observable
const send_email = vi.hoisted(() =>
  vi.fn(async (_i: { node: any; to: string[]; subject: string }) => ({
    data: { id: "email-1", response: "250 ok" },
    error: null,
  }))
);
vi.mock("$/email", () => ({ send_email, sender: "test@test.com" }));

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

// --- imports (after mocks) ---

import { get_npos } from "#/.server/npos";
import { mswWorker } from "#/setup-tests-browser";
import { search } from "@/helpers/https";
import { npos_search } from "@/npo/schema";
import { create_test_db } from "$/pg/test-utils/pglite";
import {
  action as createAction,
  loader as createLoader,
} from "../../platform.donation-settlements.create/api";
import CreatePage from "../../platform.donation-settlements.create/route";
import { loader } from "../api";
import ListPage from "../route";

// --- setup ---

const npo_id = { value: 0 };
const GIFT_ID = "gift-for-match";

beforeAll(async () => {
  test_db.current = await create_test_db();
  const rows = await test_db.current.db
    .insert(npos)
    .values([
      {
        name: "Freegan Food Foundation",
        registration_number: "EIN-TEST-001",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      },
      {
        name: "Zebra Wildlife Trust",
        registration_number: "EIN-TEST-002",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      },
    ])
    .returning({ id: npos.id });
  npo_id.value = rows[0].id;

  // a donor gift for the employer-match flow to attach to
  await test_db.current.db.insert(donations).values({
    id: GIFT_ID,
    upusd: 1,
    status: "settled",
    amount_base: 200,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await test_db.current.db.insert(donation_recipients).values({
    donation_id: GIFT_ID,
    npo_id: npo_id.value,
    name: "Freegan Food Foundation",
    type: "npo",
  });
  await test_db.current.db.insert(donation_donors).values({
    donation_id: GIFT_ID,
    email: "ada@test.com",
    name: "Ada Lovelace",
    company_name: "Northwind Traders",
  });
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

// --- helpers ---

function render_app(initial = "/platform/donation-settlements") {
  const Stub = createRoutesStub([
    {
      path: "/platform/donation-settlements",
      Component: ListPage,
      HydrateFallback: () => null,
      loader,
      children: [
        {
          path: "create",
          Component: CreatePage,
          loader: createLoader,
          action: createAction,
        },
      ],
    },
  ]);

  // the npo combobox fetches /api/npos directly rather than through a router
  // fetcher, so the stub's routes never see it — msw answers from the same
  // pglite the loaders read
  mswWorker.use(
    http.get(href("/api/npos"), async ({ request }) =>
      HttpResponse.json(
        await get_npos(parse(npos_search, search(new URL(request.url))))
      )
    )
  );

  return render(<Stub initialEntries={[initial]} />);
}

// --- helpers: fill form and go to preview ---

async function fill_form_and_preview(
  screen: Awaited<ReturnType<typeof render>>,
  opts: {
    from?: "cheque" | "daf" | "stocks" | "match";
    donor_name?: string;
    net: string;
    reference: string;
    for_donation_id?: string;
  }
) {
  if (opts.from) {
    const label = {
      cheque: "Cheque",
      daf: "DAF",
      stocks: "Stocks",
      match: "Employer match",
    }[opts.from];
    // the control shows the label; the action still receives the machine value
    await screen.getByRole("combobox", { name: /^From/ }).click();
    await screen.getByRole("option", { name: label, exact: true }).click();
  }

  const combo = screen.getByPlaceholder("Search for an organization...");
  await expect.element(combo, { timeout: 3000 }).toBeVisible();
  await combo.fill("Freegan");

  await expect
    .element(screen.getByRole("option", { name: "Freegan Food Foundation" }), {
      timeout: 3000,
    })
    .toBeVisible();
  // search must filter — non-matching option should be absent
  await expect
    .element(screen.getByRole("option", { name: "Zebra Wildlife Trust" }))
    .not.toBeInTheDocument();
  // playwright pointer click (not native DOM .click) — the option is portaled
  // outside the dialog, and ark ui's combobox selects via the pointer path
  // (pointerdown → item-press); a bare click() skips that and intermittently
  // no-ops, leaving the npo field empty and blocking the preview.
  await screen.getByRole("option", { name: "Freegan Food Foundation" }).click();

  if (opts.donor_name) {
    await screen.getByPlaceholder("Anonymous").fill(opts.donor_name);
  }
  await screen.getByPlaceholder("0.00").fill(opts.net);
  await screen.getByLabelText("Reference / Grant ID").fill(opts.reference);

  if (opts.for_donation_id) {
    await screen
      .getByPlaceholder("e.g. 7c3f9a2e-...")
      .fill(opts.for_donation_id);
  }

  // click preview
  const preview_btn = screen.getByRole("button", { name: /preview/i });
  (preview_btn.element() as HTMLElement).click();

  // wait for preview to load
  await expect
    .element(screen.getByText("Confirm settlement"), { timeout: 5000 })
    .toBeInTheDocument();
}

// --- tests ---

describe("settle donation — full flow", () => {
  it("preview → back returns to form with values intact", async () => {
    const screen = await render_app();

    // navigate to create
    (
      screen.getByRole("link", { name: /new/i }).element() as HTMLElement
    ).click();

    // fill and preview
    await fill_form_and_preview(screen, {
      net: "500",
      reference: "ref-back-test",
    });

    // click back
    (
      screen.getByRole("button", { name: /back/i }).element() as HTMLElement
    ).click();

    // back on form
    await expect
      .element(screen.getByText("New settlement"))
      .toBeInTheDocument();
  });

  it("shows Anonymous when donor name is left empty", async () => {
    const screen = await render_app();

    (
      screen.getByRole("link", { name: /new/i }).element() as HTMLElement
    ).click();

    await fill_form_and_preview(screen, {
      net: "100",
      reference: "ref-anon",
    });

    await expect.element(screen.getByText("Anonymous")).toBeInTheDocument();
  });

  it("shows validation errors when submitting empty form", async () => {
    const screen = await render_app();

    (
      screen.getByRole("link", { name: /new/i }).element() as HTMLElement
    ).click();

    // preview button is always enabled
    const preview_btn = screen.getByRole("button", { name: /preview/i });
    await expect.element(preview_btn, { timeout: 3000 }).toBeEnabled();

    // click without filling — should show validation errors
    (preview_btn.element() as HTMLElement).click();

    await expect
      .element(screen.getByText("Select a nonprofit"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Enter a valid amount"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Enter a reference ID"))
      .toBeInTheDocument();
  });

  it("create settlement → preview → confirm → item appears in table", async () => {
    // 1. start on list — empty
    const screen = await render_app();
    await expect
      .element(screen.getByText("No settlements yet"))
      .toBeInTheDocument();

    // 2. click "+ New" to open create dialog
    const new_link = screen.getByRole("link", { name: /new/i });
    (new_link.element() as HTMLElement).click();

    // 3. fill form and go to preview
    await fill_form_and_preview(screen, {
      donor_name: "Doug Mendenhall",
      net: "250",
      reference: "Fidelity deposit #789",
    });

    // 4. verify preview shows records
    await expect
      .element(screen.getByText("Freegan Food Foundation"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Doug Mendenhall"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Fidelity deposit #789"))
      .toBeInTheDocument();
    // grant row
    await expect.element(screen.getByText("Grant")).toBeInTheDocument();

    // 5. confirm
    const confirm_btn = screen.getByRole("button", { name: /confirm/i });
    (confirm_btn.element() as HTMLElement).click();

    // 6. success
    await expect
      .element(screen.getByText("Settlement created"), { timeout: 10_000 })
      .toBeInTheDocument();

    // 7. close dialog → list reloads with the new settlement
    const close_btn = screen.getByRole("button", { name: /close/i });
    (close_btn.element() as HTMLElement).click();

    // 8. verify the row appears in the table
    await expect
      .element(screen.getByText("Doug Mendenhall"), { timeout: 5000 })
      .toBeVisible();
    await expect
      .element(screen.getByText("Freegan Food Foundation"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Fidelity deposit #789"))
      .toBeVisible();
  });

  it("settles a DAF donation → listed with method 'DAF'", async () => {
    const screen = await render_app();

    (
      screen.getByRole("link", { name: /new/i }).element() as HTMLElement
    ).click();

    // pick DAF as the source
    await fill_form_and_preview(screen, {
      from: "daf",
      donor_name: "Wanda Whitfield",
      net: "400",
      reference: "DAF grant #555",
    });

    // confirm
    (
      screen.getByRole("button", { name: /confirm/i }).element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("Settlement created"), { timeout: 10_000 })
      .toBeInTheDocument();

    (
      screen.getByRole("button", { name: /close/i }).element() as HTMLElement
    ).click();

    // row appears with the generic "DAF" method label
    await expect
      .element(screen.getByText("Wanda Whitfield"), { timeout: 5000 })
      .toBeVisible();
    await expect
      .element(screen.getByRole("cell", { name: "DAF", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("DAF grant #555")).toBeVisible();
  });

  it("settles a stock gift → listed with method 'Stocks'", async () => {
    const screen = await render_app();

    (
      screen.getByRole("link", { name: /new/i }).element() as HTMLElement
    ).click();

    await fill_form_and_preview(screen, {
      from: "stocks",
      donor_name: "Stella Stockwell",
      net: "1250",
      reference: "10 AAPL via Schwab",
    });

    (
      screen.getByRole("button", { name: /confirm/i }).element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("Settlement created"), { timeout: 10_000 })
      .toBeInTheDocument();

    (
      screen.getByRole("button", { name: /close/i }).element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("Stella Stockwell"), { timeout: 5000 })
      .toBeVisible();
    await expect
      .element(screen.getByRole("cell", { name: "Stocks", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("10 AAPL via Schwab")).toBeVisible();
  });

  // the field only exists for a match, and only reaches the action if the
  // confirm step carries it — the two places this wiring can silently drop it
  it("settles an employer match against a donor's gift", async () => {
    const screen = await render_app();

    (
      screen.getByRole("link", { name: /new/i }).element() as HTMLElement
    ).click();

    // hidden until the source is an employer's payment
    await expect
      .element(screen.getByPlaceholder("e.g. 7c3f9a2e-..."))
      .not.toBeInTheDocument();

    await fill_form_and_preview(screen, {
      from: "match",
      // the action ignores this for an attached match — the payer's name comes
      // off the gift's employer — but the shared schema still wants it non-empty
      donor_name: "Northwind Traders",
      net: "200",
      reference: "Northwind cheque #4412",
      for_donation_id: GIFT_ID,
    });

    (
      screen.getByRole("button", { name: /confirm/i }).element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("Settlement created"), { timeout: 10_000 })
      .toBeInTheDocument();

    // the arrival is stamped on the donor's gift, pointing at the employer's row
    const [evt] = await test_db
      .current!.db.select()
      .from(donation_match_events);
    expect(evt!.donation_id).toBe(GIFT_ID);
    expect(evt!.matched_at).not.toBeNull();

    // and the donor hears about it — at their address, not the employer's
    expect(send_email).toHaveBeenCalledTimes(1);
    expect(send_email.mock.calls[0]![0].to).toEqual(["ada@test.com"]);
  });

  // regression: selecting an npo option must populate the combobox input
  // (the post-selection input-value-change must not trigger a refetch that
  // clears state). the input value is asserted, not just the submit.
  it("selecting an option populates the combobox input", async () => {
    const screen = await render_app();

    (
      screen.getByRole("link", { name: /new/i }).element() as HTMLElement
    ).click();

    const combo = screen.getByPlaceholder("Search for an organization...");
    await expect.element(combo, { timeout: 3000 }).toBeVisible();
    await combo.fill("Freegan");

    const opt = screen.getByRole("option", {
      name: "Freegan Food Foundation",
    });
    await expect.element(opt, { timeout: 3000 }).toBeVisible();
    // playwright pointer click (not native DOM .click) — the option is
    // portaled outside the dialog, so the inert overlay doesn't intercept,
    // and the real pointer path is what triggers ark's
    // onInputValueChange(reason: "item-select") flow under test.
    await opt.click();

    // user-visible outcome: input now shows the selected nonprofit's name
    await expect
      .element(combo, { timeout: 3000 })
      .toHaveValue("Freegan Food Foundation");

    await screen.getByPlaceholder("0.00").fill("100");
    await screen
      .getByPlaceholder("e.g. Fidelity deposit #123")
      .fill("ref-regression");

    // and survives the post-selection debounce — the two fills above outlast
    // the window a refetch would have fired in
    await expect.element(combo).toHaveValue("Freegan Food Foundation");

    (
      screen.getByRole("button", { name: /preview/i }).element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("Confirm settlement"), { timeout: 5000 })
      .toBeInTheDocument();
  });
});
