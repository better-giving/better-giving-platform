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
import { doc_args } from "#/__tests__/fixtures/route-args";
import { get_qstash_events } from "#/setup-tests-browser";
import { banking_apps } from "$/pg/schema/banking";
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

vi.mock("$/kit/queue", () => {
  const qstash_url = import.meta.env.QSTASH_URL;
  const base_url = import.meta.env.BASE_URL_OVERRIDE || "http://localhost";
  return {
    receiver: {},
    client: {},
    enqueue: vi.fn(async (...msgs: { id: string; payload: any }[]) => {
      for (const m of msgs) {
        await fetch(
          `${qstash_url}/v2/publish/${base_url}/api/q-handler/${m.id}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(m.payload),
          }
        );
      }
    }),
    don_dist: vi.fn(),
    verify_qstash: vi.fn(),
  };
});

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

vi.mock("$/kit/wise", () => ({
  wise: { v2_account: vi.fn() },
}));

vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return {
    dataWithSuccess: vi.fn((_d: unknown, msg: string) => ({ toast: msg })),
    redirectWithSuccess: vi.fn((url: string, _msg: string) => redirect(url)),
  };
});

// --- imports (after mocks hoisted) ---

import {
  action,
  loader,
} from "#/pages/platform-admin/banking-applications/api";
import { loader as list_loader } from "#/routes/platform.banking-applications/api";
import DetailPage from "#/routes/platform.banking-applications_.$id/route";
import ApprovePage from "#/routes/platform.banking-applications_.$id.approve/route";
import RejectPage from "#/routes/platform.banking-applications_.$id.reject/route";
import { wise } from "$/kit/wise";
import { bapps_by_status } from "$/pg/queries/banking";
import { create_test_db } from "$/pg/test-utils/pglite";

// --- setup ---

/** the base64url pair the bapp cursor rides on */
const b64url = (x: string) =>
  btoa(x).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let counter = 0;

const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-TEST",
  name: "Test NPO",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
};

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(banking_apps);
  await test_db.current!.db.delete(npos);
  counter = 0;
  // wise answers by default; the outage cases override it once. the approve
  // action re-checks the account before writing, so it needs one too.
  vi.mocked(wise.v2_account).mockResolvedValue(WISE_FIXTURE as never);
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
      registration_number: `EIN-${counter}`,
      ...overrides,
    })
    .returning();
  return row;
}

async function seed_bapp(
  npo_id: number,
  overrides: Partial<typeof banking_apps.$inferInsert> = {}
) {
  counter++;
  const id = overrides.id ?? String(1000 + counter);
  await test_db.current!.db.insert(banking_apps).values({
    id,
    npo_id,
    status: "under-review",
    bank_summary: `USD account ending in ${String(counter).padStart(4, "0")}`,
    bank_statement_url: "https://example.com/stmt.pdf",
    rejection_reason: "",
    date_created: new Date().toISOString(),
    ...overrides,
  });
  return id;
}

async function get_bapp(id: string) {
  const [row] = await test_db
    .current!.db.select()
    .from(banking_apps)
    .where(eq(banking_apps.id, id));
  return row;
}

function get_outbox_events() {
  return get_qstash_events();
}

async function render_detail(bapp_id: string, ba: any) {
  const Stub = createRoutesStub([
    {
      path: "/platform/banking-applications/:id",
      Component: DetailPage,
      HydrateFallback: () => null,
      loader: () => ({ ...WISE_FIXTURE, ba }),
    },
  ]);
  return await render(
    <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
  );
}

const WISE_FIXTURE = {
  id: 12345,
  currency: "USD",
  country: "US",
  name: { fullName: "Jane Doe" },
  type: "checking",
  legalEntityType: "PERSON" as const,
  longAccountSummary: "USD account ending in 1234",
  displayFields: [
    { key: "routingNumber", label: "Routing number", value: "021000021" },
    { key: "accountNumber", label: "Account number", value: "****1234" },
  ],
};

// the real loader, so a wise failure is caught where it actually happens rather
// than simulated by a stub returning the degraded shape
async function render_detail_live(bapp_id: string) {
  const Stub = createRoutesStub([
    {
      path: "/platform/banking-applications/:id",
      Component: DetailPage,
      HydrateFallback: () => null,
      loader: loader as any,
    },
  ]);
  return await render(
    <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
  );
}

// --- tests ---

describe("wise outage", () => {
  it("keeps the page up when the account can't be read", async () => {
    vi.mocked(wise.v2_account).mockRejectedValueOnce("wise is down");
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id);

    const screen = await render_detail_live(bapp_id);

    await expect
      .element(screen.getByText(/couldn't be loaded from the payout provider/i))
      .toBeInTheDocument();
    // the application row is ours and survives
    await expect
      .element(screen.getByText(new RegExp(bapp_id)))
      .toBeInTheDocument();
  }, 30_000);

  it("still links the uploaded bank statement", async () => {
    vi.mocked(wise.v2_account).mockRejectedValueOnce("wise is down");
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id);

    const screen = await render_detail_live(bapp_id);

    await expect
      .element(screen.getByText("https://example.com/stmt.pdf"))
      .toBeInTheDocument();
  }, 30_000);

  it("blocks approve but not reject", async () => {
    vi.mocked(wise.v2_account).mockRejectedValueOnce("wise is down");
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id);

    const screen = await render_detail_live(bapp_id);

    // approving an account the reviewer cannot see is the defect this guards
    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .not.toHaveAttribute("aria-disabled", "true");
  }, 30_000);
});

describe("application detail", () => {
  it("renders bank details and action buttons", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id);
    const row = await get_bapp(bapp_id);

    const loader_data = { ...WISE_FIXTURE, ba: row };

    const Stub = createRoutesStub([
      {
        path: "/platform/banking-applications/:id",
        Component: DetailPage,
        HydrateFallback: () => null,
        loader: () => loader_data,
      },
    ]);

    const screen = await render(
      <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
    );

    await expect
      .element(screen.getByText("Banking application review"))
      .toBeVisible();

    await expect.element(screen.getByText("USD")).toBeInTheDocument();
    await expect
      .element(screen.getByText("US", { exact: true }))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Jane Doe")).toBeInTheDocument();

    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .not.toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .not.toHaveAttribute("aria-disabled", "true");
  });

  it("shows approved badge when already approved", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id, { status: "approved" });
    const row = await get_bapp(bapp_id);

    const Stub = createRoutesStub([
      {
        path: "/platform/banking-applications/:id",
        Component: DetailPage,
        HydrateFallback: () => null,
        loader: () => ({ ...WISE_FIXTURE, ba: row }),
      },
    ]);

    const screen = await render(
      <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
    );

    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeVisible();

    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("shows rejected badge and rejection reason", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id, {
      status: "rejected",
      rejection_reason: "Incomplete docs",
    });
    const row = await get_bapp(bapp_id);

    const Stub = createRoutesStub([
      {
        path: "/platform/banking-applications/:id",
        Component: DetailPage,
        HydrateFallback: () => null,
        loader: () => ({ ...WISE_FIXTURE, ba: row }),
      },
    ]);

    const screen = await render(
      <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
    );

    await expect
      .element(screen.getByText("Rejected", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Incomplete docs"))
      .toBeInTheDocument();
  });
});

describe("approve flow", () => {
  async function render_with_approve(bapp_id: string, ba: any) {
    const Stub = createRoutesStub([
      {
        path: "/platform/banking-applications/:id",
        Component: DetailPage,
        HydrateFallback: () => null,
        loader: () => ({ ...WISE_FIXTURE, ba }),
        action,
        children: [
          { path: "approve", Component: ApprovePage, action },
          {
            path: "success",
            Component: () => <div data-testid="success">OK</div>,
          },
        ],
      },
    ]);

    return await render(
      <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
    );
  }

  it("approves bapp — status becomes approved when npo already has a default", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id);
    await seed_bapp(npo.id, { status: "default" });
    const row = await get_bapp(bapp_id);

    const screen = await render_with_approve(bapp_id, row);

    await expect
      .element(screen.getByText("Banking application review"))
      .toBeVisible();
    await screen.getByRole("link", { name: /approve/i }).click();
    await expect
      .element(screen.getByText(/you are about to approve/i))
      .toBeVisible();
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();
    await expect.element(screen.getByTestId("success")).toBeVisible();

    // cross-page: re-render detail page — status badge visible
    await cleanup();
    const updated = await get_bapp(bapp_id);
    const screen2 = await render_detail(bapp_id, updated);
    await expect
      .element(screen2.getByText("Approved", { exact: true }))
      .toBeVisible();

    const events = await get_outbox_events();
    expect(events.some((e) => e.id === "banking-approved")).toBe(true);
  });

  it("auto-defaults when npo has only 1 bapp", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id);
    const row = await get_bapp(bapp_id);

    const screen = await render_with_approve(bapp_id, row);

    await expect
      .element(screen.getByText("Banking application review"))
      .toBeVisible();
    await screen.getByRole("link", { name: /approve/i }).click();
    await expect
      .element(screen.getByText(/you are about to approve/i))
      .toBeVisible();
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();
    await expect.element(screen.getByTestId("success")).toBeVisible();

    // the detail page renders "default" and "approved" identically, so only
    // the db distinguishes the auto-default
    const updated = await get_bapp(bapp_id);
    expect(updated.status).toBe("default");
  });

  it("defaults a bank filed after a rejected one", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { status: "rejected" });
    const bapp_id = await seed_bapp(npo.id);
    const row = await get_bapp(bapp_id);

    const screen = await render_with_approve(bapp_id, row);

    await screen.getByRole("link", { name: /approve/i }).click();
    await expect
      .element(screen.getByText(/you are about to approve/i))
      .toBeVisible();
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();
    await expect.element(screen.getByTestId("success")).toBeVisible();

    const updated = await get_bapp(bapp_id);
    expect(updated.status).toBe("default");
  });

  it("approve button disabled after verdict", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id, { status: "approved" });
    const row = await get_bapp(bapp_id);

    const Stub = createRoutesStub([
      {
        path: "/platform/banking-applications/:id",
        Component: DetailPage,
        HydrateFallback: () => null,
        loader: () => ({ ...WISE_FIXTURE, ba: row }),
      },
    ]);

    const screen = await render(
      <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
    );

    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
  });
});

describe("reject flow", () => {
  async function render_with_reject(bapp_id: string, ba: any) {
    const Stub = createRoutesStub([
      {
        path: "/platform/banking-applications/:id",
        Component: DetailPage,
        HydrateFallback: () => null,
        loader: () => ({ ...WISE_FIXTURE, ba }),
        action,
        children: [
          { path: "reject", Component: RejectPage, action },
          {
            path: "success",
            Component: () => <div data-testid="success">OK</div>,
          },
        ],
      },
    ]);

    return await render(
      <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
    );
  }

  it("rejects with reason", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id);
    const row = await get_bapp(bapp_id);

    const screen = await render_with_reject(bapp_id, row);

    await expect
      .element(screen.getByText("Banking application review"))
      .toBeVisible();
    await screen.getByRole("link", { name: /reject/i }).click();
    await expect
      .element(screen.getByLabelText(/reason for rejection/i))
      .toBeVisible();
    await screen
      .getByLabelText(/reason for rejection/i)
      .fill("Missing documentation");
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();
    await expect.element(screen.getByTestId("success")).toBeVisible();

    // cross-page: re-render detail page — rejected badge + reason visible
    await cleanup();
    const updated = await get_bapp(bapp_id);
    const screen2 = await render_detail(bapp_id, updated);
    await expect
      .element(screen2.getByText("Rejected", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen2.getByText("Missing documentation"))
      .toBeInTheDocument();

    const events = await get_outbox_events();
    expect(events.some((e) => e.id === "banking-rejected")).toBe(true);
  });

  it("reject without reason shows validation error", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id);
    const row = await get_bapp(bapp_id);

    const screen = await render_with_reject(bapp_id, row);

    await expect
      .element(screen.getByText("Banking application review"))
      .toBeVisible();
    await screen.getByRole("link", { name: /reject/i }).click();
    await expect
      .element(screen.getByLabelText(/reason for rejection/i))
      .toBeVisible();
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();
    await expect.element(screen.getByText(/required/i)).toBeVisible();
  });

  it("reject button disabled after verdict", async () => {
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id, { status: "rejected" });
    const row = await get_bapp(bapp_id);

    const Stub = createRoutesStub([
      {
        path: "/platform/banking-applications/:id",
        Component: DetailPage,
        HydrateFallback: () => null,
        loader: () => ({ ...WISE_FIXTURE, ba: row }),
      },
    ]);

    const screen = await render(
      <Stub initialEntries={[`/platform/banking-applications/${bapp_id}`]} />
    );

    await expect
      .element(screen.getByText("Rejected", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .toHaveAttribute("aria-disabled", "true");
  });
});

describe("action edge cases", () => {
  it("throws 404 for non-existent bapp", async () => {
    const form = new FormData();
    form.set("type", "approved");

    const thrown = await Promise.resolve(
      (action as (...args: unknown[]) => unknown)({
        params: { id: "99999" },
        ...doc_args(
          new Request("http://test/platform/banking-applications/99999", {
            method: "POST",
            body: form,
          })
        ),
        context: {},
      })
    ).then(
      () => undefined,
      (e: unknown) => e
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });
});

describe("list loader", () => {
  const list = (qs: string) =>
    (list_loader as (...a: any[]) => any)({
      ...doc_args(
        new Request(`http://test/platform/banking-applications${qs}`)
      ),
      params: {},
      context: {},
    });

  it("surfaces a default bapp under both All and Approved", async () => {
    // approving an npo's only application promotes it to "default" — a
    // verdict, not a review state, so it must not drop out of the list
    const npo = await seed_npo();
    const bapp_id = await seed_bapp(npo.id, { status: "default" });

    const all = await list("?status=");
    expect(all.items.map((x: any) => x.id)).toContain(bapp_id);

    const approved = await list("?status=approved");
    expect(approved.items.map((x: any) => x.id)).toContain(bapp_id);
  });

  it("names each row's org", async () => {
    const npo = await seed_npo({ name: "Harbor Lights Shelter" });
    await seed_bapp(npo.id);

    const page = await list("?status=under-review");
    expect(page.items[0].npo_name).toBe("Harbor Lights Shelter");
  });

  it("keeps default out of under-review and rejected", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { status: "default" });

    expect((await list("?status=under-review")).items).toHaveLength(0);
    expect((await list("?status=rejected")).items).toHaveLength(0);
  });

  it("orders by updated_at, so a verdict on an old submission lands first", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { status: "approved" });
    const old_id = await seed_bapp(npo.id, {
      date_created: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    });

    // submission date alone would bury it
    expect((await list("?status=")).items[0].id).not.toBe(old_id);

    const form = new FormData();
    form.set("type", "approved");
    await (action as (...a: any[]) => any)({
      params: { id: old_id },
      ...doc_args(
        new Request(`http://test/platform/banking-applications/${old_id}`, {
          method: "POST",
          body: form,
        })
      ),
      context: {},
    });

    const after = await list("?status=");
    expect(after.items[0].id).toBe(old_id);
    expect(after.items[0].updated_at).not.toBe(after.items[0].date_created);
  });

  it("narrows to one endowment via endowmentID", async () => {
    const a = await seed_npo();
    const b = await seed_npo();
    const mine = await seed_bapp(a.id, { status: "default" });
    await seed_bapp(b.id, { status: "default" });

    const page = await list(`?status=&endowmentID=${a.id}`);
    expect(page.items.map((x: any) => x.id)).toEqual([mine]);
  });

  it("rejects a malformed endowmentID", async () => {
    const thrown = await list("?status=&endowmentID=abc").catch(
      (e: unknown) => e
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(400);
  });

  it("pages through rows that share an updated_at", async () => {
    // bapp_set_default stamps two rows with one instant, and the backfill gave
    // every pre-existing row its submission time — a timestamp-only cursor
    // would drop whichever tied rows fell past the page edge
    const npo = await seed_npo();
    const tied = "2025-03-04T05:06:07.000Z";
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await seed_bapp(npo.id, {
          status: "default",
          date_created: tied,
          updated_at: tied,
        })
      );
    }

    const seen: string[] = [];
    let next: string | undefined;
    do {
      const page = await bapps_by_status(["default"], { limit: 2, next });
      seen.push(...page.items.map((x) => x.id));
      next = page.next;
    } while (next);

    expect(seen.sort()).toEqual(ids.sort());
  });

  it("keeps ties reachable through a cursor issued before the tie-breaker", async () => {
    // skew protection: old js paging into a new deploy sends a bare iso
    // cursor, which names the boundary instant but not which of its ties the
    // previous page already served. a strict `<` would drop the rest of them
    const npo = await seed_npo();
    const boundary = "2025-01-01T00:00:00.000Z";
    const tied = [
      await seed_bapp(npo.id, { status: "default", updated_at: boundary }),
      await seed_bapp(npo.id, { status: "default", updated_at: boundary }),
    ];
    const older = await seed_bapp(npo.id, {
      status: "default",
      updated_at: "2024-01-01T00:00:00.000Z",
    });

    const legacy = b64url(boundary);
    const page = await bapps_by_status(["default"], { next: legacy });

    expect(page.items.map((x) => x.id).sort()).toEqual([...tied, older].sort());
  });

  it("returns to the row comparison after one legacy page", async () => {
    // the duplicate window is one page wide: the cursor this response issues
    // carries an id, so nothing repeats twice
    const npo = await seed_npo();
    const boundary = "2025-01-01T00:00:00.000Z";
    for (let i = 0; i < 3; i++) {
      await seed_bapp(npo.id, { status: "default", updated_at: boundary });
    }

    const legacy = b64url(boundary);
    const first = await bapps_by_status(["default"], {
      limit: 2,
      next: legacy,
    });
    // the issued cursor names the last row served — instant *and* id — which
    // is what puts the next request back on the row comparison
    const last = first.items[1]!;
    expect(first.next).toBe(b64url(`${last.updated_at}|${last.id}`));

    const second = await bapps_by_status(["default"], {
      limit: 2,
      next: first.next,
    });
    const overlap = second.items.filter((x) =>
      first.items.some((y) => y.id === x.id)
    );
    expect(overlap).toEqual([]);
  });
});
