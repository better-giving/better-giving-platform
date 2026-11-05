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
import { clear_qstash_events, get_qstash_events } from "#/setup-tests-browser";
import { user } from "$/pg/schema/auth";
import { banking_apps } from "$/pg/schema/banking";
import { npos } from "$/pg/schema/npo";
import { registrations } from "$/pg/schema/registration";
import { user_npo_memberships } from "$/pg/schema/user";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- test db (assigned in beforeAll, accessed via getter in mock) ---
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
    // every write here is fresh, so every repeat is still inside the window
    in_dedupe_window: () => true,
  };
});

vi.mock("$/kit/wise", () => ({
  wise: {
    v2_account: vi.fn(async () => ({
      id: 123,
      longAccountSummary: "Test Bank ***1234",
      name: { fullName: "Test Org" },
      currency: "USD",
      country: "US",
      type: "aba",
      legalEntityType: "BUSINESS" as const,
      displayFields: [
        { key: "accountNumber", label: "Account", value: "***1234" },
      ],
    })),
  },
}));

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({ session: true })
);

vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((_data: unknown, msg: string) => ({ toast: msg })),
}));

import type { LoaderFunction } from "react-router";
import { get_session } from "#/.server/auth";
import { step_loader } from "#/pages/registration/data/step-loader";
// registration page imports for cross-page verification
import Dashboard from "#/routes/_app.register.$reg_id._steps.5/route";
import { submit_action } from "#/routes/_app.register.$reg_id._steps.5/submit-action";
import RegSuccess from "#/routes/_app.register.success/route";
import Prompt, {
  action,
} from "#/routes/platform.applications_.$id.$verdict/route";
import type { V2RecipientAccount } from "#/types/bank-details";
import { wise } from "$/kit/wise";
import { reg_get, reg_put } from "$/pg/queries/registration";
import { create_test_db } from "$/pg/test-utils/pglite";
import { loader as review_loader } from "../api";
import Page from "../route";

const mock_get_session = vi.mocked(get_session);
const TEST_EMAIL = "admin@example.com";

function set_authed(email = TEST_EMAIL) {
  mock_get_session.mockResolvedValue({
    user: {
      id: "test-user-id",
      email,
      role: null,
      name: email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      first_name: "Jane",
      last_name: "Doe",
    } as any,
  });
}

// --- setup ---

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await cleanup();
  await test_db.current!.db.delete(user_npo_memberships);
  await test_db.current!.db.delete(banking_apps);
  await test_db.current!.db.delete(registrations);
  await test_db.current!.db.delete(npos);
  await test_db.current!.db.delete(user);
  mock_get_session.mockReset();
});

// --- helpers ---

async function seed_user(email = TEST_EMAIL) {
  await test_db
    .current!.db.insert(user)
    .values({
      id: "test-user-id",
      name: "Jane Doe",
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      first_name: "Jane",
      last_name: "Doe",
    })
    .onConflictDoNothing();
}

async function seed_reg(
  overrides: Partial<typeof registrations.$inferInsert> = {}
) {
  // the first screen collects org type + identity, so a stored application
  // always has them
  const id = await reg_put({
    r_id: TEST_EMAIL,
    o_type: "501c3",
    o_ein: "123456789",
    o_hq_country: "United States",
  });
  if (Object.keys(overrides).length) {
    await test_db
      .current!.db.update(registrations)
      .set(overrides)
      .where(eq(registrations.id, id));
  }
  return id;
}

const CONTACT_FIELDS = {
  r_first_name: "Jane",
  r_last_name: "Doe",
  r_contact_number: "1234567890",
  o_name: "Test Org",
  r_org_role: "ceo",
  rm: "search-engines",
};

const ORG_FIELDS = {
  o_website: "https://example.com",
  o_hq_country: "United States",
  o_designation: "Charity",
};

const EIN_FIELDS: Partial<typeof registrations.$inferInsert> = {
  o_type: "501c3",
  o_ein: "123456789",
};

const BANKING_FIELDS = {
  o_bank_id: "wise-recipient-123",
  o_bank_statement: "https://example.com/bank.pdf",
};

const ALL_FIELDS = {
  ...CONTACT_FIELDS,
  ...ORG_FIELDS,
  ...EIN_FIELDS,
  ...BANKING_FIELDS,
  status: "02" as const,
};

// --- route stubs ---

const MOCK_WACC: V2RecipientAccount = {
  id: 123,
  longAccountSummary: "Test Bank ***1234",
  name: { fullName: "Test Org" },
  currency: "USD",
  country: "US",
  type: "aba",
  legalEntityType: "BUSINESS",
  displayFields: [{ key: "accountNumber", label: "Account", value: "***1234" }],
};

const test_loader: LoaderFunction = async ({ params }) => {
  const reg = await reg_get(params.id!);
  if (!reg) throw new Response("Not found", { status: 404 });
  return { reg, wacc: MOCK_WACC, wacc_unavailable: false };
};

async function render_review(id: string, sub = "") {
  const Stub = createRoutesStub([
    {
      id: "routes/platform.applications_.$id",
      path: "/platform/applications/:id",
      Component: Page,
      HydrateFallback: () => null,
      loader: test_loader,
      children: [
        { path: ":verdict", Component: Prompt, action: action as any },
        {
          path: "success",
          Component: () => <p>Review submitted</p>,
        },
      ],
    },
  ]);
  return await render(
    <Stub initialEntries={[`/platform/applications/${id}${sub}`]} />
  );
}

// the outage cases need the real loader — the flag is what it derives
async function render_review_live(id: string) {
  const Stub = createRoutesStub([
    {
      path: "/platform/applications/:id",
      Component: Page,
      HydrateFallback: () => null,
      loader: review_loader as any,
      children: [
        { path: ":verdict", Component: Prompt, action: action as any },
      ],
    },
  ]);
  return await render(
    <Stub initialEntries={[`/platform/applications/${id}`]} />
  );
}

async function render_registration(id: string) {
  set_authed();
  const Stub = createRoutesStub([
    {
      path: "/register",
      HydrateFallback: () => null,
      children: [
        {
          path: ":reg_id",
          children: [
            {
              path: "5",
              Component: Dashboard,
              loader: step_loader(5) as any,
              action: submit_action as any,
            },
          ],
        },
        {
          path: "success",
          Component: RegSuccess,
        },
      ],
    },
  ]);
  return await render(<Stub initialEntries={[`/register/${id}/5`]} />);
}

// --- tests ---

describe("rejection", () => {
  it("shows rejected badge + success after admin rejects", async () => {
    const id = await seed_reg(ALL_FIELDS);
    let screen = await render_review(id);

    // application details render
    await expect.element(screen.getByText("Test Org")).toBeInTheDocument();
    await expect.element(screen.getByText("123456789")).toBeInTheDocument();

    // click Reject → modal
    await screen.getByRole("link", { name: /reject/i }).click();
    await expect
      .element(screen.getByText(/changing application status/i))
      .toBeInTheDocument();

    // fill reason + submit
    await screen
      .getByLabelText(/reason for rejection/i)
      .fill("docs incomplete");
    // the dialog overlay intercepts pointer events;
    // use native DOM click to bypass
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    // success page renders, parent revalidates with rejected state
    await expect
      .element(screen.getByText(/review submitted/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Rejected", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .toHaveAttribute("aria-disabled", "true");

    // qstash events
    const events = get_qstash_events();
    expect(events.some((e: any) => e.id === "reg-updated")).toBe(true);

    // --- registrant side: sees rejection + can resubmit ---
    await cleanup();
    clear_qstash_events();
    screen = await render_registration(id);

    // dashboard shows rejected message
    await expect
      .element(screen.getByText(/application has been rejected/i))
      .toBeInTheDocument();

    // resubmit
    await screen.getByRole("button", { name: /resubmit/i }).click();

    // now shows "submitted for review"
    await expect
      .element(screen.getByText(/submitted for review/i))
      .toBeInTheDocument();
  });
});

describe("verdict dialog", () => {
  it("names the org when its URL is opened directly", async () => {
    const id = await seed_reg(ALL_FIELDS);
    const screen = await render_review(id, "/rejected");

    await expect
      .element(
        screen.getByRole("dialog").getByText("Test Org", { exact: true })
      )
      .toBeVisible();
  });
});

describe("approval", () => {
  it("shows approved badge + success after admin approves", async () => {
    await seed_user();
    const id = await seed_reg(ALL_FIELDS);
    let screen = await render_review(id);

    await expect.element(screen.getByText("Test Org")).toBeInTheDocument();

    // click Approve → modal with payout warning
    await screen.getByRole("link", { name: /approve/i }).click();
    await expect
      .element(screen.getByText(/immediately payout all pending funds/i))
      .toBeInTheDocument();

    // submit — the dialog overlay intercepts pointer events;
    // use native DOM click to bypass
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    // success page renders, parent revalidates with approved state
    await expect
      .element(screen.getByText(/review submitted/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .toHaveAttribute("aria-disabled", "true");

    // qstash events
    const events = get_qstash_events();
    expect(events.some((e: any) => e.id === "banking-new")).toBe(true);
    expect(events.some((e) => e.id === "reg-updated")).toBe(true);

    // --- registrant side: sees account created ---
    await cleanup();
    screen = await render_registration(id);

    // step_loader(5) redirects approved registration to success page
    await expect
      .element(screen.getByText(/Test Org.*account has been created/i))
      .toBeInTheDocument();
    // links to the new NPO's admin profile
    await expect
      .element(screen.getByRole("link", { name: /start filling out/i }))
      .toHaveAttribute("href", expect.stringContaining("/admin/"));
  });
});

describe("already decided", () => {
  it("shows approved badge + disabled buttons", async () => {
    await seed_user();
    const id = await seed_reg({ ...ALL_FIELDS, status: "03" });
    const screen = await render_review(id);

    await expect
      .element(screen.getByText("Approved", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("shows rejected badge + reason + disabled buttons", async () => {
    const id = await seed_reg({
      ...ALL_FIELDS,
      status: "04",
      status_rejected_reason: "missing docs",
    });
    const screen = await render_review(id);

    await expect
      .element(screen.getByText("Rejected", { exact: true }))
      .toBeInTheDocument();
    await expect.element(screen.getByText("missing docs")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
  });
});

describe("wise outage", () => {
  it("resolves the loader with a null account instead of a 500", async () => {
    const id = await seed_reg(ALL_FIELDS);
    vi.mocked(wise.v2_account).mockRejectedValueOnce("wise is down");

    const d = await (review_loader as any)({ params: { id } });

    expect(d.wacc).toBeNull();
    expect(d.wacc_unavailable).toBe(true);
    // the rest of the application is our own row and is untouched
    expect(d.reg.o_name).toBe("Test Org");
    expect(d.reg.o_ein).toBe("123456789");
  });

  it("renders the application with a bank-details-unavailable notice", async () => {
    const id = await seed_reg(ALL_FIELDS);
    vi.mocked(wise.v2_account).mockRejectedValueOnce("wise is down");

    const Stub = createRoutesStub([
      {
        path: "/platform/applications/:id",
        Component: Page,
        HydrateFallback: () => null,
        loader: review_loader as any,
        ErrorBoundary: () => <p>could not load the application</p>,
        children: [
          { path: ":verdict", Component: Prompt, action: action as any },
        ],
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/platform/applications/${id}`]} />
    );

    // the nine rows off our own row still render
    await expect.element(screen.getByText("Test Org")).toBeInTheDocument();
    await expect.element(screen.getByText("123456789")).toBeInTheDocument();
    await expect
      .element(screen.getByText(/couldn't be loaded from the payout provider/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/could not load the application/i))
      .not.toBeInTheDocument();
  });

  it("still shows the bank statement we hold ourselves", async () => {
    const id = await seed_reg(ALL_FIELDS);
    vi.mocked(wise.v2_account).mockRejectedValueOnce("wise is down");

    const screen = await render_review_live(id);

    // the artifact a reviewer cross-checks the account against is our own
    // registration data, so the outage must not take it down
    await expect
      .element(screen.getByText(BANKING_FIELDS.o_bank_statement))
      .toBeInTheDocument();
  });

  it("disables Approve, since approval reads the account", async () => {
    const id = await seed_reg(ALL_FIELDS);
    vi.mocked(wise.v2_account).mockRejectedValueOnce("wise is down");

    const screen = await render_review_live(id);

    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
    // rejecting never reads the account
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .not.toHaveAttribute("aria-disabled", "true");
  });

  it("shows no banking section at all when no account is on file", async () => {
    const id = await seed_reg({ ...ALL_FIELDS, o_bank_id: null });

    const Stub = createRoutesStub([
      {
        path: "/platform/applications/:id",
        Component: Page,
        HydrateFallback: () => null,
        loader: review_loader as any,
        children: [
          { path: ":verdict", Component: Prompt, action: action as any },
        ],
      },
    ]);
    const screen = await render(
      <Stub initialEntries={[`/platform/applications/${id}`]} />
    );

    await expect.element(screen.getByText("Test Org")).toBeInTheDocument();
    await expect
      .element(screen.getByText(/banking details/i))
      .not.toBeInTheDocument();
  });

  it("disables Approve while no account is on file, as it does in an outage", async () => {
    const id = await seed_reg({ ...ALL_FIELDS, o_bank_id: null });

    const screen = await render_review_live(id);

    await expect.element(screen.getByText("Test Org")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("link", { name: /reject/i }))
      .not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("stripe-only application", () => {
  it("says it is stripe-only, shows the stripe account, and allows Approve", async () => {
    const id = await seed_reg({
      ...ALL_FIELDS,
      o_bank_id: null,
      o_bank_statement: null,
      o_stripe_account_id: "acct_only123",
    });
    vi.mocked(wise.v2_account).mockClear();

    const screen = await render_review_live(id);

    await expect.element(screen.getByText("Test Org")).toBeInTheDocument();
    await expect.element(screen.getByText(/stripe only/i)).toBeInTheDocument();
    await expect
      .element(screen.getByText("acct_only123", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/banking details/i))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /approve/i }))
      .not.toHaveAttribute("aria-disabled", "true");
    expect(wise.v2_account).not.toHaveBeenCalled();
  });
});
