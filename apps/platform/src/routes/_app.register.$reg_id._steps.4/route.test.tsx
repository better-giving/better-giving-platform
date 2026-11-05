import { AskHost } from "@better-giving/ui";
import { eq } from "drizzle-orm";
import { createRoutesStub, Outlet } from "react-router";
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
import { cleanup, render } from "vitest-browser-react";
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

vi.mock("$/kit/queue", () => ({
  receiver: {},
  client: {},
  enqueue: vi.fn(async () => {}),
  don_dist: vi.fn(),
  verify_qstash: vi.fn(),
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    session: true,
    user_ctx: true,
  })
);

// stripe's live answer for a linked account
const account_status_live = vi.hoisted(() => vi.fn());
vi.mock("$/stripe-connect/sync", () => ({ account_status_live }));

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

// the step hands `BankDetails` an `onSubmit` and owns no error surface of its
// own — the wiring under test is what the step does with the result, so the
// form itself stands in as a button that fires the callback.
const bank_statement = vi.hoisted(() => ({
  url: "https://example.com/bank.pdf",
}));

vi.mock("#/components/bank-details", () => ({
  BankDetails: ({ onSubmit, is_loading }: any) => (
    <button
      type="button"
      disabled={is_loading}
      onClick={() =>
        onSubmit(
          { id: 999, currency: "usd", details: { accountNumber: "12345678" } },
          bank_statement.url
        )
      }
    >
      submit bank details
    </button>
  ),
}));

// --- imports (after mocks hoisted) ---

import { get_session } from "#/.server/auth";
import { reg_put } from "$/pg/queries/registration";
import { create_test_db } from "$/pg/test-utils/pglite";
import Banking, { action, loader } from "./route";

const mock_get_session = vi.mocked(get_session);
const TEST_EMAIL = "test@example.com";

// --- setup ---

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await cleanup();
  await test_db.current!.db.delete(registrations);
  bank_statement.url = "https://example.com/bank.pdf";
  account_status_live.mockReset();
  routing.on = true;
  mock_get_session.mockReset();
  mock_get_session.mockResolvedValue({
    user: {
      id: "test-user-id",
      email: TEST_EMAIL,
      role: null,
      name: TEST_EMAIL,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      first_name: "Test",
      last_name: "User",
    } as any,
  });
});

// --- helpers ---

// the first screen collects org type + identity; contact + org details are what
// `Progress` reads to put the applicant on step 4
const STEP_4_FIELDS = {
  r_first_name: "Jane",
  r_last_name: "Doe",
  r_contact_number: "1234567890",
  o_name: "Test Org",
  r_org_role: "ceo",
  rm: "search-engines",
  o_website: "https://example.com",
  o_designation: "Charity",
} as const;

async function seed_step_4() {
  const id = await reg_put({
    r_id: TEST_EMAIL,
    o_type: "501c3",
    o_ein: "123456789",
    o_hq_country: "United States",
  });
  await test_db
    .current!.db.update(registrations)
    .set(STEP_4_FIELDS)
    .where(eq(registrations.id, id));
  return id;
}

async function save_bank(
  id: string,
  extra: { o_stripe_account_id?: string } = {}
) {
  await test_db
    .current!.db.update(registrations)
    .set({
      o_bank_id: "999",
      o_bank_statement: "https://example.com/bank.pdf",
      ...extra,
    })
    .where(eq(registrations.id, id));
}

const EMPTY_INTRO =
  "Grants are sent to this account through Wise, a money-transfer service, in the currency you choose. Every kind of donation can pay out here, every 3 days once your balance reaches your payout minimum.";
const SAVED_INTRO =
  "Grants are sent to this account through Wise, a money-transfer service, every 3 days once your balance reaches your payout minimum.";
const STRIPE_LATER =
  "Stripe is optional. You can connect it right after your bank details are saved.";

function render_step_4(id: string, search = "") {
  const Stub = createRoutesStub([
    {
      path: "/register/:reg_id",
      // the step's failure prompt is raised through `ask`, which mounts at
      // `AskHost`. it goes on the layout rather than around the step, whose
      // component takes `loaderData` as a prop.
      Component: () => (
        <>
          <Outlet />
          <AskHost />
        </>
      ),
      HydrateFallback: () => null,
      children: [
        {
          path: "4",
          Component: Banking,
          loader: loader as any,
          action: action as any,
        },
        { path: "5", Component: () => <p>summary</p> },
        { path: "2", Component: () => <p>org details</p> },
      ],
    },
  ]);
  return render(<Stub initialEntries={[`/register/${id}/4${search}`]} />);
}

// --- tests ---

describe("registration step 4: banking", () => {
  it("surfaces the failure when the update is rejected", async () => {
    // a bank statement url the action's schema rejects
    bank_statement.url = "not-a-url";
    const id = await seed_step_4();
    const screen = await render_step_4(id);

    await screen.getByRole("button", { name: /submit bank details/i }).click();

    // a 4xx is the user's to act on, so the action's own message is shown
    await expect.element(screen.getByText(/invalid url/i)).toBeInTheDocument();

    // nothing was written
    const [row] = await test_db
      .current!.db.select()
      .from(registrations)
      .where(eq(registrations.id, id));
    expect(row.o_bank_id).toBeNull();
  }, 30_000);

  it("keeps the change form open when changing a saved bank fails", async () => {
    const id = await seed_step_4();
    await save_bank(id);
    bank_statement.url = "not-a-url";
    const screen = await render_step_4(id);

    await screen.getByRole("button", { name: "Change bank details" }).click();
    await screen.getByRole("button", { name: /submit bank details/i }).click();

    await expect.element(screen.getByText(/invalid url/i)).toBeInTheDocument();
    // the prompt is modal, so the page behind it has no roles until it closes
    await screen.getByRole("button", { name: "Ok", exact: true }).click();
    await expect
      .element(screen.getByRole("region", { name: "Update your bank payout" }))
      .toBeInTheDocument();
    expect(
      screen
        .getByRole("region", { name: "Your bank payout", exact: true })
        .query()
    ).toBeNull();

    const [row] = await test_db
      .current!.db.select()
      .from(registrations)
      .where(eq(registrations.id, id));
    expect(row.o_bank_statement).toBe("https://example.com/bank.pdf");
  }, 30_000);

  it("closes the change form once a retry after a failure lands", async () => {
    const id = await seed_step_4();
    await save_bank(id);
    bank_statement.url = "not-a-url";
    const screen = await render_step_4(id);

    await screen.getByRole("button", { name: "Change bank details" }).click();
    await screen.getByRole("button", { name: /submit bank details/i }).click();
    const failure = screen.getByText(/invalid url/i);
    await expect.element(failure).toBeInTheDocument();
    await screen.getByRole("button", { name: "Ok", exact: true }).click();
    await expect.element(failure).not.toBeInTheDocument();

    bank_statement.url = "https://example.com/new.pdf";
    await screen.getByRole("button", { name: /submit bank details/i }).click();

    await expect
      .element(
        screen
          .getByRole("region", { name: "Your bank payout", exact: true })
          .getByRole("link", { name: "View bank statement" })
      )
      .toHaveAttribute("href", "https://example.com/new.pdf");
    expect(screen.getByText(/invalid url/i).query()).toBeNull();
  }, 30_000);

  // a landed save redirects back to this same route, which stays mounted, so
  // a prompt could be raised off stale `fetcher.data` once the save settles
  it("raises no prompt when the update lands", async () => {
    const id = await seed_step_4();
    const screen = await render_step_4(id);

    await screen.getByRole("button", { name: /submit bank details/i }).click();

    await expect
      .element(
        screen.getByRole("region", { name: "Your bank payout", exact: true })
      )
      .toBeInTheDocument();
    // the failure's prompt, by the text it renders on a 4xx
    expect(screen.getByText(/invalid url/i).query()).toBeNull();
    expect(screen.getByRole("dialog").query()).toBeNull();

    const [row] = await test_db
      .current!.db.select()
      .from(registrations)
      .where(eq(registrations.id, id));
    expect(row.o_bank_id).toBe("999");
  }, 30_000);

  describe("focus after the bank form closes", () => {
    const saved_heading = (screen: Awaited<ReturnType<typeof render_step_4>>) =>
      screen.getByRole("heading", { name: "Your bank payout", exact: true });

    it("moves to the saved heading once a first save lands", async () => {
      const id = await seed_step_4();
      const screen = await render_step_4(id);

      await screen
        .getByRole("button", { name: /submit bank details/i })
        .click();

      await expect.element(saved_heading(screen)).toHaveFocus();
    }, 30_000);

    it("moves to the saved heading once a change lands", async () => {
      const id = await seed_step_4();
      await save_bank(id);
      const screen = await render_step_4(id);

      await screen.getByRole("button", { name: "Change bank details" }).click();
      await screen
        .getByRole("button", { name: /submit bank details/i })
        .click();

      await expect.element(saved_heading(screen)).toHaveFocus();
    }, 30_000);

    it("is not taken by a saved bank that is there on arrival", async () => {
      const id = await seed_step_4();
      await save_bank(id);
      const screen = await render_step_4(id);

      await expect.element(saved_heading(screen)).toBeVisible();
      await expect.element(saved_heading(screen)).not.toHaveFocus();
    }, 30_000);
  });

  it("asks for the bank first, and leaves stripe for after it is saved", async () => {
    const id = await seed_step_4();
    const screen = await render_step_4(id);

    const bank = screen.getByRole("region", {
      name: "Set up your bank payout",
    });
    await expect
      .element(bank.getByText("Required", { exact: true }))
      .toBeVisible();
    await expect.element(bank.getByText(EMPTY_INTRO)).toBeVisible();
    await expect.element(bank.getByText(STRIPE_LATER)).toBeVisible();
    const explainer = screen.getByRole("region", { name: "How you get paid" });
    await expect
      .element(explainer.getByText("Compare your bank payout with Stripe."))
      .toBeVisible();
    // nothing to connect to until there is a bank to fall back on
    expect(
      screen.getByRole("region", { name: "Stripe account" }).query()
    ).toBeNull();

    // a saved bank comes back to this step, where stripe is now offered
    await screen.getByRole("button", { name: /submit bank details/i }).click();
    await expect
      .element(
        screen.getByRole("region", { name: "Your bank payout", exact: true })
      )
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("region", { name: "Stripe account" })
          .getByRole("link", { name: "Connect with Stripe" })
      )
      .toBeVisible();

    // bank details alone complete the step
    await screen.getByRole("link", { name: "Continue" }).click();
    await expect.element(screen.getByText(/summary/i)).toBeVisible();
  }, 30_000);

  it("comes back to the saved bank after a change, not to the summary", async () => {
    const id = await seed_step_4();
    await save_bank(id);
    bank_statement.url = "https://example.com/new.pdf";
    const screen = await render_step_4(id);

    await screen.getByRole("button", { name: "Change bank details" }).click();
    await screen.getByRole("button", { name: /submit bank details/i }).click();

    const bank = screen.getByRole("region", {
      name: "Your bank payout",
      exact: true,
    });
    await expect
      .element(bank.getByRole("link", { name: "View bank statement" }))
      .toHaveAttribute("href", "https://example.com/new.pdf");
    await expect
      .element(screen.getByRole("region", { name: "Stripe account" }))
      .toBeVisible();
    expect(screen.getByText(/summary/i).query()).toBeNull();
  }, 30_000);

  it("keeps a linked account's card beside the bank form", async () => {
    account_status_live.mockResolvedValue("pending");
    const id = await seed_step_4();
    await test_db
      .current!.db.update(registrations)
      .set({ o_stripe_account_id: "acct_123" })
      .where(eq(registrations.id, id));
    const screen = await render_step_4(id);

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByText("Pending review", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /submit bank details/i }))
      .toBeVisible();
  }, 30_000);

  it("shows the saved bank, then stripe, and lets the bank be changed", async () => {
    const id = await seed_step_4();
    await save_bank(id);
    const screen = await render_step_4(id);

    const bank = screen.getByRole("region", {
      name: "Your bank payout",
      exact: true,
    });
    await expect
      .element(bank.getByText("Saved", { exact: true }))
      .toBeVisible();
    await expect.element(bank.getByText(SAVED_INTRO)).toBeVisible();
    await expect
      .element(bank.getByText("Bank account reference", { exact: true }))
      .toBeVisible();
    await expect.element(bank.getByText("999", { exact: true })).toBeVisible();
    await expect
      .element(bank.getByText("Wise's reference for the account you entered."))
      .toBeVisible();
    await expect
      .element(bank.getByRole("link", { name: "View bank statement" }))
      .toHaveAttribute("href", "https://example.com/bank.pdf");
    expect(screen.getByText(STRIPE_LATER).query()).toBeNull();

    const explainer = screen.getByRole("region", { name: "How you get paid" });
    await expect
      .element(
        explainer.getByText("Your bank payout is required. Stripe is optional.")
      )
      .toBeVisible();
    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByRole("link", { name: "Connect with Stripe" }))
      .toHaveAttribute(
        "href",
        `/api/stripe-connect/start?kind=reg&reg_id=${id}`
      );
    await expect
      .element(screen.getByRole("link", { name: "Continue" }))
      .toBeVisible();

    await bank.getByRole("button", { name: "Change bank details" }).click();
    await expect
      .element(screen.getByRole("region", { name: "Update your bank payout" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /submit bank details/i }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect
      .element(
        screen.getByRole("region", { name: "Your bank payout", exact: true })
      )
      .toBeVisible();
  }, 30_000);

  describe("a registration stripe can never route to", () => {
    // outside the transfer countries
    const ineligible = async () => {
      const id = await seed_step_4();
      await test_db
        .current!.db.update(registrations)
        .set({ o_hq_country: "Brazil" })
        .where(eq(registrations.id, id));
      return id;
    };

    it("is not offered stripe beside the bank form", async () => {
      const id = await ineligible();
      const screen = await render_step_4(id);

      await expect
        .element(
          screen.getByRole("region", { name: "Set up your bank payout" })
        )
        .toBeVisible();
      expect(screen.getByText(STRIPE_LATER).query()).toBeNull();
      expect(
        screen.getByRole("region", { name: "How you get paid" }).query()
      ).toBeNull();
      expect(
        screen.getByRole("region", { name: "Stripe account" }).query()
      ).toBeNull();
    }, 30_000);

    it("is told stripe is not available once the bank is saved", async () => {
      const id = await ineligible();
      await save_bank(id, { o_stripe_account_id: "acct_123" });
      const screen = await render_step_4(id);

      const card = screen.getByRole("region", { name: "Stripe account" });
      await expect
        .element(card.getByText("Not available", { exact: true }))
        .toBeVisible();
      expect(card.getByRole("link").query()).toBeNull();
      expect(
        screen.getByRole("region", { name: "How you get paid" }).query()
      ).toBeNull();
      expect(account_status_live).not.toHaveBeenCalled();
    }, 30_000);
  });

  describe("a fiscally sponsored registration", () => {
    // the country is one stripe could route to (the seed's United States):
    // sponsorship alone rules it out. the other types' fsa steps must be seeded
    // for the loader to let the applicant reach step 4.
    const sponsored = async () => {
      const id = await seed_step_4();
      await test_db
        .current!.db.update(registrations)
        .set({
          o_type: "other",
          r_proof_of_identity: "https://example.com/id.pdf",
          o_proof_of_reg: "https://example.com/reg.pdf",
          o_registration_number: "REG-1",
          o_project_description: "A project",
          o_legal_entity_type: "association",
          o_fsa_signing_url: "https://example.com/sign",
          o_fsa_signed_doc_url: "https://example.com/signed.pdf",
        })
        .where(eq(registrations.id, id));
      return id;
    };

    it("is not offered stripe beside the bank form", async () => {
      const id = await sponsored();
      const screen = await render_step_4(id);

      await expect
        .element(
          screen.getByRole("region", { name: "Set up your bank payout" })
        )
        .toBeVisible();
      expect(screen.getByText(STRIPE_LATER).query()).toBeNull();
      expect(
        screen.getByRole("region", { name: "How you get paid" }).query()
      ).toBeNull();
      expect(
        screen.getByRole("region", { name: "Stripe account" }).query()
      ).toBeNull();
    }, 30_000);

    it("is told why once the bank is saved", async () => {
      const id = await sponsored();
      await save_bank(id, { o_stripe_account_id: "acct_123" });
      const screen = await render_step_4(id);

      const card = screen.getByRole("region", { name: "Stripe account" });
      await expect
        .element(card.getByText(/fiscally sponsored nonprofits/i))
        .toBeVisible();
      expect(card.getByRole("link").query()).toBeNull();
      expect(account_status_live).not.toHaveBeenCalled();
    }, 30_000);
  });

  it("shows how the connect attempt ended on the way back from stripe", async () => {
    const id = await seed_step_4();
    await save_bank(id);
    const screen = await render_step_4(id, "?stripe_connect=connected");

    await expect
      .element(screen.getByText("Your Stripe account is connected."))
      .toBeVisible();
  }, 30_000);

  it("shows no notice for a result the callback never sends", async () => {
    const id = await seed_step_4();
    await save_bank(id);
    const screen = await render_step_4(
      id,
      "?stripe_connect=error&stripe_connect_reason=made_up"
    );

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByText("Not connected", { exact: true }))
      .toBeVisible();
    expect(card.element().querySelector("[tabindex='-1']")).toBeNull();
  }, 30_000);

  describe("once the notice has shown", () => {
    const page_url = location.href;
    afterEach(() => history.replaceState(history.state, "", page_url));

    it("leaves the address bar, and the rest of the url stays", async () => {
      const returned = new URL(page_url);
      returned.searchParams.set("keep", "1");
      returned.searchParams.set("stripe_connect", "error");
      returned.searchParams.set("stripe_connect_reason", "expired");
      history.replaceState(history.state, "", returned);
      const id = await seed_step_4();
      await save_bank(id);
      const screen = await render_step_4(
        id,
        "?stripe_connect=error&stripe_connect_reason=expired"
      );

      const notice = screen.getByText("The link to Stripe timed out.");
      await expect.element(notice).toBeVisible();
      await vi.waitFor(() => {
        const q = new URL(location.href).searchParams;
        expect([...q.keys()]).not.toContain("stripe_connect");
        expect([...q.keys()]).not.toContain("stripe_connect_reason");
        expect(q.get("keep")).toBe("1");
      });
      // the router never navigated, so the band stays for the reader
      await expect.element(notice).toBeVisible();
    }, 30_000);
  });

  it("reads a linked account's status from stripe, beside saved bank details", async () => {
    account_status_live.mockResolvedValue("pending");
    const id = await seed_step_4();
    await save_bank(id, { o_stripe_account_id: "acct_123" });
    const screen = await render_step_4(id);

    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(card.getByText("Pending review", { exact: true }))
      .toBeVisible();
    expect(account_status_live).toHaveBeenCalledWith("acct_123");
    await expect
      .element(screen.getByRole("link", { name: "Continue" }))
      .toBeVisible();
  }, 30_000);

  describe("while routing is off", () => {
    beforeEach(() => {
      routing.on = false;
    });

    it("hides stripe beside the bank form, including a return notice", async () => {
      const id = await seed_step_4();
      const screen = await render_step_4(id, "?stripe_connect=connected");

      await expect
        .element(screen.getByRole("button", { name: /submit bank details/i }))
        .toBeVisible();
      expect(
        screen.getByRole("region", { name: "Stripe account" }).query()
      ).toBeNull();
      expect(
        screen.getByText("Not connected", { exact: true }).query()
      ).toBeNull();
      expect(
        screen.getByRole("link", { name: "Connect with Stripe" }).query()
      ).toBeNull();
      expect(
        screen.getByRole("link", { name: "Stripe dashboard" }).query()
      ).toBeNull();
      expect(
        screen.getByText("Your Stripe account is connected.").query()
      ).toBeNull();
      expect(screen.container.textContent).not.toMatch(/stripe/i);

      await screen
        .getByRole("button", { name: /submit bank details/i })
        .click();
      await expect
        .element(
          screen.getByRole("region", { name: "Your bank payout", exact: true })
        )
        .toBeVisible();
      expect(
        screen.getByRole("region", { name: "Stripe account" }).query()
      ).toBeNull();
      await screen.getByRole("link", { name: "Continue" }).click();
      await expect.element(screen.getByText(/summary/i)).toBeVisible();
    }, 30_000);

    it("hides stripe beside saved bank details and does not ask stripe", async () => {
      account_status_live.mockResolvedValue("pending");
      const id = await seed_step_4();
      await save_bank(id, { o_stripe_account_id: "acct_123" });
      const screen = await render_step_4(id, "?stripe_connect=connected");

      await expect
        .element(screen.getByRole("link", { name: "Continue" }))
        .toBeVisible();
      expect(
        screen.getByRole("region", { name: "Stripe account" }).query()
      ).toBeNull();
      expect(
        screen.getByText("Pending review", { exact: true }).query()
      ).toBeNull();
      expect(
        screen.getByText("Your Stripe account is connected.").query()
      ).toBeNull();
      expect(screen.container.textContent).not.toMatch(/stripe/i);
      expect(account_status_live).not.toHaveBeenCalled();
    }, 30_000);
  });
});
