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
import { render } from "vitest-browser-react";
import { dists } from "$/pg/schema/dist";
import { donations } from "$/pg/schema/donation";
import { forms } from "$/pg/schema/form";
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

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);

vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return {
    dataWithSuccess: vi.fn((d: unknown, msg: string) => ({
      ...(d as any),
      toast: msg,
    })),
    redirectWithSuccess: vi.fn((url: string, _msg: string) => redirect(url)),
  };
});

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

// --- imports (after mocks hoisted) ---

import { admin_ctx } from "$/auth/test-utils";
import { create_test_db } from "$/pg/test-utils/pglite";
import DisablePrompt, {
  action as disableAction,
} from "../../admin.$id.forms.$form_id.disable/route";
import { loader } from "../api";
import FormsPage from "../route";

// --- setup ---

let counter = 0;

const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-TEST",
  name: "Test NPO",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
};

async function seed_npo(
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) {
  counter++;
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({
      ...NPO_SEED,
      registration_number: `EIN-${counter}`,
      ...overrides,
    })
    .returning();
  return row;
}

async function seed_form(
  owner_npo_id: number,
  overrides: Partial<typeof forms.$inferInsert> = {}
) {
  counter++;
  const id = overrides.id ?? `form-${counter}`;
  await test_db.current!.db.insert(forms).values({
    id,
    owner_npo_id,
    status: "active",
    name: `Test Form ${counter}`,
    tag: `tag-${counter}`,
    recipient_npo_id: owner_npo_id,
    recipient_fund_id: null,
    date_created: new Date().toISOString(),
    ltd: 0,
    ltd_count: 0,
    ...overrides,
  });
  return id;
}

/** one parent gift on the form, with no dists */
async function seed_gift(form_id: string, status: "confirmed" | "settled") {
  counter++;
  const donation_id = `don-${counter}`;
  await test_db.current!.db.insert(donations).values({
    id: donation_id,
    upusd: 1,
    status,
    amount_base: 100,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
    form_id,
  });
  return donation_id;
}

/** one parent gift on the form, settled as one dist per recipient */
async function seed_settled_gift(form_id: string, to_ids: number[]) {
  const donation_id = await seed_gift(form_id, "settled");
  await test_db.current!.db.insert(dists).values(
    to_ids.map((to_id) => ({
      id: `${donation_id}-${to_id}`,
      donation_id,
      status: "settled" as const,
      date_created: new Date().toISOString(),
      to_id,
      amount_denom: "USD",
    }))
  );
}

/** text of the Donations column in the row whose link reads `label` */
function donations_cell(table: HTMLElement, label: string) {
  const heads = [...table.querySelectorAll("thead th")];
  const col = heads.findIndex((th) => th.textContent === "Donations");
  const row = [...table.querySelectorAll("tbody tr")].find(
    (r) => r.querySelector("a")?.textContent === label
  );
  return row?.querySelectorAll("td")[col]?.textContent;
}

async function render_page(npo_id: number, status?: string) {
  const qs = status ? `?status=${status}` : "";
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/forms",
      Component: FormsPage,
      HydrateFallback: () => null,
      loader: loader as any,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
      children: [
        { path: "create", Component: () => null },
        {
          path: ":form_id/disable",
          Component: DisablePrompt,
          action: disableAction as any,
        },
      ],
    },
  ]);

  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/forms${qs}`]}
      future={{ v8_middleware: true }}
    />
  );
}

// --- lifecycle ---

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(dists);
  await test_db.current!.db.delete(donations);
  await test_db.current!.db.delete(forms);
  await test_db.current!.db.delete(npos);
  counter = 0;
});

// --- tests ---

describe("admin views donation forms", () => {
  it("renders all forms in a table", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { tag: "main" });
    await seed_form(npo.id, { tag: "stocks" });
    await seed_form(npo.id, { tag: "crypto", status: "inactive" });

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("main")).toBeVisible();
    await expect.element(screen.getByText("stocks")).toBeInTheDocument();
    await expect.element(screen.getByText("crypto")).toBeInTheDocument();

    // table exists
    await expect.element(screen.getByRole("table")).toBeInTheDocument();

    await expect
      .element(screen.getByRole("link", { name: "Create Form" }))
      .toBeInTheDocument();
  });

  it("orders by date_created desc", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, {
      tag: "oldest",
      date_created: "2026-01-01T00:00:00Z",
    });
    await seed_form(npo.id, {
      tag: "newest",
      date_created: "2026-03-01T00:00:00Z",
    });
    await seed_form(npo.id, {
      tag: "middle",
      date_created: "2026-02-01T00:00:00Z",
    });

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("newest")).toBeVisible();

    // form links appear in date desc order
    const rows = screen.getByRole("row");
    await vi.waitFor(() => {
      // row 0 is thead, rows 1-3 are data
      const texts = rows
        .elements()
        .slice(1)
        .map((r) => r.querySelector("a")?.textContent);
      expect(texts).toEqual(["newest", "middle", "oldest"]);
    });
  });

  it("shows tag and program info in table row", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, {
      tag: "summer-2026",
      program_id: "prog-1",
      program_name: "Youth Initiative",
    });

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("summer-2026")).toBeVisible();
    await expect
      .element(screen.getByText("Youth Initiative"))
      .toBeInTheDocument();
  });

  it("falls back to form name when tag is empty", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { name: "Gala 2026", tag: "" });

    const screen = await render_page(npo.id);

    await expect
      .element(screen.getByRole("link", { name: "Gala 2026" }))
      .toBeVisible();
  });
});

describe("admin reads a form's donation count", () => {
  it("counts one fund gift settled to five members as one donation", async () => {
    const npo = await seed_npo();
    const members = await Promise.all(
      Array.from({ length: 5 }, () => seed_npo())
    );
    // the stored counter takes one bump per member's settlement
    const form_id = await seed_form(npo.id, { tag: "fund-form", ltd_count: 5 });
    await seed_settled_gift(
      form_id,
      members.map((m) => m.id)
    );

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("fund-form")).toBeVisible();
    const table = screen.getByRole("table").element() as HTMLElement;
    expect(donations_cell(table, "fund-form")).toBe("1");
  });

  it("does not count a confirmed gift that has no settled dist yet", async () => {
    const npo = await seed_npo();
    const form_id = await seed_form(npo.id, { tag: "pending-form" });
    await seed_gift(form_id, "confirmed");

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("pending-form")).toBeVisible();
    const table = screen.getByRole("table").element() as HTMLElement;
    expect(donations_cell(table, "pending-form")).toBe("0");
  });
});

describe("admin filters forms", () => {
  it("shows only active forms when status=active", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { tag: "active-form" });
    await seed_form(npo.id, { tag: "inactive-form", status: "inactive" });

    const screen = await render_page(npo.id, "active");

    await expect.element(screen.getByText("active-form")).toBeVisible();
    await expect
      .element(screen.getByText("inactive-form"))
      .not.toBeInTheDocument();
  });

  it("shows only inactive forms when status=inactive", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { tag: "enabled-form" });
    await seed_form(npo.id, { tag: "disabled-form", status: "inactive" });

    const screen = await render_page(npo.id, "inactive");

    await expect.element(screen.getByText("disabled-form")).toBeVisible();
    await expect
      .element(screen.getByText("enabled-form"))
      .not.toBeInTheDocument();
  });

  it("shows empty row when no forms match filter", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { tag: "only-active" });

    const screen = await render_page(npo.id, "inactive");

    // the empty state is a row of the table card, under the filter header
    await expect.element(screen.getByRole("table")).toBeInTheDocument();
    await expect
      .element(screen.getByText(/no.*inactive.*forms found/i))
      .toBeVisible();
    await expect.element(screen.getByText("Try another status.")).toBeVisible();
  });

  it("filters via StatusFilter dropdown — pick Inactive updates list", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { tag: "is-active" });
    await seed_form(npo.id, { tag: "is-inactive", status: "inactive" });

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("is-active")).toBeVisible();
    await expect.element(screen.getByText("is-inactive")).toBeInTheDocument();

    // open StatusFilter (single combobox on the page) and pick Inactive
    await screen.getByRole("combobox").click();
    await screen.getByRole("option", { name: "Inactive" }).click();

    await expect.element(screen.getByText("is-inactive")).toBeVisible();
    await expect.element(screen.getByText("is-active")).not.toBeInTheDocument();
  });

  it("shows empty table when no forms exist", async () => {
    const npo = await seed_npo();
    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("Donation forms")).toBeVisible();
    // the empty state is a row of the table card, under the filter header
    await expect.element(screen.getByRole("table")).toBeInTheDocument();
    await expect.element(screen.getByText(/no.*forms found/i)).toBeVisible();
    await expect
      .element(screen.getByText("Forms you create will show up here."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Create Form" }))
      .toBeInTheDocument();
  });
});

describe("admin disables a form", () => {
  it("opens confirmation dialog and deactivates on Proceed", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { tag: "gala-2026" });

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("gala-2026")).toBeVisible();

    // navigate to disable modal route
    await screen.getByRole("link", { name: "Disable" }).click();
    await expect
      .element(screen.getByText(/are you sure you want to disable/i))
      .toBeVisible();

    // confirm — native click bypasses the dialog overlay
    (
      screen.getByRole("button", { name: "Proceed" }).element() as HTMLElement
    ).click();

    // action redirects to parent → auto-revalidation removes disable link
    await expect
      .element(screen.getByRole("link", { name: "Disable" }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("gala-2026")).toBeInTheDocument();
  });

  it("closes dialog without submitting on Escape", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { tag: "esc-dismiss" });

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("esc-dismiss")).toBeVisible();
    await screen.getByRole("link", { name: "Disable" }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();

    // dispatch Escape on the dialog element; ark listens via Content keydown
    const dialog = screen.getByRole("dialog").element() as HTMLElement;
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );

    await expect
      .element(screen.getByRole("link", { name: "Disable" }))
      .toBeInTheDocument();
  });

  it("closes dialog without submitting on Cancel", async () => {
    const npo = await seed_npo();
    await seed_form(npo.id, { tag: "keep-active" });

    const screen = await render_page(npo.id);

    await expect.element(screen.getByText("keep-active")).toBeVisible();
    await screen.getByRole("link", { name: "Disable" }).click();
    await expect
      .element(screen.getByText(/are you sure you want to disable/i))
      .toBeVisible();

    // cancel navigates back to parent — native click bypasses the dialog overlay
    (
      screen.getByRole("link", { name: "Cancel" }).element() as HTMLElement
    ).click();

    // form still visible with disable link
    await expect.element(screen.getByText("keep-active")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Disable" }))
      .toBeInTheDocument();
  });
});
