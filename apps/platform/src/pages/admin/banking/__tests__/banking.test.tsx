import { eq } from "drizzle-orm";
import { createRoutesStub, useFetcher } from "react-router";
import Stripe from "stripe";
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
import { payouts } from "$/pg/schema/payout";
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

// init passes through: a status >= 400 skips revalidation, and the delete flow asserts on that
vi.mock("#/.server/toast", async () => {
  const { data, redirect } = await import("react-router");
  return {
    dataWithSuccess: vi.fn((_d: unknown, msg: string, init?: ResponseInit) =>
      data({ toast: msg }, init)
    ),
    dataWithError: vi.fn((_d: unknown, msg: string, init?: ResponseInit) =>
      data({ error: msg }, init)
    ),
    redirectWithSuccess: vi.fn((url: string, _msg: string) => redirect(url)),
  };
});

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

// the readiness mirror's refresh calls stripe
const sync_npo_account = vi.hoisted(() => vi.fn());
vi.mock("$/stripe-connect/sync", () => ({ sync_npo_account }));

const routing = vi.hoisted(() => ({ on: true }));
vi.mock("$/env", async (importOriginal) => {
  const env = await importOriginal<typeof import("$/env")>();
  return {
    ...env,
    stripe: {
      ...env.stripe,
      get connect_routing() {
        return routing.on;
      },
    },
  };
});

const report_degraded = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", async (orig) => ({
  ...(await orig<typeof import("#/errors/report")>()),
  report_degraded,
}));

vi.mock("$/kit/wise", () => ({
  wise: { v2_account: vi.fn() },
}));

// --- imports (after mocks hoisted) ---

import {
  delete_action,
  delete_loader,
} from "#/pages/admin/banking/delete-action";
import { loader as list_loader } from "#/routes/admin.$id.banking._index/api";
import PayoutMethodsList from "#/routes/admin.$id.banking._index/route";
import {
  default_action,
  loader as detail_loader,
} from "#/routes/admin.$id.banking.$bank_id/api";
import PayoutMethodDetail from "#/routes/admin.$id.banking.$bank_id/route";
import DeletePrompt from "#/routes/admin.$id.banking.$bank_id.delete/route";
import { action as new_banking_action } from "#/routes/admin.$id.banking.new/api";
import { admin_ctx } from "$/auth/test-utils";
import { wise } from "$/kit/wise";
import { bapp_delete } from "$/pg/queries/banking";
import { create_test_db } from "$/pg/test-utils/pglite";

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

async function seed_bapp(
  npo_id: number,
  overrides: Partial<typeof banking_apps.$inferInsert> = {}
) {
  counter++;
  const id = overrides.id ?? `wise-${counter}`;
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

/** a Savings withdrawal waiting for a bank payout */
async function seed_held(npo_id: number, amount: number) {
  counter++;
  await test_db.current!.db.insert(payouts).values({
    id: `payout-${counter}`,
    source_id: `liq-${counter}`,
    npo_id,
    source: "liq",
    date: "2026-10-27T00:00:00.000Z",
    amount,
    type: "pending",
  });
}

function get_outbox_events() {
  return get_qstash_events();
}

// full route stub for multi-page flows (list → detail → delete)
async function render_banking_app(npo_id: number, initial_path: string) {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id",
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
      children: [
        {
          path: "banking",
          children: [
            {
              index: true,
              Component: PayoutMethodsList,
              HydrateFallback: () => null,
              loader: list_loader as any,
            },
            {
              path: ":bank_id",
              Component: PayoutMethodDetail,
              HydrateFallback: () => null,
              loader: detail_loader as any,
              action: default_action as any,
              children: [
                {
                  path: "delete",
                  Component: DeletePrompt,
                  HydrateFallback: () => null,
                  loader: delete_loader as any,
                  action: delete_action as any,
                },
              ],
            },
          ],
        },
      ],
    },
  ]);

  return await render(
    <Stub initialEntries={[initial_path]} future={{ v8_middleware: true }} />
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

// --- lifecycle ---

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(payouts);
  await test_db.current!.db.delete(banking_apps);
  await test_db.current!.db.delete(npos);
  counter = 0;
  sync_npo_account.mockReset();
  report_degraded.mockReset();
  routing.on = true;
});

async function render_list(npo_id: number, search = "") {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/banking",
      Component: PayoutMethodsList,
      HydrateFallback: () => null,
      loader: list_loader as any,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
    },
  ]);

  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/banking${search}`]}
      future={{ v8_middleware: true }}
    />
  );
}

// --- tests ---

describe("payout methods list", () => {
  it("renders table rows for seeded bapps", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, {
      status: "approved",
      bank_summary: "USD account ending in 1234",
    });
    await seed_bapp(npo.id, {
      status: "under-review",
      bank_summary: "EUR account ending in 5678",
    });

    const screen = await render_list(npo.id);

    await expect
      .element(screen.getByText("USD account ending in 1234"))
      .toBeVisible();
    await expect
      .element(screen.getByText("EUR account ending in 5678"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Under review", { exact: true }))
      .toBeInTheDocument();
  });

  it("clicks Details and navigates to detail page", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, {
      id: "100",
      status: "approved",
      bank_summary: "USD account ending in 1234",
    });
    vi.mocked(wise.v2_account).mockResolvedValue(WISE_FIXTURE as any);

    const screen = await render_banking_app(npo.id, `/admin/${npo.id}/banking`);

    await expect
      .element(screen.getByText("USD account ending in 1234"))
      .toBeVisible();
    await screen.getByRole("link", { name: /bank statement file/i }).click();

    // detail page loaded — wait for detail-unique text first
    await expect.element(screen.getByText("Jane Doe")).toBeVisible();
    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("USD", { exact: true }))
      .toBeInTheDocument();
    // the breadcrumb's last item is the page title, named by the record
    await expect
      .element(
        screen.getByRole("heading", {
          level: 1,
          name: "USD account ending in 1234",
        })
      )
      .toBeVisible();
  });

  it("shows empty state when no bapps", async () => {
    const npo = await seed_npo();
    const screen = await render_list(npo.id);

    const bank = screen.getByRole("region", { name: "Bank payout" });
    await expect
      .element(bank.getByText("No bank account yet", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        bank.getByText(
          "We send it to your bank account every 3 days once your balance reaches your payout minimum."
        )
      )
      .toBeVisible();
    // the heading already says it
    expect(screen.container.textContent).not.toContain("Bank payout:");
    expect(screen.container.textContent).not.toMatch(
      /\bwise\b|money-transfer/i
    );
    await expect
      .element(bank.getByRole("link", { name: "Add bank account" }))
      .toHaveAttribute("href", `/admin/${npo.id}/banking/new`);
  });
});

describe("new banking action", () => {
  const valid_payload = (npo_id: number) => ({
    wiseRecipientID: "999",
    endowmentID: npo_id,
    bankSummary: "USD account ending in 5678",
    bankStatementFile: {
      name: "stmt.pdf",
      publicUrl: "https://example.com/stmt.pdf",
    },
  });

  // stub component that submits json payload via fetcher (mirrors banking.tsx)
  function SubmitPage({ payload }: { payload: any }) {
    const fetcher = useFetcher();
    return (
      <>
        {fetcher.data && (
          <div data-testid="action-response">
            {typeof fetcher.data === "string"
              ? fetcher.data
              : JSON.stringify(fetcher.data)}
          </div>
        )}
        <button
          type="button"
          onClick={() =>
            fetcher.submit(payload, {
              action: ".",
              method: "POST",
              encType: "application/json",
            })
          }
        >
          Submit
        </button>
      </>
    );
  }

  async function render_new_banking(
    npo_id: number,
    payload: Record<string, unknown>
  ) {
    const Stub = createRoutesStub([
      {
        path: "/admin/:id",
        middleware: [
          async ({ context }, next) => {
            context.set(admin_ctx, npo_id);
            return next();
          },
        ],
        children: [
          {
            path: "banking",
            Component: () => <div data-testid="banking-list">List</div>,
          },
          {
            path: "banking/new",
            Component: () => <SubmitPage payload={payload} />,
            action: new_banking_action as any,
          },
        ],
      },
    ]);

    return await render(
      <Stub
        initialEntries={[`/admin/${npo_id}/banking/new`]}
        future={{ v8_middleware: true }}
      />
    );
  }

  it("valid payload creates bapp and emits event", async () => {
    const npo = await seed_npo();

    const screen = await render_new_banking(npo.id, valid_payload(npo.id));

    await screen.getByRole("button", { name: /submit/i }).click();

    // redirects to banking list on success
    await expect.element(screen.getByTestId("banking-list")).toBeVisible();

    // cross-page: render real banking list — new bapp with status visible
    await cleanup();
    const list = await render_list(npo.id);
    await expect
      .element(list.getByText("Under review", { exact: true }))
      .toBeInTheDocument();

    const events = await get_outbox_events();
    expect(events.some((e) => e.id === "banking-new")).toBe(true);
  });

  it("returns 400 for invalid payload", async () => {
    const npo = await seed_npo();

    const screen = await render_new_banking(npo.id, { endowmentID: npo.id });

    await screen.getByRole("button", { name: /submit/i }).click();

    // action returns 400 — stays on same page, no redirect
    await expect.element(screen.getByTestId("action-response")).toBeVisible();
    await expect
      .element(screen.getByTestId("banking-list"))
      .not.toBeInTheDocument();
  });

  it("rejects when npo has 10 bapps", async () => {
    const npo = await seed_npo();
    for (let i = 0; i < 10; i++) {
      await seed_bapp(npo.id);
    }

    const screen = await render_new_banking(npo.id, {
      ...valid_payload(npo.id),
      wiseRecipientID: "new-one",
    });

    await screen.getByRole("button", { name: /submit/i }).click();

    await expect.element(screen.getByTestId("action-response")).toBeVisible();
    await expect
      .element(screen.getByTestId("action-response"))
      .toMatchTextContent("Max 10");
    await expect
      .element(screen.getByTestId("banking-list"))
      .not.toBeInTheDocument();
  });
});

describe("payout method detail", () => {
  async function render_detail(ba: typeof banking_apps.$inferSelect) {
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/banking/:bank_id",
        Component: PayoutMethodDetail,
        HydrateFallback: () => null,
        loader: async () => ({ ...WISE_FIXTURE, ba }),
        children: [
          {
            path: "delete",
            Component: () => null,
          },
        ],
      },
    ]);

    return await render(
      <Stub initialEntries={[`/admin/${ba.npo_id}/banking/${ba.id}`]} />
    );
  }

  it("renders rejected badge and rejection reason", async () => {
    const npo = await seed_npo();
    const id = await seed_bapp(npo.id, {
      status: "rejected",
      rejection_reason: "Missing docs",
    });
    const row = await get_bapp(id);

    const screen = await render_detail(row!);

    await expect.element(screen.getByText("Rejected")).toBeVisible();
    await expect.element(screen.getByText("Missing docs")).toBeInTheDocument();
  });

  it("Set Default button disabled when default", async () => {
    const npo = await seed_npo();
    const id = await seed_bapp(npo.id, { status: "default" });
    const row = await get_bapp(id);

    const screen = await render_detail(row!);

    const btn = screen.getByRole("button", { name: /set default/i });
    await expect.element(btn).toBeDisabled();
  });

  it("Set Default button disabled when not approved", async () => {
    const npo = await seed_npo();
    const id = await seed_bapp(npo.id, { status: "under-review" });
    const row = await get_bapp(id);

    const screen = await render_detail(row!);

    const btn = screen.getByRole("button", { name: /set default/i });
    await expect.element(btn).toBeDisabled();
  });

  // through the real loader, so the catch is exercised where it lives
  it("keeps the page up when wise can't be reached", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { id: "200", status: "approved" });
    vi.mocked(wise.v2_account).mockRejectedValueOnce("wise is down");

    const screen = await render_banking_app(
      npo.id,
      `/admin/${npo.id}/banking/200`
    );

    await expect
      .element(screen.getByText(/couldn't be loaded right now/i))
      .toBeInTheDocument();
    // the uploaded statement is ours and outlives the outage
    await expect
      .element(screen.getByText("https://example.com/stmt.pdf"))
      .toBeInTheDocument();
    // neither action reads the account, so both stay live
    await expect
      .element(screen.getByRole("button", { name: /set default/i }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("link", { name: /delete/i }))
      .toBeInTheDocument();
  }, 30_000);
});

describe("set default flow", () => {
  it("click Set Default on approved bapp changes badge to Default", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { id: "100", status: "approved" });
    vi.mocked(wise.v2_account).mockResolvedValue(WISE_FIXTURE as any);

    const screen = await render_banking_app(
      npo.id,
      `/admin/${npo.id}/banking/100`
    );

    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: /set default/i }).click();

    // revalidation: badge changes
    await expect
      .element(screen.getByText("Default", { exact: true }))
      .toBeVisible();
  });

  it("demotes previous default (cross-page)", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, {
      id: "100",
      status: "default",
      bank_summary: "USD ending 1111",
    });
    await seed_bapp(npo.id, {
      id: "200",
      status: "approved",
      bank_summary: "EUR ending 2222",
    });
    vi.mocked(wise.v2_account).mockResolvedValue(WISE_FIXTURE as any);

    // navigate to bapp 200 and promote it
    const screen = await render_banking_app(
      npo.id,
      `/admin/${npo.id}/banking/200`
    );
    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: /set default/i }).click();
    await expect
      .element(screen.getByText("Default", { exact: true }))
      .toBeVisible();

    // verify on list page: 200 is Default, 100 is Approved
    await screen.unmount();
    const screen2 = await render_banking_app(
      npo.id,
      `/admin/${npo.id}/banking`
    );
    await expect.element(screen2.getByText("EUR ending 2222")).toBeVisible();
    // table status cells
    const cells = screen2.getByText(/Default|Approved/);
    const texts = cells.elements().map((c) => c.textContent);
    expect(texts).toContain("Default");
    expect(texts).toContain("Approved");
  });
});

describe("delete", () => {
  it("bapp_delete removes row", async () => {
    const npo = await seed_npo();
    const id = await seed_bapp(npo.id);

    await bapp_delete(id, npo.id);

    const row = await get_bapp(id);
    expect(row).toBeUndefined();
  });

  it("detail → Delete → Proceed → redirects to list", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { id: "100", status: "approved" });
    vi.mocked(wise.v2_account).mockResolvedValue(WISE_FIXTURE as any);

    const screen = await render_banking_app(
      npo.id,
      `/admin/${npo.id}/banking/100`
    );
    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeVisible();

    // click Delete link → modal
    await screen.getByRole("link", { name: /delete/i }).click();
    await expect.element(screen.getByText(/are you sure/i)).toBeVisible();

    // confirm — dispatch click via JS to bypass the dialog overlay
    const proceed_btn = screen.getByRole("button", { name: /proceed/i });
    (proceed_btn.element() as HTMLElement).click();

    // redirected to list — bapp gone
    await expect.element(screen.getByText("No bank account yet")).toBeVisible();
  });

  async function open_prompt(npo_id: number, bank_id: string) {
    vi.mocked(wise.v2_account).mockResolvedValue(WISE_FIXTURE as any);
    const screen = await render_banking_app(
      npo_id,
      `/admin/${npo_id}/banking/${bank_id}`
    );
    await screen.getByRole("link", { name: /delete/i }).click();
    await expect
      .element(screen.getByRole("dialog", { name: "Delete payout method" }))
      .toBeVisible();
    return screen;
  }

  async function proceed_delete(npo_id: number, bank_id: string) {
    const screen = await open_prompt(npo_id, bank_id);
    const proceed_btn = screen.getByRole("button", { name: /proceed/i });
    await expect.element(proceed_btn).toBeVisible();
    (proceed_btn.element() as HTMLElement).click();
    return screen;
  }

  const DEFAULT_SUMMARY = "USD ending 1111";
  const OTHER_SUMMARY = "EUR ending 2222";
  const REFUSAL = /set another payout method as default before deleting/i;

  it("refuses up front to delete the default while another approved method exists", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, {
      id: "100",
      status: "default",
      bank_summary: DEFAULT_SUMMARY,
    });
    await seed_bapp(npo.id, {
      id: "200",
      status: "approved",
      bank_summary: OTHER_SUMMARY,
    });

    const screen = await open_prompt(npo.id, "100");

    await expect.element(screen.getByText(REFUSAL)).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /proceed/i }))
      .not.toBeInTheDocument();
  });

  it("warns before deleting the default when no other method is approved", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { id: "100", status: "default" });
    await seed_bapp(npo.id, { id: "200", status: "under-review" });

    const screen = await open_prompt(npo.id, "100");

    await expect
      .element(screen.getByText(/must have at least one banking connection/i))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /proceed/i }))
      .toBeInTheDocument();
  });

  it("refuses a stale prompt once another method was approved meanwhile", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, {
      id: "100",
      status: "default",
      bank_summary: DEFAULT_SUMMARY,
    });
    await seed_bapp(npo.id, {
      id: "200",
      status: "under-review",
      bank_summary: OTHER_SUMMARY,
    });
    const screen = await open_prompt(npo.id, "100");
    const proceed_btn = screen.getByRole("button", { name: /proceed/i });
    await expect.element(proceed_btn).toBeVisible();

    await test_db
      .current!.db.update(banking_apps)
      .set({ status: "approved" })
      .where(eq(banking_apps.id, "200"));
    (proceed_btn.element() as HTMLElement).click();

    // the refusal answers below 400, so the prompt revalidates into it
    await expect.element(screen.getByText(REFUSAL)).toBeVisible();
    await expect.element(proceed_btn).not.toBeInTheDocument();
    await cleanup();
    const list = await render_banking_app(npo.id, `/admin/${npo.id}/banking`);
    await expect.element(list.getByText(DEFAULT_SUMMARY)).toBeVisible();
    await expect.element(list.getByText(OTHER_SUMMARY)).toBeVisible();
  });

  it("deletes the default when it is the only approved method", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, {
      id: "100",
      status: "default",
      bank_summary: DEFAULT_SUMMARY,
    });
    await seed_bapp(npo.id, {
      id: "200",
      status: "under-review",
      bank_summary: OTHER_SUMMARY,
    });

    const screen = await proceed_delete(npo.id, "100");

    await expect.element(screen.getByText(OTHER_SUMMARY)).toBeVisible();
    await expect
      .element(screen.getByText(DEFAULT_SUMMARY))
      .not.toBeInTheDocument();
  });

  it("deletes a non-default method beside the default", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, {
      id: "100",
      status: "approved",
      bank_summary: OTHER_SUMMARY,
    });
    await seed_bapp(npo.id, {
      id: "200",
      status: "default",
      bank_summary: DEFAULT_SUMMARY,
    });

    const screen = await proceed_delete(npo.id, "100");

    await expect.element(screen.getByText(DEFAULT_SUMMARY)).toBeVisible();
    await expect
      .element(screen.getByText(OTHER_SUMMARY))
      .not.toBeInTheDocument();
  });

  it("detail → Delete → Cancel → stays on detail", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { id: "100", status: "approved" });
    vi.mocked(wise.v2_account).mockResolvedValue(WISE_FIXTURE as any);

    const screen = await render_banking_app(
      npo.id,
      `/admin/${npo.id}/banking/100`
    );
    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeVisible();

    // click Delete link → modal
    await screen.getByRole("link", { name: /delete/i }).click();
    await expect.element(screen.getByText(/are you sure/i)).toBeVisible();

    // cancel — dispatch click via JS to bypass the dialog overlay
    (
      screen.getByRole("link", { name: /cancel/i }).element() as HTMLElement
    ).click();

    // still on detail
    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("Jane Doe")).toBeInTheDocument();
  });
});

describe("stripe connect card", () => {
  const READY = {
    stripe_account_id: "acct_ready",
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_details_submitted: true,
    stripe_requirements_due: [],
    stripe_synced_at: new Date().toISOString(),
  };

  const compare_row = (screen: Awaited<ReturnType<typeof render_list>>) =>
    screen
      .getByRole("region", { name: "Compare your options" })
      .getByRole("button", { name: /compare your options/i });
  const add_bank_links = (screen: Awaited<ReturnType<typeof render_list>>) =>
    screen.getByRole("link", { name: "Add bank account" }).elements();
  const no_wise = (screen: Awaited<ReturnType<typeof render_list>>) =>
    expect(screen.container.textContent).not.toMatch(
      /\bwise\b|money-transfer/i
    );

  it("bank only: offers stripe beside the bank, and holds nothing", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, {
      status: "default",
      bank_summary: "USD account ending in 1234",
    });
    // a pending payout beside a bank is on its way, not held
    await seed_held(npo.id, 500);

    const screen = await render_list(npo.id);

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByText("Not connected", { exact: true }))
      .toBeVisible();
    await expect
      .element(card.getByText(/Everything else keeps paying out to your bank/))
      .toBeVisible();
    await expect
      .element(card.getByRole("link", { name: "Connect Stripe" }))
      .toHaveAttribute(
        "href",
        `/api/stripe-connect/start?kind=npo&npo_id=${npo.id}`
      );
    await expect
      .element(compare_row(screen))
      .toMatchTextContent(/Right now: Bank\. See how Bank and Stripe differ\./);
    await expect
      .element(compare_row(screen))
      .toHaveAttribute("aria-expanded", "false");
    const bank = screen.getByRole("region", { name: "Bank payout" });
    await expect
      .element(bank.getByText("USD account ending in 1234"))
      .toBeVisible();
    await expect
      .element(bank.getByRole("link", { name: "Add bank account" }))
      .toHaveAttribute("href", `/admin/${npo.id}/banking/new`);
    expect(screen.getByText("Held right now").query()).toBeNull();
    // the compare row, then the bank, then stripe
    const [e, b, c] = [
      screen.getByRole("region", { name: "Compare your options" }),
      bank,
      card,
    ].map((l) => l.element());
    expect(
      e.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    no_wise(screen);
  });

  it("stripe only: shows what waits for a bank, with one way to add it", async () => {
    const npo = await seed_npo(READY);
    await seed_held(npo.id, 500);

    const screen = await render_list(npo.id);

    const held = screen.getByRole("region", {
      name: "Waiting for a bank account",
    });
    await expect
      .element(held.getByText("$500.00", { exact: true }).first())
      .toBeVisible();
    await expect
      .element(held.getByText("Savings and Investments withdrawals"))
      .toBeVisible();
    await expect
      .element(held.getByRole("link", { name: "Add bank account" }))
      .toHaveAttribute("href", `/admin/${npo.id}/banking/new`);
    // the held card carries the page's one Add bank account
    expect(add_bank_links(screen)).toHaveLength(1);
    const bank = screen.getByRole("region", { name: "Bank payout" });
    await expect
      .element(
        bank.getByText(
          "Add one to release held money and have everything else pay out to your bank."
        )
      )
      .toBeVisible();
    await expect
      .element(compare_row(screen))
      .toMatchTextContent(
        /Right now: Stripe\. See how Bank and Stripe differ\./
      );
    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByText("Ready to receive Stripe donations"))
      .toBeVisible();
    await expect
      .element(card.getByText(/What Stripe pays on to your own bank/))
      .toBeVisible();
    // a synced mirror is read as it stands
    expect(sync_npo_account).not.toHaveBeenCalled();
    no_wise(screen);
  });

  it("stripe only with nothing waiting: no held card, and the bank section offers the add", async () => {
    const npo = await seed_npo(READY);

    const screen = await render_list(npo.id);

    await expect
      .element(screen.getByRole("region", { name: "Stripe account" }))
      .toBeVisible();
    expect(screen.getByText("Held right now").query()).toBeNull();
    const bank = screen.getByRole("region", { name: "Bank payout" });
    await expect
      .element(bank.getByRole("link", { name: "Add bank account" }))
      .toBeVisible();
    expect(add_bank_links(screen)).toHaveLength(1);
  });

  it("never linked stripe and no bank: no held card, the bank section offers the add", async () => {
    const npo = await seed_npo();
    await seed_held(npo.id, 500);

    const screen = await render_list(npo.id);

    await expect
      .element(
        screen
          .getByRole("region", { name: "Stripe account" })
          .getByText("Not connected", { exact: true })
      )
      .toBeVisible();
    expect(screen.getByText("Held right now").query()).toBeNull();
    expect(add_bank_links(screen)).toHaveLength(1);
  });

  it("stripe only with a bank under review: says it pays out once approved, and asks for no other", async () => {
    const npo = await seed_npo(READY);
    await seed_bapp(npo.id, { status: "under-review" });
    await seed_held(npo.id, 500);

    const screen = await render_list(npo.id);

    const held = screen.getByRole("region", {
      name: "Waiting for your bank account to be approved",
    });
    await expect
      .element(held.getByText("$500.00", { exact: true }).first())
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("region", { name: "Bank payout" })
          .getByText(/Your bank account is under review\./)
      )
      .toBeVisible();
    expect(add_bank_links(screen)).toHaveLength(0);
  });

  // fiscally sponsored: stripe can't pay it, so it holds what Banking says
  // Payouts and the dashboard hold too
  it("ineligible with no bank: no stripe held card, and the stripe card says donations are held", async () => {
    const npo = await seed_npo({ ...READY, fiscal_sponsored: true });
    await seed_held(npo.id, 500);

    const screen = await render_list(npo.id);

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(
        card.getByText(/Until you add a bank account, all your donations/)
      )
      .toBeVisible();
    await expect
      .element(card.getByRole("link", { name: "Add a bank account" }))
      .toHaveAttribute("href", `/admin/${npo.id}/banking/new`);
    expect(screen.getByText("Held right now").query()).toBeNull();
  });

  it("ineligible with a bank under review: the stripe card says it waits for approval", async () => {
    const npo = await seed_npo({ fiscal_sponsored: true });
    await seed_bapp(npo.id, { status: "under-review" });

    const screen = await render_list(npo.id);

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByText(/Your bank account is under review\./))
      .toBeVisible();
    expect(
      card.getByRole("link", { name: "Add a bank account" }).query()
    ).toBeNull();
  });

  it("bank and stripe: says what goes where, and links the payouts page", async () => {
    const npo = await seed_npo(READY);
    await seed_bapp(npo.id, {
      status: "default",
      bank_summary: "USD account ending in 1234",
    });

    const screen = await render_list(npo.id);

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(
        card.getByRole("link", {
          name: /what's been sent on your payouts page/i,
        })
      )
      .toHaveAttribute("href", `/admin/${npo.id}/dashboard/payouts`);
    await expect
      .element(card.getByText(/Everything else pays out to your bank/))
      .toBeVisible();
    const bank = screen.getByRole("region", { name: "Bank payout" });
    await expect
      .element(
        bank.getByText(/Everything except Stripe donations pays out here\./)
      )
      .toBeVisible();
    await expect
      .element(compare_row(screen))
      .toMatchTextContent(/Right now: Bank and Stripe\. See how they differ\./);
    expect(screen.getByText("Held right now").query()).toBeNull();
    no_wise(screen);
  });

  it("disconnected with no bank: everything is held, with both ways back", async () => {
    const npo = await seed_npo({
      ...READY,
      stripe_deauthorized_at: "2026-10-01T00:00:00.000Z",
    });
    await seed_held(npo.id, 500);

    const screen = await render_list(npo.id);

    const held = screen.getByRole("region", {
      name: "No way to get paid right now",
    });
    await expect
      .element(held.getByText("$500.00", { exact: true }).first())
      .toBeVisible();
    await expect
      .element(held.getByRole("link", { name: "Connect Stripe" }))
      .toHaveAttribute(
        "href",
        `/api/stripe-connect/start?kind=npo&npo_id=${npo.id}`
      );
    expect(add_bank_links(screen)).toHaveLength(1);
    await expect
      .element(
        screen
          .getByRole("region", { name: "Bank payout" })
          .getByText(
            "Add one to release held money and get everything paid out to your bank."
          )
      )
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("region", { name: "Stripe account" })
          .getByText("Disconnected", { exact: true })
      )
      .toBeVisible();
    await expect
      .element(compare_row(screen))
      .toMatchTextContent(
        /Right now: nothing set up\. See how Bank and Stripe differ\./
      );
    no_wise(screen);
  });

  it.each([
    {
      status: "incomplete",
      seed: { ...READY, stripe_details_submitted: false },
      line: "Finish setup on Stripe",
    },
    {
      status: "pending",
      seed: { ...READY, stripe_charges_enabled: false },
      line: "Pending review",
    },
  ])("a $status account counts as stripe set up", async ({ seed, line }) => {
    const npo = await seed_npo(seed);
    const screen = await render_list(npo.id);

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect.element(card.getByText(line, { exact: true })).toBeVisible();
    await expect
      .element(compare_row(screen))
      .toMatchTextContent(/Right now: Stripe\./);
    expect(sync_npo_account).not.toHaveBeenCalled();
  });

  it.each([
    {
      why: "fiscally sponsored",
      seed: { fiscal_sponsored: true },
      says: /fiscally sponsored nonprofits/i,
    },
    {
      why: "headquartered outside the transfer countries",
      seed: { hq_country: "Brazil" },
      says: /headquartered in Brazil/,
    },
  ])(
    "a $why npo is told stripe is not available, and nothing else",
    async ({ seed, says }) => {
      const npo = await seed_npo({ ...seed, stripe_account_id: "acct_new" });
      await seed_bapp(npo.id, { bank_summary: "USD account ending in 1234" });

      const screen = await render_list(npo.id, "?stripe_connect=connected");

      const card = screen.getByRole("region", { name: "Stripe account" });
      await expect.element(card.getByText(says)).toBeVisible();
      await expect
        .element(card.getByText("Not available", { exact: true }))
        .toBeVisible();
      await expect
        .element(screen.getByText("USD account ending in 1234"))
        .toBeVisible();
      expect(
        screen.getByRole("region", { name: "Compare your options" }).query()
      ).toBeNull();
      expect(screen.getByRole("link", { name: /stripe/i }).query()).toBeNull();
      expect(
        screen.getByRole("button", { name: /account/i }).query()
      ).toBeNull();
      expect(
        screen.getByText("Your Stripe account is connected.").query()
      ).toBeNull();
      // connecting would change nothing, so stripe is not asked
      expect(sync_npo_account).not.toHaveBeenCalled();
    }
  );

  it.each([
    { why: "fiscally sponsored", seed: { fiscal_sponsored: true } },
    {
      why: "headquartered outside the transfer countries",
      seed: { hq_country: "Brazil" },
    },
  ])(
    "a $why npo that never linked an account is still told stripe is not available",
    async ({ seed }) => {
      const npo = await seed_npo(seed);

      const screen = await render_list(npo.id, "?stripe_connect=connected");

      const card = screen.getByRole("region", { name: "Stripe account" });
      await expect
        .element(card.getByText("Not available", { exact: true }))
        .toBeVisible();
      expect(
        screen.getByRole("link", { name: "Connect Stripe" }).query()
      ).toBeNull();
      expect(
        screen.getByText("Your Stripe account is connected.").query()
      ).toBeNull();
      expect(sync_npo_account).not.toHaveBeenCalled();
    }
  );

  it("asks stripe for a linked account it has never synced", async () => {
    const npo = await seed_npo({ stripe_account_id: "acct_new" });
    // the unsynced columns read as an account with nothing done
    sync_npo_account.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements_due: [],
    });

    const screen = await render_list(npo.id);

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByText("Ready to receive Stripe donations"))
      .toBeVisible();
    expect(sync_npo_account).toHaveBeenCalledWith(npo.id);
  });

  // read off the loader: the card's own wording for it is the ui's to land
  const status_of = async (npo_id: number) => {
    const data = await list_loader({
      context: { get: () => npo_id },
      ...doc_args(new Request(`https://app.test/admin/${npo_id}/banking`)),
      params: { id: `${npo_id}` },
    } as any);
    return data.stripe.status;
  };

  it("an npo that disconnected us reads as disconnected, past its last mirror", async () => {
    const npo = await seed_npo({
      ...READY,
      stripe_deauthorized_at: "2026-10-01T00:00:00.000Z",
    });

    expect(await status_of(npo.id)).toBe("disconnected");
    expect(sync_npo_account).not.toHaveBeenCalled();
  });

  it("an unsynced account stripe refuses us reads as disconnected", async () => {
    const npo = await seed_npo({ stripe_account_id: "acct_refused" });
    sync_npo_account.mockResolvedValue("disconnected");

    expect(await status_of(npo.id)).toBe("disconnected");
  });

  it("keeps the page up when stripe can't be reached for an unsynced account", async () => {
    const npo = await seed_npo({ stripe_account_id: "acct_new" });
    await seed_bapp(npo.id, { bank_summary: "USD account ending in 1234" });
    const down = new Stripe.errors.StripeConnectionError({ message: "down" });
    sync_npo_account.mockRejectedValue(down);

    const screen = await render_list(npo.id);

    // linked but unread: never "ready", and not the nonprofit's move
    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByText("Pending review", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("USD account ending in 1234"))
      .toBeVisible();
    expect(report_degraded).toHaveBeenCalledWith(down);
  });

  it("shows how the connect attempt ended on the way back from stripe", async () => {
    const npo = await seed_npo();
    const screen = await render_list(
      npo.id,
      "?stripe_connect=error&stripe_connect_reason=already_linked"
    );

    await expect
      .element(screen.getByText(/already linked to another nonprofit/i))
      .toBeVisible();
  });

  it("shows no notice for a result the callback never sends", async () => {
    const npo = await seed_npo();
    await seed_bapp(npo.id, { bank_summary: "USD account ending in 1234" });
    const screen = await render_list(npo.id, "?stripe_connect=maybe");

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(screen.getByText("USD account ending in 1234"))
      .toBeVisible();
    expect(card.element().querySelector("[tabindex='-1']")).toBeNull();
  });

  it("hides the card and any return notice while routing is off", async () => {
    routing.on = false;
    const npo = await seed_npo({ stripe_account_id: "acct_new" });
    await seed_bapp(npo.id, { bank_summary: "USD account ending in 1234" });
    sync_npo_account.mockResolvedValue({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements_due: [],
    });

    const screen = await render_list(
      npo.id,
      "?stripe_connect=error&stripe_connect_reason=already_linked"
    );

    await expect
      .element(screen.getByText("USD account ending in 1234"))
      .toBeVisible();
    expect(
      screen.getByRole("region", { name: "Stripe account" }).query()
    ).toBeNull();
    expect(
      screen.getByText("Not connected", { exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Connect Stripe" }).query()
    ).toBeNull();
    expect(
      screen.getByText(/already linked to another nonprofit/i).query()
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: "Compare your options" }).query()
    ).toBeNull();
    const bank = screen.getByRole("region", { name: "Bank payout" });
    await expect.element(bank).toBeVisible();
    expect(screen.container.textContent).not.toMatch(/stripe/i);
    expect(sync_npo_account).not.toHaveBeenCalled();
  });
});
