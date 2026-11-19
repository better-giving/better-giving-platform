import { eq } from "drizzle-orm";
import { createRoutesStub, useLocation } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { registrations } from "$/pg/schema/registration";
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

vi.mock("#/errors/report", async (orig) => ({
  ...(await orig<typeof import("#/errors/report")>()),
  report_error: vi.fn(),
}));

// --- imports (after mocks hoisted) ---

import { report_error } from "#/errors/report";

import { create_test_db } from "$/pg/test-utils/pglite";
import { loader } from "../api";
import Applications from "../route";

// --- setup ---

const now = new Date();

function days_ago(n: number) {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

const SEEDS: (typeof registrations.$inferInsert)[] = [
  {
    id: "reg-incomplete",
    r_id: "user-1",
    status: "01",
    o_name: "Incomplete Org",
    o_hq_country: "United States",
    // only contact step filled
    r_first_name: "John",
    r_last_name: "Doe",
    r_org_role: "ceo",
    rm: "internet",
    created_at: days_ago(5),
    updated_at: days_ago(5),
  },
  {
    id: "reg-pending",
    r_id: "user-2",
    status: "02",
    o_name: "Pending Org",
    o_hq_country: "Canada",
    created_at: days_ago(3),
    updated_at: days_ago(3),
  },
  {
    id: "reg-approved",
    r_id: "user-3",
    status: "03",
    o_name: "Approved Org",
    o_hq_country: "United Kingdom",
    created_at: days_ago(1),
    updated_at: days_ago(1),
  },
  {
    id: "reg-rejected",
    r_id: "user-4",
    status: "04",
    o_name: "Rejected Org",
    o_hq_country: "Australia",
    created_at: days_ago(2),
    updated_at: days_ago(2),
  },
];

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(registrations);
  for (const seed of SEEDS) {
    await test_db.current!.db.insert(registrations).values(seed);
  }
});

// --- helpers ---

async function render_applications(search = "") {
  const Stub = createRoutesStub([
    {
      path: "/platform/applications",
      Component: Applications,
      HydrateFallback: () => null,
      loader,
    },
  ]);

  return await render(
    <Stub initialEntries={[`/platform/applications${search}`]} />
  );
}

// --- tests ---

describe("applications — default view", () => {
  it("shows every status, newest first, when there is no status param", async () => {
    const screen = await render_applications();

    for (const name of [
      "Pending Org",
      "Approved Org",
      "Rejected Org",
      "Incomplete Org",
    ]) {
      await expect.element(screen.getByText(name)).toBeInTheDocument();
    }
    const order = [
      ...screen.container.querySelectorAll("tbody tr td:first-child"),
    ]
      .map((td) => td.textContent)
      .filter(Boolean);
    // updated: approved 1d, rejected 2d, pending 3d, incomplete 5d
    expect(order).toEqual([
      "Approved Org",
      "Rejected Org",
      "Pending Org",
      "Incomplete Org",
    ]);
  });

  it("names the date column Last updated", async () => {
    const screen = await render_applications();

    await expect
      .element(screen.getByRole("button", { name: "Last updated" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Date submitted"))
      .not.toBeInTheDocument();
  });

  it("the status select reads All statuses", async () => {
    const screen = await render_applications();

    await screen.getByRole("button", { name: /^filter$/i }).click();

    await expect.element(screen.getByText("All statuses")).toBeVisible();
  });
});

describe("applications — reset", () => {
  it("Reset filters returns to every status", async () => {
    const screen = await render_applications("?status=03");
    await expect.element(screen.getByText("Approved Org")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Pending Org"))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: /^filter$/i }).click();
    await screen.getByRole("button", { name: /reset filters/i }).click();

    await expect.element(screen.getByText("Pending Org")).toBeInTheDocument();
    await expect.element(screen.getByText("Approved Org")).toBeInTheDocument();
    await expect.element(screen.getByText("Rejected Org")).toBeInTheDocument();
  });
});

describe("applications — reset clears the search", () => {
  it("Reset filters empties the search box too", async () => {
    const screen = await render_applications("?query=Pending");
    const search_input = screen.getByPlaceholder(/search applications/i);
    await expect.element(search_input).toHaveValue("Pending");

    await screen.getByRole("button", { name: /^filter$/i }).click();
    await screen.getByRole("button", { name: /reset filters/i }).click();

    await expect
      .element(screen.getByPlaceholder(/search applications/i))
      .toHaveValue("");
    await expect.element(screen.getByText("Approved Org")).toBeInTheDocument();
  });
});

describe("applications — search box focus", () => {
  it("keeps focus after a search, so the next keystrokes land in it", async () => {
    const screen = await render_applications();
    const search_input = screen.getByPlaceholder(/search applications/i);

    await search_input.click();
    await userEvent.keyboard("Zebra{Enter}");

    await expect
      .element(screen.getByText("Pending Org"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByPlaceholder(/search applications/i))
      .toHaveFocus();
    await expect
      .element(screen.getByPlaceholder(/search applications/i))
      .toHaveValue("Zebra");
  });
});

describe("applications — empty states", () => {
  it("says No applications yet when nothing is filtered and the list is empty", async () => {
    await test_db.current!.db.delete(registrations);

    const screen = await render_applications();

    await expect
      .element(screen.getByText("No applications yet"))
      .toBeInTheDocument();
  });

  it("says No applications found when a filter or search leaves nothing", async () => {
    await test_db
      .current!.db.delete(registrations)
      .where(eq(registrations.status, "04"));

    const screen = await render_applications("?status=04");

    await expect
      .element(screen.getByText("No applications found"))
      .toBeInTheDocument();
  });
});

describe("applications — view more", () => {
  const seed_approved = (n: number) =>
    test_db.current!.db.insert(registrations).values(
      Array.from({ length: n }, (_, i) => ({
        id: `reg-many-${String(i).padStart(2, "0")}`,
        r_id: `user-many-${i}`,
        status: "03" as const,
        o_name: `Many Org ${String(i).padStart(2, "0")}`,
        o_hq_country: "Kenya",
        created_at: days_ago(10),
        updated_at: days_ago(10),
      }))
    );

  it("a status-sorted second page repeats no row of the first", async () => {
    await seed_approved(20);

    const screen = await render_applications("?sort_key=status&sort_dir=asc");
    await screen.getByRole("button", { name: /view more/i }).click();

    await expect.element(screen.getByText("Many Org 19")).toBeInTheDocument();
    await expect.element(screen.getByText("Many Org 00")).toBeInTheDocument();
    const names = [
      ...screen.container.querySelectorAll("tbody tr td:first-child"),
    ]
      .map((td) => td.textContent)
      .filter(Boolean);
    expect(new Set(names).size).toBe(names.length);
  });

  it("a filter change that serves the same first page still drops the loaded pages", async () => {
    await seed_approved(20);
    const screen = await render_applications("?status=03");
    await screen.getByRole("button", { name: /view more/i }).click();
    // newest first, ties by id: the last page holds the lowest ids
    await expect.element(screen.getByText("Many Org 00")).toBeInTheDocument();

    // every row matches "Many Org", so page 1 is identical to the one before
    const search_input = screen.getByPlaceholder(/search applications/i);
    await search_input.fill("Many Org");
    await userEvent.keyboard("{Enter}");

    await expect
      .element(screen.getByText("Many Org 00"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Many Org 19")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /view more/i }))
      .toBeVisible();
  });

  it("a filter change after View more leaves no row from the earlier filter", async () => {
    await seed_approved(20);

    await test_db.current!.db.insert(registrations).values({
      id: "reg-zebra",
      r_id: "user-zebra",
      status: "03",
      o_name: "Zebra Foundation",
      o_hq_country: "Kenya",
      created_at: days_ago(30),
      updated_at: days_ago(30),
    });
    const screen = await render_applications("?status=03");
    await screen.getByRole("button", { name: /view more/i }).click();
    await expect.element(screen.getByText("Many Org 00")).toBeInTheDocument();

    // a search that matches none of the loaded rows
    const search_input = screen.getByPlaceholder(/search applications/i);
    await search_input.fill("Zebra");
    await userEvent.keyboard("{Enter}");

    await expect
      .element(screen.getByText("Zebra Foundation"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Many Org 00"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Many Org 19"))
      .not.toBeInTheDocument();
  });
});

describe("applications — status filter", () => {
  it("filters to approved when status=03", async () => {
    const screen = await render_applications("?status=03");

    await expect.element(screen.getByText("Approved Org")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Pending Org"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Rejected Org"))
      .not.toBeInTheDocument();
  });

  it("shows incomplete registrations with progress and links to /register", async () => {
    const screen = await render_applications("?status=01");

    await expect
      .element(screen.getByText("Incomplete Org"))
      .toBeInTheDocument();
    // progress bar rendered — contact step done, others pending
    const step_dots = screen.getByTitle("Step 2 of 5");
    await expect.element(step_dots).toBeInTheDocument();
    await expect
      .element(screen.getByTitle("Contact: done"))
      .toBeInTheDocument();
    await expect.element(screen.getByTitle("Org: pending")).toBeInTheDocument();

    // details link points to registration flow, not platform review
    const link = screen.getByRole("link", { name: /application details/i });
    await expect
      .element(link)
      .toHaveAttribute("href", "/register/reg-incomplete");
  });

  it("does not show progress for non-incomplete statuses", async () => {
    const screen = await render_applications("?status=02");

    await expect.element(screen.getByText("Pending Org")).toBeInTheDocument();
    await expect
      .element(screen.getByTitle(/Step \d+ of 5/))
      .not.toBeInTheDocument();
  });
});

describe("applications — sort", () => {
  it("renders rows in loader-provided order (name desc)", async () => {
    await test_db.current!.db.insert(registrations).values({
      id: "reg-pending-2",
      r_id: "user-5",
      status: "02",
      o_name: "Alpha Org",
      o_hq_country: "France",
      created_at: days_ago(1),
      updated_at: days_ago(1),
    });

    // sort_key=o_name&sort_dir=desc → loader returns Pending before Alpha
    const screen = await render_applications(
      "?status=02&sort_key=o_name&sort_dir=desc"
    );

    const pending = screen.getByText("Pending Org");
    await expect.element(pending).toBeVisible();
    const alpha = screen.getByText("Alpha Org");
    expect(
      pending.element().compareDocumentPosition(alpha.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders rows in loader-provided order (name asc)", async () => {
    await test_db.current!.db.insert(registrations).values({
      id: "reg-pending-2",
      r_id: "user-5",
      status: "02",
      o_name: "Alpha Org",
      o_hq_country: "France",
      created_at: days_ago(1),
      updated_at: days_ago(1),
    });

    // sort_key=o_name&sort_dir=asc → Alpha before Pending
    const screen = await render_applications(
      "?status=02&sort_key=o_name&sort_dir=asc"
    );

    const alpha = screen.getByText("Alpha Org");
    await expect.element(alpha).toBeVisible();
    const pending = screen.getByText("Pending Org");
    expect(
      alpha.element().compareDocumentPosition(pending.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("applications — date range filter", () => {
  it("DateRangeField narrows table to matching applications", async () => {
    // seed two extra status=02 rows so 3 are in scope: -365d, -180d, -3d (SEEDS)
    await test_db.current!.db.insert(registrations).values([
      {
        id: "reg-pending-old",
        r_id: "user-old",
        status: "02",
        o_name: "Old Org",
        o_hq_country: "Brazil",
        created_at: days_ago(365),
        updated_at: days_ago(365),
      },
      {
        id: "reg-pending-mid",
        r_id: "user-mid",
        status: "02",
        o_name: "Mid Org",
        o_hq_country: "Japan",
        created_at: days_ago(180),
        updated_at: days_ago(180),
      },
    ]);

    const screen = await render_applications();

    await expect.element(screen.getByText("Pending Org")).toBeInTheDocument();
    await expect.element(screen.getByText("Mid Org")).toBeInTheDocument();
    await expect.element(screen.getByText("Old Org")).toBeInTheDocument();

    await screen.getByRole("button", { name: /^filter$/i }).click();
    await expect
      .element(screen.getByRole("button", { name: /apply filters/i }))
      .toBeVisible();

    // window [now-240d, now-120d] — only Mid Org (180d) matches
    const start = new Date(now);
    start.setDate(start.getDate() - 240);
    const end = new Date(now);
    end.setDate(end.getDate() - 120);
    // user clicks the month segment of each date and types digits;
    // Ark auto-advances day → year as each segment fills
    const months = screen.getByLabelText(/month/i);
    const type_date = async (d: Date) => {
      await userEvent.keyboard(String(d.getMonth() + 1).padStart(2, "0"));
      await userEvent.keyboard(String(d.getDate()).padStart(2, "0"));
      await userEvent.keyboard(String(d.getFullYear()));
    };
    await months.first().click();
    await type_date(start);
    await months.nth(1).click();
    await type_date(end);

    await screen.getByRole("button", { name: /apply filters/i }).click();

    await expect.element(screen.getByText("Mid Org")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Pending Org"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Old Org")).not.toBeInTheDocument();
  });
});

describe("applications — search", () => {
  it("filters by org name when user submits search", async () => {
    await test_db.current!.db.insert(registrations).values({
      id: "reg-pending-2",
      r_id: "user-5",
      status: "02",
      o_name: "Zebra Foundation",
      o_hq_country: "France",
      created_at: days_ago(1),
      updated_at: days_ago(1),
    });

    const screen = await render_applications("?status=02");

    await expect.element(screen.getByText("Pending Org")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Zebra Foundation"))
      .toBeInTheDocument();

    const search_input = screen.getByPlaceholder(/search applications/i);
    await search_input.clear();
    await search_input.fill("Zebra");
    await userEvent.keyboard("{Enter}");

    await expect
      .element(screen.getByText("Pending Org"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Zebra Foundation"))
      .toBeInTheDocument();
  });

  it("filters by registration id", async () => {
    const screen = await render_applications("?status=02");

    await expect.element(screen.getByText("Pending Org")).toBeInTheDocument();

    const search_input = screen.getByPlaceholder(/search applications/i);
    await search_input.fill("reg-pending");
    await userEvent.keyboard("{Enter}");

    await expect.element(screen.getByText("Pending Org")).toBeInTheDocument();
  });

  it("is case-insensitive", async () => {
    const screen = await render_applications("?status=02");

    await expect.element(screen.getByText("Pending Org")).toBeInTheDocument();

    const search_input = screen.getByPlaceholder(/search applications/i);
    await search_input.fill("PENDING");
    await userEvent.keyboard("{Enter}");

    await expect.element(screen.getByText("Pending Org")).toBeInTheDocument();
  });
});

describe("applications — the view travels to an application", () => {
  it("the details link carries filters, search and sort", async () => {
    const view = "?status=02&query=Pending&sort_key=o_name&sort_dir=asc";
    const Stub = createRoutesStub([
      {
        path: "/platform/applications",
        Component: Applications,
        HydrateFallback: () => null,
        loader,
      },
      {
        path: "/platform/applications/:id",
        Component: () => (
          <p data-testid="detail-search">{useLocation().search}</p>
        ),
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/platform/applications${view}`]} />
    );

    await screen
      .getByRole("link", { name: "application details" })
      .first()
      .click();

    await expect
      .element(screen.getByTestId("detail-search"))
      .toHaveTextContent(view);
  });
});

describe("applications — Under review", () => {
  it("names status 02 Under review in the table, never Pending", async () => {
    const screen = await render_applications();

    await expect
      .element(screen.getByText("Under review", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Pending", { exact: true }).query()).toBeNull();
  });
});

describe("applications — reset keeps the sort", () => {
  it("Reset filters clears filters and search but the sort stays", async () => {
    const screen = await render_applications(
      "?status=03&query=Org&sort_key=o_name&sort_dir=asc"
    );
    await expect.element(screen.getByText("Approved Org")).toBeInTheDocument();

    await screen.getByRole("button", { name: /^filter$/i }).click();
    await screen.getByRole("button", { name: /reset filters/i }).click();

    await expect.element(screen.getByText("Rejected Org")).toBeInTheDocument();
    await expect
      .element(screen.getByPlaceholder(/search applications/i))
      .toHaveValue("");
    // by name, ascending; the default order would put Rejected before Pending
    const order = [
      ...screen.container.querySelectorAll("tbody tr td:first-child"),
    ].map((td) => td.textContent);
    expect(order).toEqual([
      "Approved Org",
      "Incomplete Org",
      "Pending Org",
      "Rejected Org",
    ]);
  });
});

describe("applications — the filter popover closes", () => {
  const apply = () => /apply filters/i;

  it("on Apply", async () => {
    const screen = await render_applications();
    await screen.getByRole("button", { name: /^filter$/i }).click();
    await expect
      .element(screen.getByRole("button", { name: apply() }))
      .toBeVisible();

    await screen.getByRole("button", { name: apply() }).click();

    await expect
      .element(screen.getByRole("button", { name: apply() }))
      .not.toBeVisible();
  });

  it("on Reset", async () => {
    const screen = await render_applications("?status=03");
    await screen.getByRole("button", { name: /^filter$/i }).click();

    await screen.getByRole("button", { name: /reset filters/i }).click();

    await expect
      .element(screen.getByRole("button", { name: apply() }))
      .not.toBeVisible();
  });
});

describe("applications — a failed View more", () => {
  it("keeps the rows, drops the button, reports, and a new search starts fresh", async () => {
    await test_db.current!.db.insert(registrations).values(
      Array.from({ length: 20 }, (_, i) => ({
        id: `reg-fail-${String(i).padStart(2, "0")}`,
        r_id: `user-fail-${i}`,
        status: "03" as const,
        o_name: `Fail Org ${String(i).padStart(2, "0")}`,
        o_hq_country: "Kenya",
        created_at: days_ago(10),
        updated_at: days_ago(10),
      }))
    );
    const screen = await render_applications("?status=03");
    const more = screen.getByRole("button", { name: /view more/i });
    await expect.element(more).toBeVisible();

    const boom = new Error("neon unreachable");
    const select = vi
      .spyOn(test_db.current!.db, "select")
      .mockImplementationOnce(() => {
        throw boom;
      });
    await more.click();

    await expect
      .element(screen.getByRole("button", { name: /view more/i }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Fail Org 19")).toBeInTheDocument();
    expect(report_error).toHaveBeenCalledWith(boom, expect.anything());
    expect(screen.getByText(/couldn.t load|try again/i).query()).toBeNull();
    select.mockRestore();

    // a new search starts fresh, with the button back
    const search_input = screen.getByPlaceholder(/search applications/i);
    await search_input.fill("Fail Org");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("button", { name: /view more/i }))
      .toBeVisible();
  });
});
