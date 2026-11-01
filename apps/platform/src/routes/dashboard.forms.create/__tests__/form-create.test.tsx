import { HttpResponse, http } from "msw";
import { createRoutesStub, href, Outlet } from "react-router";
import { createFormData } from "remix-hook-form";
import { parse } from "valibot";
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
import { doc_args } from "#/__tests__/fixtures/route-args";
import { search } from "@/helpers/https";
import { npos_search } from "@/npo/schema";
import { user } from "$/pg/schema/auth";
import { forms } from "$/pg/schema/form";
import { npos } from "$/pg/schema/npo";
import { programs } from "$/pg/schema/program";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- hoisted refs ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

// --- mocks ---

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
  (await import("$/auth/test-utils")).make_auth_mock({
    session: { user: { id: "user-1", role: "user" } },
  })
);

vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return {
    redirectWithSuccess: vi.fn((url: string, _msg: string) => redirect(url)),
    dataWithError: vi.fn((_d: unknown, msg: string) => ({ error: msg })),
  };
});

// --- imports (after mocks) ---

import { get_npos } from "#/.server/npos";
import Page from "#/pages/shared/form-create";
import { action, loader } from "#/pages/shared/form-create/api";
import { mswWorker } from "#/setup-tests-browser";
import { create_test_db } from "$/pg/test-utils/pglite";

// --- helpers ---

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

async function seed_program(npo_id: number, title: string) {
  counter++;
  const id = crypto.randomUUID();
  await test_db.current!.db.insert(programs).values({
    id,
    npo_id,
    title,
    description_pt: "{}",
    created_at: new Date().toISOString(),
  });
  return id;
}

async function render_page(search = "") {
  const Stub = createRoutesStub([
    {
      path: "/dashboard/forms",
      Component: () => <Outlet />,
      children: [
        {
          path: "create",
          Component: Page,
          loader: loader as any,
        },
        // action redirect target
        {
          path: ":id/edit",
          Component: () => <div data-testid="edit-page" />,
        },
      ],
    },
  ]);

  return await render(
    <Stub initialEntries={[`/dashboard/forms/create${search}`]} />
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
  await test_db.current!.db.delete(forms);
  await test_db.current!.db.delete(programs);
  await test_db.current!.db.delete(npos);
  counter = 0;

  // createRoutesStub serves route modules only, so the combobox's raw fetch to
  // /api/npos needs the same pglite the loader reads.
  mswWorker.use(
    http.get(href("/api/npos"), async ({ request }) =>
      HttpResponse.json(
        await get_npos(parse(npos_search, search(new URL(request.url))))
      )
    )
  );
});

// --- tests ---

describe("user creates donation form", () => {
  it("renders form with npo selector, tag input, and submit", async () => {
    await seed_npo({ name: "Save the Whales" });

    const screen = await render_page();

    await expect
      .element(screen.getByRole("combobox", { name: /nonprofit/i }))
      .toBeVisible();
    await expect
      .element(screen.getByPlaceholder(/e\.g\. in mywebsite/i))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeVisible();
  });

  it("shows npo options on click without searching", async () => {
    await seed_npo({ name: "Save the Whales" });
    await seed_npo({ name: "Plant a Tree" });

    const screen = await render_page();

    // dialog overlay intercepts playwright clicks; dispatch directly
    const combo = screen
      .getByRole("combobox", { name: /nonprofit/i })
      .element() as HTMLInputElement;
    combo.focus();
    combo.click();

    await expect
      .element(screen.getByRole("option", { name: "Save the Whales" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("option", { name: "Plant a Tree" }))
      .toBeVisible();
  });

  it("shows program selector when npo has programs", async () => {
    const npo = await seed_npo({ name: "Org with Programs" });
    await seed_program(npo.id, "Youth Initiative");

    const screen = await render_page(`?npo_id=${npo.id}`);

    await expect.element(screen.getByText(/select program/i)).toBeVisible();
  });

  it("program options are visible and selectable inside the dialog", async () => {
    const npo = await seed_npo({ name: "Org with Programs" });
    await seed_program(npo.id, "Youth Initiative");

    const screen = await render_page(`?npo_id=${npo.id}`);

    // dialog overlay intercepts playwright clicks; dispatch directly
    const trigger = screen
      .getByRole("combobox", { name: /select program/i })
      .element() as HTMLButtonElement;
    trigger.focus();
    trigger.click();

    const opt = screen.getByRole("option", { name: "Youth Initiative" });
    // popup must mount inside the dialog — portaled to body it is aria-hidden
    // by the dialog and painted under its backdrop
    await expect.element(opt).toBeVisible();
    await opt.click();

    await expect
      .element(screen.getByRole("combobox", { name: /select program/i }))
      .toMatchTextContent("Youth Initiative");
  });

  it("hides program selector when npo has no programs", async () => {
    await seed_npo({ name: "Org without Programs" });

    const screen = await render_page();

    const prog = screen.getByText(/select program/i).query();
    expect(prog).toBeNull();
  });
});

describe("form-create action attaches a program only the recipient owns", () => {
  async function create_form(recipient_id: number, program: string) {
    await test_db
      .current!.db.insert(user)
      .values({
        id: "user-1",
        name: "User",
        email: "user-1@example.com",
        first_name: "Us",
        last_name: "Er",
      })
      .onConflictDoNothing();
    const request = new Request(
      `https://x/dashboard/forms/create?npo_id=${recipient_id}`,
      { method: "POST", body: createFormData({ tag: "site", program }) }
    );
    await action({ ...doc_args(request), params: {} } as any);
    const rows = await test_db.current!.db.select().from(forms);
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  it("creates the form without another npo's program", async () => {
    const recipient = await seed_npo({ name: "Recipient" });
    const other = await seed_npo({ name: "Other" });
    const foreign = await seed_program(other.id, "Other's Program");

    const row = await create_form(recipient.id, foreign);

    expect(row.recipient_npo_id).toBe(recipient.id);
    expect(row.program_id).toBeNull();
    expect(row.program_name).toBeNull();
  });

  it("keeps the recipient's own program", async () => {
    const recipient = await seed_npo({ name: "Recipient" });
    const own = await seed_program(recipient.id, "Own Program");

    const row = await create_form(recipient.id, own);

    expect(row.program_id).toBe(own);
    expect(row.program_name).toBe("Own Program");
  });
});

describe("form-create action without a nonprofit", () => {
  // the selector's `required` doesn't block the submit and the schema carries
  // no nonprofit, so a donor reaches this by pressing Submit
  it("asks for a nonprofit and creates nothing", async () => {
    const request = new Request("https://x/dashboard/forms/create", {
      method: "POST",
      body: createFormData({ tag: "site", program: "" }),
    });

    const res = await action({ ...doc_args(request), params: {} } as any);

    expect(res).toEqual({ error: "Select a nonprofit" });
    expect(await test_db.current!.db.select().from(forms)).toHaveLength(0);
  });
});
