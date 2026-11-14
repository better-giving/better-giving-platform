import { eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import { createRoutesStub, redirect } from "react-router";
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
import { render } from "vitest-browser-react";
import { clear_qstash_events, get_qstash_events } from "#/setup-tests-browser";
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

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({ session: true })
);

vi.mock("#/.server/cookie", () => ({
  reg_cookie: {
    parse: vi.fn(async () => ({})),
    serialize: vi.fn(async () => "bg-registration=x"),
  },
}));

vi.mock("#/components/bank-details/recipient-details/use-requirements", () => ({
  use_requirements: (args: { amount: number; currency: string } | null) => ({
    req: {
      data: args
        ? {
            requirements: [
              {
                type: "iban",
                title: "IBAN",
                usageInfo: null,
                fields: [
                  {
                    name: "Account holder",
                    group: [
                      {
                        key: "accountHolderName",
                        name: "Full name of the account holder",
                        type: "text",
                        refreshRequirementsOnChange: false,
                        required: true,
                        displayFormat: null,
                        example: "Jane Doe",
                        minLength: 1,
                        maxLength: 100,
                        validationRegexp: null,
                        validationAsync: null,
                        valuesAllowed: null,
                      },
                    ],
                  },
                  {
                    name: "IBAN",
                    group: [
                      {
                        key: "details.IBAN",
                        name: "IBAN",
                        type: "text",
                        refreshRequirementsOnChange: false,
                        required: true,
                        displayFormat: null,
                        example: "DE89370400440532013000",
                        minLength: 2,
                        maxLength: 34,
                        validationRegexp: null,
                        validationAsync: null,
                        valuesAllowed: null,
                      },
                    ],
                  },
                ],
              },
            ],
            quoteId: "test-quote-1",
          }
        : undefined,
      isLoading: false,
    },
    update_requirements: vi.fn(),
  }),
}));

// the fetcher reads remix-toast's payload as-is — the toast rides a cookie
vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((data: unknown) => data),
}));

vi.mock("#/components/bank-details/use-currencies", () => ({
  use_currencies: () => ({
    data: [
      { code: "USD", name: "United States Dollar", rate: null },
      { code: "EUR", name: "Euro", rate: null },
    ],
    is_loading: false,
    is_fetching: false,
    is_error: false,
    error: undefined,
  }),
}));

// mock anvil signing — return a route the stub can handle
vi.mock("#/.server/registration/gen-fsa-signing-url", () => ({
  gen_fsa_signing_url: vi.fn(async (reg_id: string) => ({
    url: `/register/${reg_id}/sign-result`,
    doc_eid: `doc-${reg_id}`,
  })),
}));

// mock helpers that import anvil SDK (SST secrets not available in test)
vi.mock("#/.server/registration/helpers", () => ({
  reg_id_from_signer_eid: vi.fn(),
}));

// mock FileDropzone — replace drag-drop with a simple text input. partial mock
// of the whole design-system barrel: the component ships from there now, and
// every other export in it has to survive the swap.
vi.mock("@better-giving/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@better-giving/ui")>();
  return {
    ...actual,
    FileDropzone: ({ onChange, value, label, error, className, ref }: any) => (
      <div className={className} ref={ref} data-testid="file-dropzone">
        {label}
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e: any) => onChange(e.target.value)}
        />
        {error && <span className="field-err">{error}</span>}
      </div>
    ),
  };
});

// --- imports (after mocks hoisted) ---

import { createFormData } from "remix-hook-form";
import { get_session } from "#/.server/auth";
import { action as fsa_action_handler } from "#/pages/registration/data/fsa-action";
import { reg_loader, step_loader } from "#/pages/registration/data/step-loader";
import { new_application } from "#/pages/registration/new-application";
import { after_org } from "#/pages/registration/routes";
import { update_action } from "#/pages/registration/update-action";
import Banking, {
  loader as banking_loader,
} from "#/routes/_app.register.$reg_id._steps.4/route";
import type { IReg } from "@/reg";
import { Progress } from "@/reg/progress";
import { reg_put } from "$/pg/queries/registration";
import { user } from "$/pg/schema/auth";
import { npos } from "$/pg/schema/npo";
import { user_npo_memberships } from "$/pg/schema/user";
import { create_test_db } from "$/pg/test-utils/pglite";
import {
  action as start_action,
  loader as start_loader,
} from "../routes/_app.register._index/api";
import StartScreen from "../routes/_app.register._index/route";
import StepsLayout from "../routes/_app.register.$reg_id._steps/route";
import ContactDetails from "../routes/_app.register.$reg_id._steps.1/route";
import OrgDetails from "../routes/_app.register.$reg_id._steps.2/route";
import Fsa, {
  loader as fsa_step_loader,
} from "../routes/_app.register.$reg_id._steps.3/route";
import Dashboard from "../routes/_app.register.$reg_id._steps.5/route";
import { submit_action } from "../routes/_app.register.$reg_id._steps.5/submit-action";
import {
  action as identity_action,
  loader as identity_loader,
} from "../routes/_app.register.$reg_id.identity/api";
import ChangeIdentity from "../routes/_app.register.$reg_id.identity/route";

/** a document the signed-in test user uploaded: the only kind a registration
 * accepts in a document field */
const doc = (name: string) =>
  `https://testprivate.private.blob.vercel-storage.com/docs/test-user-id/${name}`;
const mock_get_session = vi.mocked(get_session);
const TEST_EMAIL = "test@example.com";

// --- setup ---

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const original_fetch = globalThis.fetch;
beforeEach(async () => {
  await test_db.current!.db.delete(registrations);
  mock_get_session.mockReset();
  // mswWorker.use() runtime overrides don't work in browser mode — spy on fetch instead
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes("/api/wise/v1/accounts"))
      return Response.json({ id: 999, currency: "EUR", details: {} });
    if (url.includes("/api/file-upload"))
      return Response.json({
        url: doc("bank-statement.pdf"),
        presigned_url: "https://s3.example.com/put",
        content_type: "application/pdf",
      });
    if (url.includes("s3.example.com"))
      return new Response(null, { status: 200 });
    if (url.includes("/api/npos/ein/"))
      return new Response(null, { status: 404 });
    return original_fetch(input, init);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- helpers ---

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
      first_name: "Test",
      last_name: "User",
    } as any,
  });
}

// the first screen collects org type + identity, so every application
// exists with one of these two shapes from the moment it is created.
const US_IDENTITY = {
  o_type: "501c3",
  o_ein: "123456789",
  o_hq_country: "United States",
} as const;
const INTL_IDENTITY = {
  o_type: "other",
  o_hq_country: "Canada",
  o_registration_number: "abc123xyz",
} as const;

async function create_reg(
  identity: typeof US_IDENTITY | typeof INTL_IDENTITY = US_IDENTITY
): Promise<string> {
  return reg_put({ r_id: TEST_EMAIL, ...identity });
}

async function get_reg(id: string) {
  const [row] = await test_db
    .current!.db.select()
    .from(registrations)
    .where(eq(registrations.id, id));
  return row;
}

function get_outbox_events() {
  return get_qstash_events();
}

async function seed_reg(
  overrides: Partial<typeof registrations.$inferInsert> = {},
  identity: typeof US_IDENTITY | typeof INTL_IDENTITY = US_IDENTITY
) {
  const id = await create_reg(identity);
  if (Object.keys(overrides).length) {
    await test_db
      .current!.db.update(registrations)
      .set(overrides)
      .where(eq(registrations.id, id));
  }
  const reg = await get_reg(id);
  return { id, reg };
}

// minimal valid field sets per step
const CONTACT_FIELDS = {
  r_first_name: "Jane",
  r_last_name: "Doe",
  r_contact_number: "1234567890",
  o_name: "Test Org",
  r_org_role: "ceo",
  rm: "search-engines",
} as const;

// the org step writes website + designation; hq country is seeded earlier
const ORG_FIELDS = {
  o_website: "https://example.com",
  o_designation: "Charity",
} as const;

// what the agreement step collects before it can be signed
const FSA_DOC_FIELDS = {
  o_legal_entity_type: "Nonprofit Corporation",
  o_project_description: "Providing humanitarian aid globally",
  r_proof_of_identity: doc("passport.pdf"),
  o_proof_of_reg: doc("registration.pdf"),
} as const;

const BANKING_FIELDS = {
  o_bank_id: "wise-recipient-123",
  o_bank_statement: doc("bank.pdf"),
} as const;

// --- sign-result loader (simulates anvil webhook) ---

async function sign_result_loader({ params }: LoaderFunctionArgs) {
  const rid = params.reg_id!;
  await test_db
    .current!.db.update(registrations)
    .set({ o_fsa_signed_doc_url: "https://example.com/signed-fsa.pdf" })
    .where(eq(registrations.id, rid));
  return redirect(`/register/${rid}/4`);
}

// --- route tree ---

function render_registration(id: string, initial_step = "1") {
  set_authed();

  const Stub = createRoutesStub([
    {
      // the wizard chrome reads the reg off the parent by route id
      id: "routes/_app.register.$reg_id",
      path: "/register/:reg_id",
      loader: reg_loader,
      HydrateFallback: () => null,
      children: [
        {
          // `_steps` — the chrome the numbered steps render inside
          Component: StepsLayout,
          children: [
            {
              path: "1",
              Component: ContactDetails,
              loader: step_loader(1),
              action: update_action("2"),
            },
            {
              path: "2",
              Component: OrgDetails,
              loader: step_loader(2),
              action: update_action((reg) => after_org(reg.o_type)),
            },
            {
              path: "3",
              Component: Fsa,
              loader: fsa_step_loader as any,
              action: update_action("4"),
              children: [
                {
                  path: "fsa",
                  action: fsa_action_handler,
                },
              ],
            },
            {
              path: "4",
              Component: Banking,
              loader: banking_loader as any,
              action: update_action("5"),
            },
            {
              path: "5",
              Component: Dashboard,
              loader: step_loader(5),
              action: submit_action,
            },
          ],
        },
        {
          path: "identity",
          Component: ChangeIdentity,
          loader: identity_loader as any,
          action: identity_action as any,
        },
        {
          path: "sign-result",
          loader: sign_result_loader,
          Component: () => null,
        },
      ],
    },
  ]);

  return render(<Stub initialEntries={[`/register/${id}/${initial_step}`]} />);
}

// --- E2E tests ---

describe("E2E: US path (501c3)", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("threads contact → org → banking → review → submit, skipping the agreement", async () => {
    const id = await create_reg();
    clear_qstash_events();
    const screen = await render_registration(id);

    // --- step 1: contact details ---
    await expect.element(screen.getByLabelText(/first name/i)).toBeVisible();

    await screen.getByLabelText(/first name/i).fill("Jane");
    await screen.getByLabelText(/last name/i).fill("Doe");
    await screen.getByLabelText(/phone number/i).fill("1234567890");
    await screen.getByLabelText(/organization name/i).fill("Test Org");

    // select role
    await screen.getByRole("combobox", { name: /what's your role/i }).click();
    await expect.element(screen.getByText("CEO")).toBeVisible();
    await screen.getByText("CEO").click();

    // select referral method
    await screen.getByRole("combobox", { name: /how did you find/i }).click();
    await expect.element(screen.getByText("Search engines")).toBeVisible();
    await screen.getByText("Search engines").click();

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    // --- step 2: org details ---
    await expect.element(screen.getByLabelText(/website/i)).toBeVisible();

    await screen.getByLabelText(/website/i).fill("example.com");

    // hq country is not asked here — the first screen seeded it
    await expect
      .element(screen.getByPlaceholder("Select a country"))
      .not.toBeInTheDocument();

    // select designation
    await screen.getByRole("combobox", { name: /designation/i }).click();
    await expect.element(screen.getByText("Charity")).toBeVisible();
    await screen.getByText("Charity").click();

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    // --- step 4: banking (step 3 is skipped — no agreement for a 501c3) ---
    await expect
      .element(screen.getByText(/bank account currency/i))
      .toBeVisible();

    // currency defaults to USD, change to EUR
    const currency_input = screen.getByRole("combobox", {
      name: /currency/i,
    });
    await vi.waitFor(() => {
      expect(currency_input.element()).not.toBeDisabled();
    });
    await currency_input.clear();
    await currency_input.fill("EUR");
    await expect
      .element(screen.getByRole("option", { name: /EUR/i }))
      .toBeVisible();
    await screen.getByRole("option", { name: /EUR/i }).click();

    // wait for requirements to load (dynamic fields lack for/id, use placeholders)
    await expect.element(screen.getByPlaceholder("Jane Doe")).toBeVisible();

    await screen.getByPlaceholder("Jane Doe").fill("Jane Doe");
    await screen
      .getByPlaceholder("DE89370400440532013000")
      .fill("DE89370400440532013000");

    // upload bank statement via mocked FileDropzone
    const dropzones = screen.getByTestId("file-dropzone");
    const bank_stmt_dropzone =
      dropzones.elements()[dropzones.elements().length - 1];
    const bank_stmt_input = page
      .elementLocator(bank_stmt_dropzone)
      .getByRole("textbox");
    await bank_stmt_input.fill(doc("bank.pdf"));

    await screen.getByRole("button", { name: /submit/i }).click();

    // --- step 5: review ---
    await expect.element(screen.getByText(/summary/i)).toBeVisible();

    // no agreement row for a 501(c)(3)
    await expect
      .element(screen.getByText(/fiscal sponsorship agreement/i))
      .not.toBeInTheDocument();

    // verify all fields written to DB
    const row = await get_reg(id);
    expect(row.r_first_name).toBe("Jane");
    expect(row.r_last_name).toBe("Doe");
    expect(row.o_name).toBe("Test Org");
    expect(row.o_hq_country).toBe("United States");
    expect(row.o_type).toBe("501c3");
    expect(row.o_ein).toBe("123456789");
    expect(row.o_bank_id).toBe("999");
    expect(row.o_bank_statement).toBe(doc("bank.pdf"));
    expect(row.status).toBe("01");
    expect(window.dataLayer).toEqual([]);

    // submit application
    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await vi.waitFor(async () => {
      const r = await get_reg(id);
      expect(r.status).toBe("02");
    });

    // dashboard shows in-review state
    await expect
      .element(screen.getByText(/submitted for review/i))
      .toBeInTheDocument();
    expect(window.dataLayer).toEqual([{ event: "nonprofit_signup" }]);

    // outbox event
    const events = await get_outbox_events();
    expect(events.some((e) => e.id === "reg-updated")).toBe(true);
  }, 60_000);
});

describe("E2E: non-US path (FSA)", () => {
  it("threads contact → org → FSA docs → sign → banking → review → submit", async () => {
    const id = await create_reg(INTL_IDENTITY);
    clear_qstash_events();
    const screen = await render_registration(id);

    // --- step 1: contact details ---
    await expect.element(screen.getByLabelText(/first name/i)).toBeVisible();

    await screen.getByLabelText(/first name/i).fill("Alice");
    await screen.getByLabelText(/last name/i).fill("Smith");
    await screen.getByLabelText(/phone number/i).fill("9876543210");
    await screen.getByLabelText(/organization name/i).fill("Global Aid");

    await screen.getByRole("combobox", { name: /what's your role/i }).click();
    await expect.element(screen.getByText("CEO")).toBeVisible();
    await screen.getByText("CEO").click();

    await screen.getByRole("combobox", { name: /how did you find/i }).click();
    await expect.element(screen.getByText("Search engines")).toBeVisible();
    await screen.getByText("Search engines").click();

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    // --- step 2: org details (non-US) ---
    await expect.element(screen.getByLabelText(/website/i)).toBeVisible();

    await screen.getByLabelText(/website/i).fill("globalaid.org");

    // hq country came from the first screen and is not re-asked
    await expect
      .element(screen.getByPlaceholder("Select a country"))
      .not.toBeInTheDocument();

    await screen.getByRole("combobox", { name: /designation/i }).click();
    await expect.element(screen.getByText("Charity")).toBeVisible();
    await screen.getByText("Charity").click();

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    // --- step 3: fiscal-sponsorship agreement ---
    await expect
      .element(screen.getByLabelText(/registration number/i))
      .toBeVisible();

    await screen.getByLabelText(/registration number/i).fill("abc123xyz");
    await screen.getByLabelText(/legal entity/i).fill("Nonprofit Corporation");
    await screen
      .getByLabelText(/charitable activities/i)
      .fill("Providing humanitarian aid globally");

    // fill file dropzones (proof of identity + proof of registration)
    const dropzones = screen.getByTestId("file-dropzone");
    const poi_dropzone = dropzones.elements()[0];
    const poi_input = page.elementLocator(poi_dropzone).getByRole("textbox");
    await poi_input.fill(doc("passport.pdf"));
    const por_dropzone = dropzones.elements()[1];
    const por_input = page.elementLocator(por_dropzone).getByRole("textbox");
    await por_input.fill(doc("registration.pdf"));

    // click Sign — triggers fsa-action
    await screen.getByRole("button", { name: /sign/i }).click();

    // fsa-action writes docs to DB, redirects to sign-result
    // sign-result loader seeds o_fsa_signed_doc_url, redirects to step 4

    // --- step 4: banking ---
    await expect
      .element(screen.getByText(/bank account currency/i))
      .toBeVisible();

    // assert o_registration_number written to DB
    const mid_row = await get_reg(id);
    expect(mid_row.o_registration_number).toBe("abc123xyz");
    expect(mid_row.o_fsa_signed_doc_url).toBe(
      "https://example.com/signed-fsa.pdf"
    );

    // select currency EUR
    const currency_input = screen.getByRole("combobox", {
      name: /currency/i,
    });
    // wait for combobox to be enabled (currencies load async)
    await vi.waitFor(() => {
      expect(currency_input.element()).not.toBeDisabled();
    });
    await currency_input.clear();
    await currency_input.fill("EUR");
    await expect
      .element(screen.getByRole("option", { name: /EUR/i }))
      .toBeVisible();
    await screen.getByRole("option", { name: /EUR/i }).click();

    // wait for requirements
    await expect.element(screen.getByPlaceholder("Jane Doe")).toBeVisible();

    await screen.getByPlaceholder("Jane Doe").fill("Alice Smith");
    await screen
      .getByPlaceholder("DE89370400440532013000")
      .fill("DE89370400440532013000");

    // bank statement upload
    const bank_dropzones = screen.getByTestId("file-dropzone");
    const bank_stmt_dropzone =
      bank_dropzones.elements()[bank_dropzones.elements().length - 1];
    const bank_stmt_input = page
      .elementLocator(bank_stmt_dropzone)
      .getByRole("textbox");
    await bank_stmt_input.fill(doc("bank.pdf"));

    await screen.getByRole("button", { name: /submit/i }).click();

    // --- step 5: review ---
    await expect.element(screen.getByText(/summary/i)).toBeVisible();

    // the agreement gets its own row for an international org
    await expect
      .element(screen.getByText(/fiscal sponsorship agreement/i))
      .toBeInTheDocument();

    const row = await get_reg(id);
    expect(row.r_first_name).toBe("Alice");
    expect(row.o_hq_country).toBe("Canada");
    expect(row.o_type).toBe("other");
    expect(row.o_registration_number).toBe("abc123xyz");
    expect(row.o_bank_id).toBe("999");
    expect(row.status).toBe("01");

    // submit
    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await vi.waitFor(async () => {
      const r = await get_reg(id);
      expect(r.status).toBe("02");
    });

    await expect
      .element(screen.getByText(/submitted for review/i))
      .toBeInTheDocument();
  }, 60_000);
});

describe("E2E: back navigation", () => {
  it("navigates back through steps with pre-filled values", async () => {
    const { id } = await seed_reg(
      { ...CONTACT_FIELDS, ...ORG_FIELDS },
      INTL_IDENTITY
    );
    const screen = await render_registration(id, "3");

    // step 3 renders (the agreement)
    await expect.element(screen.getByLabelText(/legal entity/i)).toBeVisible();

    // click Back → step 2
    await screen.getByRole("link", { name: /back/i }).click();

    // step 2: org details pre-filled
    await expect.element(screen.getByLabelText(/website/i)).toBeVisible();
    // input strips "https://" prefix
    await expect
      .element(screen.getByLabelText(/website/i))
      .toHaveDisplayValue("example.com");

    // click Back → step 1
    await screen.getByRole("link", { name: /back/i }).click();

    // step 1: contact details pre-filled
    await expect.element(screen.getByLabelText(/first name/i)).toBeVisible();
    await expect
      .element(screen.getByLabelText(/first name/i))
      .toHaveDisplayValue("Jane");
    await expect
      .element(screen.getByLabelText(/last name/i))
      .toHaveDisplayValue("Doe");
  }, 30_000);
});

describe("E2E: the agreement step is closed to a 501(c)(3)", () => {
  it("sends a US applicant landing on step 3 to banking instead", async () => {
    const { id } = await seed_reg({ ...CONTACT_FIELDS, ...ORG_FIELDS });
    const screen = await render_registration(id, "3");

    await expect
      .element(screen.getByText(/bank account currency/i))
      .toBeVisible();
    await expect
      .element(screen.getByLabelText(/legal entity/i))
      .not.toBeInTheDocument();
  }, 30_000);

  // legacy rows split o_type and o_ein across two steps, so "501c3 with no
  // EIN" is a real stored shape sitting AT step 3. redirecting it forward
  // fights step_loader sending it back — ping-pong into a hard error page.
  // falling through to an unfinishable form is the trade; the Change link in
  // the chrome is the way out (see "changing the organization type" below).
  it("does not bounce a legacy 501(c)(3) that has no EIN", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      o_ein: null,
    });
    const screen = await render_registration(id, "3");

    // renders rather than redirecting anywhere
    await expect.element(screen.getByLabelText(/legal entity/i)).toBeVisible();
    await expect
      .element(screen.getByText(/bank account currency/i))
      .not.toBeInTheDocument();
  }, 30_000);
});

// --- changing the organization type + identity ---

describe("E2E: changing the organization type", () => {
  beforeEach(async () => {
    await test_db.current!.db.delete(user_npo_memberships);
    await test_db.current!.db.delete(npos);
  });

  // prod rows exist with no o_type at all: `Progress.org_type` is undefined
  // for them, so the agreement and the EIN branch are both closed and the
  // wizard has nowhere to send them. the Change link is their only way out.
  it("gets a row with no organization type past the agreement step", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      o_type: null,
      o_ein: null,
    });
    const screen = await render_registration(id, "3");

    await expect
      .element(screen.getByText(/organization type not set/i))
      .toBeVisible();

    await screen.getByRole("link", { name: /change/i }).click();

    await screen
      .getByLabelText(/employer identification number/i)
      .fill("12-3456789");
    await screen.getByRole("button", { name: /save/i }).click();

    // a 501(c)(3) has no agreement to sign — banking is the next open step
    await expect
      .element(screen.getByText(/bank account currency/i))
      .toBeVisible();

    const row = await get_reg(id);
    expect(row.o_type).toBe("501c3");
    expect(row.o_ein).toBe("123456789");
    expect(row.o_hq_country).toBe("United States");
  }, 40_000);

  // prod rows also carry a type with no EIN under it — the same dead end,
  // reached from the other side.
  it("gets a 501(c)(3) with no EIN past the agreement step", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      o_ein: null,
    });
    const screen = await render_registration(id, "3");

    await expect
      .element(screen.getByText(/U\.S\. 501\(c\)\(3\)/))
      .toBeVisible();

    await screen.getByRole("link", { name: /change/i }).click();
    await screen
      .getByLabelText(/employer identification number/i)
      .fill("987654321");
    await screen.getByRole("button", { name: /save/i }).click();

    await expect
      .element(screen.getByText(/bank account currency/i))
      .toBeVisible();

    const row = await get_reg(id);
    expect(row.o_ein).toBe("987654321");
  }, 40_000);

  it("drops a signed agreement when the type switches to 501(c)(3)", async () => {
    const { id } = await seed_reg(
      {
        ...CONTACT_FIELDS,
        ...ORG_FIELDS,
        ...FSA_DOC_FIELDS,
        ...BANKING_FIELDS,
        o_fsa_signing_url: "https://example.com/sign",
        o_fsa_signed_doc_url: "https://example.com/signed-fsa.pdf",
        o_fsa_doc_eid: "docGroupEid",
      },
      INTL_IDENTITY
    );
    const screen = await render_registration(id, "5");

    await screen.getByRole("link", { name: /change/i }).click();

    await screen.getByText("U.S. 501(c)(3)").click();
    await screen
      .getByLabelText(/employer identification number/i)
      .fill("987654321");
    await screen.getByRole("button", { name: /save/i }).click();

    // banking survives and a 501(c)(3) needs no agreement, so review is next
    await expect.element(screen.getByText(/summary/i)).toBeVisible();

    const row = await get_reg(id);
    // an agreement signed as a Canadian charity says nothing about an EIN
    expect(row.o_fsa_signing_url).toBeNull();
    expect(row.o_fsa_signed_doc_url).toBeNull();
    // the eid goes with them: it is what authorizes the download, so a
    // surviving one leaves the superseded agreement open to its link holder
    expect(row.o_fsa_doc_eid).toBeNull();
    // and neither do the two documents describing that legal entity
    expect(row.o_legal_entity_type).toBeNull();
    expect(row.o_proof_of_reg).toBeNull();
    // the work itself and the registrant's own id are not entity claims
    expect(row.o_project_description).toBe(
      FSA_DOC_FIELDS.o_project_description
    );
    expect(row.r_proof_of_identity).toBe(FSA_DOC_FIELDS.r_proof_of_identity);
    // the other branch's identity column goes with it
    expect(row.o_registration_number).toBeNull();
    expect(row.o_type).toBe("501c3");
    expect(row.o_ein).toBe("987654321");
    expect(row.o_hq_country).toBe("United States");
  }, 40_000);

  // the type stays "other" throughout — it is the country that names a
  // different legal entity, and the old entity's papers go with it.
  it("drops a signed agreement when an international org changes country", async () => {
    const { id } = await seed_reg(
      {
        ...CONTACT_FIELDS,
        ...ORG_FIELDS,
        ...FSA_DOC_FIELDS,
        ...BANKING_FIELDS,
        o_fsa_signing_url: "https://example.com/sign",
        o_fsa_signed_doc_url: "https://example.com/signed-fsa.pdf",
        o_fsa_doc_eid: "docGroupEid",
      },
      INTL_IDENTITY
    );
    const screen = await render_registration(id, "5");

    await screen.getByRole("link", { name: /change/i }).click();

    await screen.getByPlaceholder("Select a country").fill("Kenya");
    await expect
      .element(screen.getByRole("option", { name: /Kenya/i }).nth(0))
      .toBeVisible();
    await screen.getByRole("option", { name: /Kenya/i }).nth(0).click();
    await screen.getByRole("button", { name: /save/i }).click();

    // the agreement is unfinished again, so that is where the wizard lands
    await expect.element(screen.getByLabelText(/legal entity/i)).toBeVisible();

    const row = await get_reg(id);
    expect(row.o_hq_country).toBe("Kenya");
    expect(row.o_type).toBe("other");
    expect(row.o_fsa_signing_url).toBeNull();
    expect(row.o_fsa_signed_doc_url).toBeNull();
    expect(row.o_fsa_doc_eid).toBeNull();
    expect(row.o_legal_entity_type).toBeNull();
    expect(row.o_proof_of_reg).toBeNull();
  }, 40_000);

  it("keeps the papers when the identity is re-submitted unchanged", async () => {
    const { id } = await seed_reg(
      {
        ...CONTACT_FIELDS,
        ...ORG_FIELDS,
        ...FSA_DOC_FIELDS,
        ...BANKING_FIELDS,
        o_fsa_signing_url: "https://example.com/sign",
        o_fsa_signed_doc_url: "https://example.com/signed-fsa.pdf",
        o_fsa_doc_eid: "docGroupEid",
      },
      INTL_IDENTITY
    );
    const screen = await render_registration(id, "5");

    await screen.getByRole("link", { name: /change/i }).click();
    await screen.getByRole("button", { name: /save/i }).click();

    await expect.element(screen.getByText(/summary/i)).toBeVisible();

    const row = await get_reg(id);
    expect(row.o_fsa_signed_doc_url).toBe("https://example.com/signed-fsa.pdf");
    expect(row.o_fsa_doc_eid).toBe("docGroupEid");
    expect(row.o_legal_entity_type).toBe(FSA_DOC_FIELDS.o_legal_entity_type);
    expect(row.o_proof_of_reg).toBe(FSA_DOC_FIELDS.o_proof_of_reg);
  }, 40_000);

  // `Progress` derives the step from the columns, so nothing has to walk the
  // applicant back — the agreement simply becomes unfinished again.
  it("falls back to the agreement when a 501(c)(3) at banking goes international", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      ...BANKING_FIELDS,
    });
    const screen = await render_registration(id, "5");

    await screen.getByRole("link", { name: /change/i }).click();

    await screen.getByText("International").click();
    await screen.getByPlaceholder("Select a country").fill("Kenya");
    await expect
      .element(screen.getByRole("option", { name: /Kenya/i }).nth(0))
      .toBeVisible();
    await screen.getByRole("option", { name: /Kenya/i }).nth(0).click();
    await screen.getByLabelText(/registration number/i).fill("KE-99");
    await screen.getByRole("button", { name: /save/i }).click();

    await expect.element(screen.getByLabelText(/legal entity/i)).toBeVisible();

    const row = await get_reg(id);
    expect(row.o_type).toBe("other");
    expect(row.o_ein).toBeNull();
    expect(row.o_hq_country).toBe("Kenya");
    expect(row.o_registration_number).toBe("ke-99");
  }, 40_000);

  it("blocks a switch onto an identity an owned listing already holds", async () => {
    const npo = await seed_npo({ registration_number: "999888777" });
    await seed_member(npo.id);

    const { id } = await seed_reg({ ...CONTACT_FIELDS, ...ORG_FIELDS });
    const screen = await render_registration(id, "4");

    await screen.getByRole("link", { name: /change/i }).click();

    const ein = screen.getByLabelText(/employer identification number/i);
    // the stored ein is bare digits; the field masks it on the way in and out
    await expect.element(ein).toHaveValue("12-3456789");
    await ein.clear();
    await ein.fill("999888777");
    await expect.element(ein).toHaveValue("99-9888777");
    await screen.getByRole("button", { name: /save/i }).click();

    await expect.element(screen.getByText(/already registered/i)).toBeVisible();

    const row = await get_reg(id);
    expect(row.o_ein).toBe("123456789");
  }, 40_000);

  it("offers no way in once the application is in review", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      ...BANKING_FIELDS,
      status: "02",
    });
    const screen = await render_registration(id, "5");

    // the identity is still shown — it is only the correction that closes
    await expect.element(screen.getByText(/EIN 123456789/)).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /change/i }))
      .not.toBeInTheDocument();
  }, 20_000);
});

describe("E2E: dashboard update", () => {
  it("clicking Update navigates to step, submitting goes to next step", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      ...BANKING_FIELDS,
    });
    clear_qstash_events();
    const screen = await render_registration(id, "5");

    // dashboard renders
    await expect.element(screen.getByText(/summary/i)).toBeVisible();

    // click Update on step 1 (Contact Details)
    const step_rows = screen.getByText("Update", { exact: true });
    await step_rows.nth(0).click(); // first Update link = step 1

    // lands on step 1
    await expect.element(screen.getByLabelText(/first name/i)).toBeVisible();
    await expect
      .element(screen.getByLabelText(/first name/i))
      .toHaveDisplayValue("Jane");

    // change first name
    await screen.getByLabelText(/first name/i).clear();
    await screen.getByLabelText(/first name/i).fill("Janet");

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    // prog.step === 5 (all steps complete) → redirects back to the summary
    await expect.element(screen.getByText(/summary/i)).toBeVisible();

    // verify DB updated
    const row = await get_reg(id);
    expect(row.r_first_name).toBe("Janet");
  }, 30_000);

  // the agreement names the registrant, so renaming them unsigns it. what has
  // to go with it is the eid: it is what `is_fsa_doc_eid` recognises the
  // document by, and therefore what keeps the superseded one downloadable
  // without a session.
  it("drops the agreement and its eid when the registrant is renamed", async () => {
    const { id } = await seed_reg(
      {
        ...CONTACT_FIELDS,
        ...ORG_FIELDS,
        ...FSA_DOC_FIELDS,
        ...BANKING_FIELDS,
        o_fsa_signing_url: "https://example.com/sign",
        o_fsa_signed_doc_url: "https://example.com/signed-fsa.pdf",
        o_fsa_doc_eid: "docGroupEid",
      },
      INTL_IDENTITY
    );
    const screen = await render_registration(id, "5");

    await expect.element(screen.getByText(/summary/i)).toBeVisible();
    await screen.getByText("Update", { exact: true }).nth(0).click();

    await expect
      .element(screen.getByLabelText(/first name/i))
      .toHaveDisplayValue("Jane");
    await screen.getByLabelText(/first name/i).clear();
    await screen.getByLabelText(/first name/i).fill("Janet");
    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    // the agreement is unfinished again, so the summary bounces back to it
    await expect.element(screen.getByLabelText(/legal entity/i)).toBeVisible();

    const row = await get_reg(id);
    expect(row.r_first_name).toBe("Janet");
    expect(row.o_fsa_signing_url).toBeNull();
    expect(row.o_fsa_signed_doc_url).toBeNull();
    expect(row.o_fsa_doc_eid).toBeNull();
  }, 40_000);
});

describe("E2E: submitted state disables dashboard", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("status 02 shows in-review and disables Update links", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      ...BANKING_FIELDS,
      status: "02",
    });
    const screen = await render_registration(id, "5");

    // dashboard renders
    await expect.element(screen.getByText(/summary/i)).toBeVisible();

    // shows in-review message
    await expect
      .element(screen.getByText(/submitted for review/i))
      .toBeInTheDocument();

    // all Update links are disabled
    const update_links = screen.getByRole("link", { name: /update/i });
    for (const link of update_links.elements()) {
      expect(link).toHaveAttribute("aria-disabled", "true");
    }

    // no Continue or Resubmit button
    await expect
      .element(screen.getByRole("button", { name: /^continue\b/i }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /resubmit/i }))
      .not.toBeInTheDocument();
    // a returning visitor is not a conversion
    expect(window.dataLayer).toEqual([]);
  }, 15_000);

  it("a refused submit pushes no conversion", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      ...BANKING_FIELDS,
    });
    const screen = await render_registration(id, "5");
    await expect.element(screen.getByText(/summary/i)).toBeVisible();

    set_authed("mallory@example.com");
    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await expect
      .element(screen.getByRole("button", { name: /^continue\b/i }))
      .not.toBeInTheDocument();
    expect((await get_reg(id)).status).toBe("01");
    expect(window.dataLayer).toEqual([]);
  }, 15_000);

  it("resubmitting a rejected application pushes no conversion", async () => {
    const { id } = await seed_reg({
      ...CONTACT_FIELDS,
      ...ORG_FIELDS,
      ...BANKING_FIELDS,
      status: "04",
    });
    const screen = await render_registration(id, "5");

    await screen.getByRole("button", { name: /resubmit/i }).click();

    await expect
      .element(screen.getByText(/submitted for review/i))
      .toBeInTheDocument();
    expect(window.dataLayer).toEqual([]);
  }, 15_000);
});

// --- reg_put: seed data ---

describe("reg_put — seed data", () => {
  it("pre-fills referral method and code when referrer provided", async () => {
    const id = await reg_put({
      r_id: TEST_EMAIL,
      ...US_IDENTITY,
      referrer: "ABC123",
    });

    const row = await get_reg(id);
    expect(row.rm).toBe("referral");
    expect(row.rm_referral_code).toBe("ABC123");
  });
});

// --- new_application: org type + identity, duplicate check ---

async function seed_npo(
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) {
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({
      registration_number: "123456789",
      name: "Existing NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: false,
      active: true,
      ...overrides,
    })
    .returning();
  return row;
}

async function seed_member(npo_id: number) {
  await test_db
    .current!.db.insert(user)
    .values({
      id: `member-${npo_id}`,
      name: "Member",
      email: `member-${npo_id}@example.com`,
      first_name: "Mem",
      last_name: "Ber",
    })
    .onConflictDoNothing();
  await test_db
    .current!.db.insert(user_npo_memberships)
    .values({ user_id: `member-${npo_id}`, npo_id })
    .onConflictDoNothing();
}

/** the request and the normalized url an action receives alongside it */
function start_args(url = "https://bg.test/register") {
  return [new Request(url, { method: "POST" }), new URL(url)] as const;
}

async function all_regs() {
  return test_db.current!.db.select().from(registrations);
}

describe("new_application", () => {
  beforeEach(async () => {
    await test_db.current!.db.delete(user_npo_memberships);
    await test_db.current!.db.delete(npos);
    set_authed();
  });

  it("writes o_type, o_ein and hq country together on the US branch", async () => {
    const res = await new_application(
      ...start_args(),
      createFormData({ o_type: "501c3", o_ein: "12-3456789" })
    );

    const [row] = await all_regs();
    expect(row.o_type).toBe("501c3");
    expect(row.o_ein).toBe("123456789");
    // `Progress.org` requires hq country and no step asks for it
    expect(row.o_hq_country).toBe("United States");
    expect((res as Response).headers.get("location")).toBe(
      `/register/${row.id}/1`
    );
  });

  it("leaves the application able to reach review", async () => {
    // Progress derives the step from non-null columns: `docs_ein` is undefined
    // unless o_type === "501c3", and `org` is undefined without o_hq_country.
    // an identity written without either silently caps the application at a
    // step nobody can pass, with no error anywhere.
    await new_application(
      ...start_args(),
      createFormData({ o_type: "501c3", o_ein: "123456789" })
    );
    const [created] = await all_regs();
    await test_db
      .current!.db.update(registrations)
      .set({ ...CONTACT_FIELDS, ...ORG_FIELDS, ...BANKING_FIELDS })
      .where(eq(registrations.id, created.id));

    const row = await get_reg(created.id);
    expect(new Progress(row as unknown as IReg, true).step).toBe(5);
  });

  it("writes o_type together with country + registration number on the international branch", async () => {
    await new_application(
      ...start_args(),
      createFormData({
        o_type: "other",
        o_hq_country: "Kenya",
        o_registration_number: "KE-99 ",
      })
    );

    const [row] = await all_regs();
    expect(row.o_type).toBe("other");
    expect(row.o_hq_country).toBe("Kenya");
    expect(row.o_registration_number).toBe("ke-99");
    expect(row.o_ein).toBeNull();
  });

  it("keeps the referrer query as a referral code", async () => {
    await new_application(
      ...start_args("https://bg.test/register?referrer=ABC123"),
      createFormData({ o_type: "501c3", o_ein: "123456789" })
    );

    const [row] = await all_regs();
    expect(row.rm).toBe("referral");
    expect(row.rm_referral_code).toBe("ABC123");
  });

  it("rejects an EIN that is not 9 digits without creating anything", async () => {
    const res = await new_application(
      ...start_args(),
      createFormData({ o_type: "501c3", o_ein: "12345" })
    );

    expect((res as any).errors?.o_ein).toBeTruthy();
    expect(await all_regs()).toHaveLength(0);
  });

  // valibotResolver runs with abortPipeEarly unless criteriaMode is "all", so a
  // submission surfaces one identity issue at a time — each blank field has to
  // carry a message that stands on its own
  it("faults a blank registration number under its own field", async () => {
    const res = await new_application(
      ...start_args(),
      createFormData({ o_type: "other", o_hq_country: "Kenya" })
    );

    const { errors } = res as any;
    expect(errors.o_registration_number.message).toBe(
      "Enter your registration number."
    );
    expect(errors.o_hq_country).toBeUndefined();
    expect(await all_regs()).toHaveLength(0);
  });

  it("faults a blank country under its own field", async () => {
    const res = await new_application(
      ...start_args(),
      createFormData({ o_type: "other", o_registration_number: "KE-99" })
    );

    const { errors } = res as any;
    expect(errors.o_hq_country.message).toBe(
      "Select your country of registration."
    );
    expect(errors.o_registration_number).toBeUndefined();
    expect(await all_regs()).toHaveLength(0);
  });

  it("blocks when the identity matches an npo that has members", async () => {
    const npo = await seed_npo({ registration_number: "123456789" });
    await seed_member(npo.id);

    const res = await new_application(
      ...start_args(),
      createFormData({ o_type: "501c3", o_ein: "123456789" })
    );

    expect((res as any).duplicate).toMatchObject({ name: "Existing NPO" });
    expect(await all_regs()).toHaveLength(0);
  });

  it("blocks on a member-backed match that differs only by case and whitespace", async () => {
    const npo = await seed_npo({
      registration_number: " AB123 ",
      hq_country: "Kenya",
    });
    await seed_member(npo.id);

    const res = await new_application(
      ...start_args(),
      createFormData({
        o_type: "other",
        o_hq_country: "Kenya",
        o_registration_number: "ab123",
      })
    );

    expect((res as any).duplicate).toBeTruthy();
    expect(await all_regs()).toHaveLength(0);
  });

  it("passes straight through when the matching npo has no members", async () => {
    // an imported listing with zero memberships is not an owner
    await seed_npo({ registration_number: "123456789" });

    const res = await new_application(
      ...start_args(),
      createFormData({ o_type: "501c3", o_ein: "123456789" })
    );

    const [row] = await all_regs();
    expect((res as any).duplicate).toBeUndefined();
    expect(row.o_type).toBe("501c3");
    expect(row.o_ein).toBe("123456789");
    // nothing is carried over from the unowned listing
    expect(row.o_name).toBeNull();
    expect((res as Response).headers.get("location")).toBe(
      `/register/${row.id}/1`
    );
  });

  it("does not match a member-backed npo in another country", async () => {
    const npo = await seed_npo({
      registration_number: "ab123",
      hq_country: "Kenya",
    });
    await seed_member(npo.id);

    await new_application(
      ...start_args(),
      createFormData({
        o_type: "other",
        o_hq_country: "Uganda",
        o_registration_number: "ab123",
      })
    );

    expect(await all_regs()).toHaveLength(1);
  });
});

// --- the start screen ---

function render_start() {
  set_authed();
  const Stub = createRoutesStub([
    {
      path: "/register",
      HydrateFallback: () => null,
      children: [
        {
          index: true,
          Component: StartScreen,
          loader: start_loader,
          action: start_action,
        },
      ],
    },
    {
      path: "/register/:reg_id/1",
      Component: () => <p>contact details</p>,
    },
  ]);
  return render(<Stub initialEntries={["/register"]} />);
}

describe("E2E: start screen", () => {
  beforeEach(async () => {
    await test_db.current!.db.delete(user_npo_memberships);
    await test_db.current!.db.delete(npos);
    window.dataLayer = [];
  });

  it("starts a US application and lands in the wizard", async () => {
    const screen = await render_start();

    const ein = screen.getByLabelText(/employer identification number/i);
    await ein.fill("12-3456789");
    // a pasted, already-dashed ein survives the mask unchanged
    await expect.element(ein).toHaveValue("12-3456789");
    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await expect.element(screen.getByText(/contact details/i)).toBeVisible();

    const [row] = await all_regs();
    expect(row.o_type).toBe("501c3");
    expect(row.o_ein).toBe("123456789");

    // both forms live at /register now, so the page path can't tell starting
    // an application apart from resuming one — the event has to
    expect(window.dataLayer).toContainEqual({
      event: "reg_start",
      org_type: "501c3",
    });
  }, 20_000);

  it("swaps to the international fields and writes country + registration number", async () => {
    const screen = await render_start();

    await screen.getByText("International").click();
    await expect
      .element(screen.getByPlaceholder("Select a country"))
      .toBeVisible();

    await screen.getByPlaceholder("Select a country").fill("Kenya");
    await expect
      .element(screen.getByRole("option", { name: /Kenya/i }).nth(0))
      .toBeVisible();
    await screen.getByRole("option", { name: /Kenya/i }).nth(0).click();
    await screen.getByLabelText(/registration number/i).fill("KE-99");

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await expect.element(screen.getByText(/contact details/i)).toBeVisible();

    const [row] = await all_regs();
    expect(row.o_type).toBe("other");
    expect(row.o_hq_country).toBe("Kenya");
    expect(row.o_registration_number).toBe("ke-99");

    expect(window.dataLayer).toContainEqual({
      event: "reg_start",
      org_type: "other",
    });
  }, 20_000);

  it("asks only for the registration number when the country is filled", async () => {
    const screen = await render_start();

    await screen.getByText("International").click();
    await screen.getByPlaceholder("Select a country").fill("Kenya");
    await screen.getByRole("option", { name: /Kenya/i }).nth(0).click();

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    // exact: a message naming both fields would not match
    await expect
      .element(
        screen.getByText("Enter your registration number.", { exact: true })
      )
      .toBeVisible();
    expect(
      screen
        .getByText("Select your country of registration.", { exact: true })
        .query()
    ).toBeNull();
  }, 20_000);

  it("asks only for the country when the registration number is filled", async () => {
    const screen = await render_start();

    await screen.getByText("International").click();
    await screen.getByLabelText(/registration number/i).fill("KE-99");

    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await expect
      .element(
        screen.getByText("Select your country of registration.", {
          exact: true,
        })
      )
      .toBeVisible();
    expect(
      screen
        .getByText("Enter your registration number.", { exact: true })
        .query()
    ).toBeNull();
  }, 20_000);

  // truncating to 9 would hand the duplicate check an ein nobody typed
  it("stops an over-length ein at nine digits", async () => {
    const screen = await render_start();

    const ein = screen.getByLabelText(/employer identification number/i);
    await ein.fill("123456789012");
    await expect.element(ein).toHaveValue("12-3456789");
  }, 20_000);

  it("asks for both international fields when neither is filled", async () => {
    const screen = await render_start();

    await screen.getByText("International").click();
    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await expect
      .element(
        screen.getByText("Select your country of registration.", {
          exact: true,
        })
      )
      .toBeVisible();
    // the number's message is the number field's own error node, not a
    // second copy hanging off the country
    await vi.waitFor(() =>
      expect(
        screen.container.querySelector("#__error_o_registration_number")
          ?.textContent
      ).toBe("Enter your registration number.")
    );
    expect(await all_regs()).toHaveLength(0);
  }, 20_000);

  it("shows the already-registered modal instead of starting a duplicate", async () => {
    const npo = await seed_npo({ registration_number: "123456789" });
    await seed_member(npo.id);

    const screen = await render_start();

    await screen
      .getByLabelText(/employer identification number/i)
      .fill("123456789");
    await screen.getByRole("button", { name: "Continue", exact: true }).click();

    await expect.element(screen.getByText(/already registered/i)).toBeVisible();
    expect(await all_regs()).toHaveLength(0);
  }, 20_000);

  it("resumes from the strip without touching the start form's errors", async () => {
    const id = await create_reg();
    const screen = await render_start();

    // an invalid start submission leaves its own error
    await screen.getByLabelText(/employer identification number/i).fill("123");
    await screen.getByRole("button", { name: "Continue", exact: true }).click();
    await expect.element(screen.getByText(/valid 9-digit EIN/i)).toBeVisible();

    // a submission the client rejected never reached the server, so it is not
    // a start
    expect(window.dataLayer).toHaveLength(0);

    // the resume strip is unaffected and navigates on its own
    await screen.getByLabelText(/registration reference/i).fill(id);
    await screen.getByRole("button", { name: /resume/i }).click();

    await expect.element(screen.getByText(/contact details/i)).toBeVisible();

    expect(window.dataLayer).toEqual([{ event: "reg_resume" }]);
  }, 20_000);
});
