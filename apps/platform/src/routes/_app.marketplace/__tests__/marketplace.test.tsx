import {
  createRoutesStub,
  Outlet,
  useLocation,
  useNavigate,
  useNavigation,
} from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { seed_contribution } from "#/__tests__/fixtures/contributions";
import { npo, org_figures } from "#/__tests__/fixtures/org-layout";
import { dists } from "$/pg/schema/dist";
import { donations } from "$/pg/schema/donation";
import { npos } from "$/pg/schema/npo";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks (hoisted) ---

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

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

// --- imports (after mocks hoisted) ---

import { reset_viewport } from "#/__tests__/fixtures/viewport";
import FilterPage from "#/routes/_app.marketplace.filter/route";
import { create_test_db } from "$/pg/test-utils/pglite";
import MarketplacePage, { loader } from "../route";
import { gate, keystroke } from "./helpers";

// --- setup ---

const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "REG001",
  name: "Test Charity",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
  tagline: "Helping the world",
  image: "https://example.com/banner.jpg",
  logo: "https://example.com/logo.jpg",
  card_img: "https://example.com/card.jpg",
  active_in_countries: [],
  published: true,
  active: true,
  street_address: "123 Main St",
  url: "https://example.org",
};

beforeAll(async () => {
  test_db.current = await create_test_db();
  // stub pg_trgm similarity() — pglite doesn't have the extension
  await test_db.current!.client.exec(
    "CREATE OR REPLACE FUNCTION similarity(a text, b text) " +
      "RETURNS float4 AS $fn$ " +
      "BEGIN " +
      "IF a IS NULL OR b IS NULL THEN RETURN 0; END IF; " +
      "IF LOWER(a) LIKE '%' || LOWER(b) || '%' THEN RETURN 0.5; END IF; " +
      "RETURN 0; " +
      "END; " +
      "$fn$ LANGUAGE plpgsql IMMUTABLE;"
  );
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

afterEach(() => {
  vi.useRealTimers();
});

let counter = 0;
beforeEach(async () => {
  await cleanup();
  counter = 0;
  // seeded gifts reference their npo
  await test_db.current!.db.delete(dists);
  await test_db.current!.db.delete(donations);
  await test_db.current!.db.delete(npos);
});

// --- helpers ---

async function seed_npo(
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) {
  counter++;
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({
      ...NPO_SEED,
      registration_number: `REG${counter.toString().padStart(3, "0")}`,
      name: `Test Org ${counter}`,
      ...overrides,
    })
    .returning();
  return row;
}

/** the stub's memory router has no address bar, so the url a user would
 *  share is read off the location instead. `nav-state` shows a navigation
 *  still loading, which is when a debounced write can race it. */
function UrlProbe() {
  const { search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="url-search">{search}</output>
      <output data-testid="nav-state">{useNavigation().state}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
      <Outlet />
    </>
  );
}

function render_marketplace(
  entry: string | string[] = "/marketplace",
  route_loader: typeof loader = loader,
  /** stand in for the latency of routes whose module or data isn't loaded yet */
  wait: {
    filter?: (url: URL) => Promise<void>;
    org?: (url: URL) => Promise<void>;
  } = {}
) {
  const Stub = createRoutesStub([
    {
      Component: UrlProbe,
      children: [
        {
          path: "/marketplace",
          Component: MarketplacePage,
          HydrateFallback: () => null,
          loader: route_loader,
          children: [
            {
              path: "filter",
              Component: FilterPage,
              loader: async ({ request }) => {
                await wait.filter?.(new URL(request.url));
                return null;
              },
            },
          ],
        },
        { path: "/other", Component: () => <p>other page</p> },
        {
          path: "/org/:org",
          Component: () => <p>org page</p>,
          loader: async ({ request }) => {
            await wait.org?.(new URL(request.url));
            return null;
          },
        },
      ],
    },
  ]);
  return render(
    <Stub initialEntries={Array.isArray(entry) ? entry : [entry]} />
  );
}

// --- tests ---

describe("marketplace — basic listing", () => {
  it("renders published NPOs with names and taglines", async () => {
    await seed_npo({ name: "Org Alpha", tagline: "Alpha tagline" });
    await seed_npo({ name: "Org Beta", tagline: "Beta tagline" });
    const screen = await render_marketplace();

    await expect.element(screen.getByText("Org Alpha")).toBeInTheDocument();
    await expect.element(screen.getByText("Org Beta")).toBeInTheDocument();
    await expect.element(screen.getByText("Alpha tagline")).toBeInTheDocument();
    await expect.element(screen.getByText("Beta tagline")).toBeInTheDocument();
  });
});

describe("marketplace — card rows", () => {
  afterEach(reset_viewport);

  it("cards in a row keep their Donate rows aligned whatever the tagline's length, and nothing follows the tagline", async () => {
    await page.viewport(1440, 900);
    const SHORT = "Clean water.";
    const LONG =
      "Clean water for every village school in the district, drilled, piped and kept running by people who live there.";
    await seed_npo({ name: "Org Short", tagline: SHORT });
    await seed_npo({ name: "Org Long", tagline: LONG });
    const screen = await render_marketplace();

    const short = screen.getByText(SHORT, { exact: true });
    const long = screen.getByText(LONG, { exact: true });
    await expect.element(short).toBeVisible();
    await expect.element(long).toBeVisible();
    const [a, b] = screen
      .getByRole("link", { name: "Donate", exact: true })
      .elements()
      .map((el) => el.getBoundingClientRect());
    expect(a.top).toBe(b.top);
    expect(a.bottom).toBe(b.bottom);

    // the body ends at the longer tagline's own margin plus the body's inset
    const tagline = long.element() as HTMLElement;
    const body = tagline.parentElement as HTMLElement;
    const after =
      body.getBoundingClientRect().bottom -
      tagline.getBoundingClientRect().bottom;
    expect(after).toBeCloseTo(
      Number.parseFloat(getComputedStyle(tagline).marginBottom) +
        Number.parseFloat(getComputedStyle(body).paddingBottom),
      0
    );
  });
});

describe("marketplace — card figures", () => {
  it("shows an org's name and tagline but not its stored goal or raised total", async () => {
    const org = await seed_npo({
      name: "Target Org",
      tagline: "Has a stored target",
      target_number: 8000,
    });
    await seed_contribution(test_db.current!.db, org.id, 3322);
    const screen = await render_marketplace();

    await expect.element(screen.getByText("Target Org")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Has a stored target"))
      .toBeInTheDocument();
    expect(
      org_figures(
        screen.container,
        npo({ contributions_total: 3322, contributions_count: 1 })
      )
    ).toEqual([]);
    expect(screen.container).not.toMatchTextContent(/8,000| of \$/);
  });
});

describe("marketplace — visibility", () => {
  it("only shows published NPOs", async () => {
    await seed_npo({ name: "Visible Org" });
    await seed_npo({ name: "Unpublished Org", published: false });
    const screen = await render_marketplace();

    await expect.element(screen.getByText("Visible Org")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Unpublished Org"))
      .not.toBeInTheDocument();
  });
});

describe("marketplace — designation filter", () => {
  it("filters by clicking designation in filter dialog", async () => {
    await seed_npo({ name: "My Charity", endow_designation: "Charity" });
    await seed_npo({ name: "My University", endow_designation: "University" });
    const screen = await render_marketplace();

    // both visible initially
    await expect.element(screen.getByText("My Charity")).toBeInTheDocument();
    await expect.element(screen.getByText("My University")).toBeInTheDocument();

    // open filter dialog
    await screen.getByRole("link", { name: /filters/i }).click();

    // click "Charity" toggle in filter dialog
    await expect
      .element(screen.getByRole("button", { name: "Charity", pressed: false }))
      .toBeVisible();
    // the dialog overlay intercepts pointer events; use native DOM click
    (
      screen
        .getByRole("button", { name: "Charity", pressed: false })
        .element() as HTMLElement
    ).click();

    // university filtered out
    await expect
      .element(screen.getByText("My University"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("My Charity")).toBeInTheDocument();
  });
});

describe("marketplace — country filter", () => {
  it("filters by selecting country in filter dialog", async () => {
    await seed_npo({ name: "US Org", hq_country: "United States" });
    await seed_npo({ name: "CA Org", hq_country: "Canada" });
    const screen = await render_marketplace();

    // both visible initially
    await expect.element(screen.getByText("US Org")).toBeInTheDocument();
    await expect.element(screen.getByText("CA Org")).toBeInTheDocument();

    // apply country filter via URL (combobox inside the dialog is not
    // pointer-accessible due to inert overlay in test environment)
    await cleanup();
    const filtered = await render_marketplace("/marketplace?countries=Canada");

    // US org filtered out
    await expect.element(filtered.getByText("US Org")).not.toBeInTheDocument();
    await expect.element(filtered.getByText("CA Org")).toBeInTheDocument();
  });

  it("matches active_in_countries", async () => {
    await seed_npo({
      name: "US HQ Active CA",
      hq_country: "United States",
      active_in_countries: ["Canada"],
    });
    const screen = await render_marketplace();

    await expect
      .element(screen.getByText("US HQ Active CA"))
      .toBeInTheDocument();

    // apply country filter via URL (combobox inside the dialog is not
    // pointer-accessible due to inert overlay in test environment)
    await cleanup();
    const filtered = await render_marketplace("/marketplace?countries=Canada");

    // org with active_in_countries still visible
    await expect
      .element(filtered.getByText("US HQ Active CA"))
      .toBeInTheDocument();
  });
});

describe("marketplace — KYC filter", () => {
  it("filters by clicking KYC toggle in filter dialog", async () => {
    await seed_npo({ name: "KYC Org", kyc_donors_only: true });
    await seed_npo({ name: "No KYC Org", kyc_donors_only: false });
    const screen = await render_marketplace();

    await expect
      .element(screen.getByText("KYC Org", { exact: true }))
      .toBeInTheDocument();
    await expect.element(screen.getByText("No KYC Org")).toBeInTheDocument();

    // open filter dialog, click "Required"
    await screen.getByRole("link", { name: /filters/i }).click();
    await expect
      .element(
        screen.getByRole("button", {
          name: "Required",
          pressed: false,
          exact: true,
        })
      )
      .toBeVisible();
    (
      screen
        .getByRole("button", { name: "Required", pressed: false, exact: true })
        .element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("No KYC Org"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("KYC Org", { exact: true }))
      .toBeInTheDocument();
  });
});

describe("marketplace — SDG filter", () => {
  it("filters by clicking category in filter dialog", async () => {
    await seed_npo({ name: "SDG 1 Org", sdgs: [1, 2, 3] });
    await seed_npo({ name: "SDG 4 Org", sdgs: [4] });
    const screen = await render_marketplace();

    await expect.element(screen.getByText("SDG 1 Org")).toBeInTheDocument();
    await expect.element(screen.getByText("SDG 4 Org")).toBeInTheDocument();

    await screen.getByRole("link", { name: /filters/i }).click();
    await expect
      .element(
        screen.getByRole("button", {
          name: /reducing overall inequality/i,
          pressed: false,
        })
      )
      .toBeVisible();
    (
      screen
        .getByRole("button", {
          name: /reducing overall inequality/i,
          pressed: false,
        })
        .element() as HTMLElement
    ).click();

    await expect.element(screen.getByText("SDG 4 Org")).not.toBeInTheDocument();
    await expect.element(screen.getByText("SDG 1 Org")).toBeInTheDocument();
  });
});

describe("marketplace — empty state", () => {
  it("shows empty message when filter matches nothing", async () => {
    await seed_npo({ endow_designation: "Charity" });
    const screen = await render_marketplace();

    await expect.element(screen.getByText("Test Org 1")).toBeInTheDocument();

    // open filter, click University (no matches)
    await screen.getByRole("link", { name: /filters/i }).click();
    await expect
      .element(
        screen.getByRole("button", {
          name: "University",
          pressed: false,
        })
      )
      .toBeVisible();
    (
      screen
        .getByRole("button", {
          name: "University",
          pressed: false,
        })
        .element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("No organisations found"))
      .toBeInTheDocument();
  });
});

describe("marketplace — pagination", () => {
  it("shows 'Load more' when more than 20 results", async () => {
    await Promise.all(
      Array.from({ length: 21 }, (_, i) => seed_npo({ name: `Org ${i + 1}` }))
    );
    const screen = await render_marketplace();

    await expect
      .element(screen.getByText("Org 1", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /load more organizations/i }))
      .toBeInTheDocument();
  });

  it("does not show 'Load more' when results fit one page", async () => {
    for (let i = 0; i < 5; i++) await seed_npo({ name: `Small Org ${i}` });
    const screen = await render_marketplace();

    await expect.element(screen.getByText("Small Org 0")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /load more organizations/i }))
      .not.toBeInTheDocument();
  });
});

describe("marketplace — combined filters", () => {
  it("combines designation + KYC with AND logic via filter dialog", async () => {
    await seed_npo({
      name: "Charity KYC",
      endow_designation: "Charity",
      kyc_donors_only: true,
    });
    await seed_npo({
      name: "Charity No KYC",
      endow_designation: "Charity",
      kyc_donors_only: false,
    });
    await seed_npo({
      name: "University KYC",
      endow_designation: "University",
      kyc_donors_only: true,
    });
    const screen = await render_marketplace();

    await expect.element(screen.getByText("Charity KYC")).toBeInTheDocument();

    // open filter, select Charity + Required
    await screen.getByRole("link", { name: /filters/i }).click();
    await expect
      .element(screen.getByRole("button", { name: "Charity", pressed: false }))
      .toBeVisible();
    (
      screen
        .getByRole("button", { name: "Charity", pressed: false })
        .element() as HTMLElement
    ).click();
    // wait for Charity filter to apply before clicking Required
    await expect
      .element(screen.getByRole("button", { name: "Charity", pressed: true }))
      .toBeVisible();
    (
      screen
        .getByRole("button", { name: "Required", pressed: false, exact: true })
        .element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("Charity No KYC"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("University KYC"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Charity KYC")).toBeInTheDocument();
  });
});

describe("marketplace — search", () => {
  it("typing a term filters the grid and puts the term in the url", async () => {
    await seed_npo({
      name: "Oxfam International",
      tagline: "Fighting poverty",
    });
    await seed_npo({ name: "Red Cross", tagline: "Humanitarian aid" });
    const screen = await render_marketplace();

    // both visible initially
    await expect
      .element(screen.getByText("Oxfam International"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Red Cross")).toBeInTheDocument();

    await screen.getByPlaceholder("Search organizations...").fill("Oxfam");

    await expect
      .element(screen.getByTestId("url-search"))
      .toMatchTextContent("query=Oxfam");
    await expect.element(screen.getByText("Red Cross")).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Oxfam International"))
      .toBeInTheDocument();
  });

  // the next page is built from the url; a term held anywhere else pages
  // through the unfiltered set under a filtered first page
  it("loading more after a search appends only matches", async () => {
    for (let i = 1; i <= 21; i++) await seed_npo({ name: `Match Org ${i}` });
    // sorted by name, so the unfiltered first page is all non-matches
    for (let i = 1; i <= 25; i++) await seed_npo({ name: `Alpha Org ${i}` });
    const screen = await render_marketplace();
    const matches = () => screen.getByText(/^Match Org \d+$/).elements();

    await screen.getByPlaceholder("Search organizations...").fill("Match");
    await expect
      .element(screen.getByText(/^Alpha Org/).first())
      .not.toBeInTheDocument();

    await screen
      .getByRole("button", { name: /load more organizations/i })
      .click();

    await vi.waitFor(() => expect(matches()).toHaveLength(21));
    await expect
      .element(screen.getByRole("button", { name: /load more organizations/i }))
      .not.toBeInTheDocument();
    expect(screen.getByText(/^Alpha Org/).elements()).toHaveLength(0);
  });

  // a page asked for under the old term is thrown away when the new one lands
  it("Load more holds while a search loads", async () => {
    for (let i = 1; i <= 21; i++) await seed_npo({ name: `Match Org ${i}` });
    const g = gate((url) => url.searchParams.has("query"));
    const screen = await render_marketplace("/marketplace", async (args) => {
      await g.wait(new URL(args.request.url));
      return loader(args);
    });
    const more = screen.getByRole("button", {
      name: /load more organizations/i,
    });
    await expect.element(more).toBeEnabled();

    await screen.getByPlaceholder("Search organizations...").fill("Match");
    await vi.waitFor(() => expect(g.held.count).toBe(1));

    await expect.element(more).toBeDisabled();
    g.release();
    await expect
      .element(screen.getByTestId("url-search"))
      .toHaveTextContent("?query=Match");
    await expect.element(more).toBeEnabled();
  });

  it("removing a filter chip keeps the term in the box and the results", async () => {
    await seed_npo({ name: "Oxfam Canada", hq_country: "Canada" });
    await seed_npo({ name: "Red Cross Canada", hq_country: "Canada" });
    await seed_npo({ name: "Oxfam Kenya", hq_country: "Kenya" });
    const screen = await render_marketplace(
      "/marketplace?countries=Canada,Kenya"
    );
    const box = screen.getByPlaceholder("Search organizations...");

    await box.fill("Oxfam");
    await expect
      .element(screen.getByText("Red Cross Canada"))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Kenya", exact: true }).click();

    await expect
      .element(screen.getByText("Oxfam Kenya"))
      .not.toBeInTheDocument();
    expect(screen.getByText("Red Cross Canada").query()).toBeNull();
    await expect.element(screen.getByText("Oxfam Canada")).toBeVisible();
    await expect.element(box).toHaveValue("Oxfam");
  });

  it("Clear all after a search empties the box and unfilters the grid", async () => {
    await seed_npo({ name: "Oxfam Canada", hq_country: "Canada" });
    await seed_npo({ name: "Red Cross Canada", hq_country: "Canada" });
    await seed_npo({ name: "Unicef Japan", hq_country: "Japan" });
    const screen = await render_marketplace(
      "/marketplace?countries=Canada,Kenya"
    );
    const box = screen.getByPlaceholder("Search organizations...");

    await box.fill("Oxfam");
    await expect
      .element(screen.getByText("Red Cross Canada"))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Clear all" }).click();

    await expect.element(screen.getByText("Unicef Japan")).toBeVisible();
    await expect.element(screen.getByText("Red Cross Canada")).toBeVisible();
    await expect.element(box).toHaveValue("");
    await expect
      .element(screen.getByTestId("url-search"))
      .not.toMatchTextContent("query");
  });

  // a writer that drops a term the url carried meant to; the box follows it
  // rather than writing the term back over it
  it("the dialog's Clear Filters empties the box with the url", async () => {
    await seed_npo({ name: "Oxfam Canada", hq_country: "Canada" });
    await seed_npo({ name: "Red Cross Canada", hq_country: "Canada" });
    const screen = await render_marketplace(
      "/marketplace?query=Oxfam&countries=Canada"
    );
    const box = screen.getByPlaceholder("Search organizations...");
    await expect.element(box).toHaveValue("Oxfam");

    await screen.getByRole("link", { name: /filters/i }).click();
    await expect
      .element(screen.getByRole("button", { name: "Clear Filters" }))
      .toBeVisible();
    // the dialog overlay intercepts pointer events; use native DOM click
    (
      screen
        .getByRole("button", { name: "Clear Filters" })
        .element() as HTMLElement
    ).click();

    await expect.element(screen.getByText("Red Cross Canada")).toBeVisible();
    await expect.element(box).toHaveValue("");
    await expect
      .element(screen.getByTestId("url-search"))
      .not.toMatchTextContent("query");
  });

  // the box's write is a navigation and cuts off whichever one is loading;
  // a removed chip whose loader outlasts the debounce window would come back
  it("a keystroke whose debounce fires while a chip removal loads keeps both", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await seed_npo({ name: "Oxfam Canada", hq_country: "Canada" });
    await seed_npo({ name: "Red Cross Canada", hq_country: "Canada" });
    await seed_npo({ name: "Oxfam Kenya", hq_country: "Kenya" });
    const g = gate((url) => url.search === "?countries=Canada");
    const screen = await render_marketplace(
      "/marketplace?countries=Canada,Kenya",
      async (args) => {
        await g.wait(new URL(args.request.url));
        return loader(args);
      }
    );
    const box = screen.getByPlaceholder("Search organizations...");
    await expect.element(screen.getByText("Oxfam Kenya")).toBeVisible();

    keystroke(box.element() as HTMLInputElement, "Oxfam");
    await screen.getByRole("button", { name: "Kenya", exact: true }).click();
    await expect
      .element(screen.getByTestId("nav-state"))
      .toHaveTextContent("loading");
    await vi.advanceTimersByTimeAsync(700);
    g.release();

    await expect
      .element(screen.getByTestId("url-search"))
      .toHaveTextContent("?countries=Canada&query=Oxfam");
    await expect
      .element(screen.getByText("Red Cross Canada"))
      .not.toBeInTheDocument();
    expect(screen.getByText("Oxfam Kenya").query()).toBeNull();
    await expect.element(screen.getByText("Oxfam Canada")).toBeVisible();
    await expect.element(box).toHaveValue("Oxfam");
  });

  // the Filters link and a card are navigations too; a route whose module is
  // still downloading when the debounce fires would never open
  it("a keystroke whose debounce fires while the Filters link loads opens the dialog over the term, with no stop at the dialog behind it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await seed_npo({ name: "Oxfam Canada" });
    const g = gate(() => true);
    const screen = await render_marketplace(
      ["/other", "/marketplace"],
      loader,
      {
        filter: g.wait,
      }
    );
    const box = screen.getByPlaceholder("Search organizations...");
    await expect.element(screen.getByText("Oxfam Canada")).toBeVisible();

    keystroke(box.element() as HTMLInputElement, "Oxfam");
    await screen.getByRole("link", { name: /filters/i }).click();
    await expect
      .element(screen.getByTestId("nav-state"))
      .toHaveTextContent("loading");
    await vi.advanceTimersByTimeAsync(700);
    g.release();

    await expect
      .element(screen.getByRole("button", { name: "Charity", pressed: false }))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("url-search"))
      .toHaveTextContent("?query=Oxfam");
    await expect.element(box).toHaveValue("Oxfam");

    // writing the term repaired the Filters landing; it is not a stop of its
    // own for Back to reopen the dialog at
    (
      screen
        .getByRole("link", { name: "Close filters" })
        .element() as HTMLElement
    ).click();
    await expect
      .element(screen.getByRole("button", { name: "Charity" }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Back" }).click();
    await expect.element(screen.getByText("other page")).toBeVisible();
  });

  it("a keystroke whose debounce fires while a card's page loads lets the card open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await seed_npo({ name: "Oxfam Canada" });
    const g = gate(() => true);
    const screen = await render_marketplace("/marketplace", loader, {
      org: g.wait,
    });
    const box = screen.getByPlaceholder("Search organizations...");
    await expect.element(screen.getByText("Oxfam Canada")).toBeVisible();

    keystroke(box.element() as HTMLInputElement, "Oxfam");
    await screen.getByRole("link", { name: /oxfam canada/i }).click();
    await expect
      .element(screen.getByTestId("nav-state"))
      .toHaveTextContent("loading");
    await vi.advanceTimersByTimeAsync(700);
    g.release();

    await expect.element(screen.getByText("org page")).toBeVisible();
  });

  // a chip built from the committed url cuts off the search still loading,
  // and the url it lands never had the term. what the user typed survives it.
  it("a chip clicked while a search loads keeps the term in box, url and grid", async () => {
    await seed_npo({ name: "Oxfam Canada", hq_country: "Canada" });
    await seed_npo({ name: "Red Cross Canada", hq_country: "Canada" });
    await seed_npo({ name: "Oxfam Kenya", hq_country: "Kenya" });
    const g = gate((url) => url.searchParams.has("query"));
    const screen = await render_marketplace(
      "/marketplace?countries=Canada,Kenya",
      async (args) => {
        await g.wait(new URL(args.request.url));
        return loader(args);
      }
    );
    const box = screen.getByPlaceholder("Search organizations...");

    await box.fill("Oxfam");
    await vi.waitFor(() => expect(g.held.count).toBe(1));
    await screen.getByRole("button", { name: "Kenya", exact: true }).click();
    await expect
      .element(screen.getByText("Oxfam Kenya"))
      .not.toBeInTheDocument();
    g.release();

    await expect
      .element(screen.getByTestId("url-search"))
      .toHaveTextContent("?countries=Canada&query=Oxfam");
    await expect
      .element(screen.getByText("Red Cross Canada"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Oxfam Canada")).toBeVisible();
    await expect.element(box).toHaveValue("Oxfam");
  });
});
