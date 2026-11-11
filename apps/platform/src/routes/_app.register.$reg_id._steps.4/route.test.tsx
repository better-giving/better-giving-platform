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
  BankDetails: ({ onSubmit, is_loading, first_field_ref }: any) => (
    <button
      ref={first_field_ref}
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

type TScreen = Awaited<ReturnType<typeof render_step_4>>;

const radio = (screen: TScreen, name: "Bank" | "Stripe") =>
  screen.getByRole("radio", { name, exact: true });
const continue_link = (screen: TScreen) =>
  screen.getByRole("link", { name: "Continue", exact: true });
const saved_bank = (screen: TScreen) =>
  screen.getByRole("region", { name: "Bank payout", exact: true });
const stripe_card = (screen: TScreen) =>
  screen.getByRole("region", { name: "Stripe account" });
const submit_bank = (screen: TScreen) =>
  screen.getByRole("button", { name: /submit bank details/i });

const link_stripe = (id: string) =>
  test_db
    .current!.db.update(registrations)
    .set({ o_stripe_account_id: "acct_123" })
    .where(eq(registrations.id, id));

/** the payout provider is never named to the nonprofit */
const expect_no_wise = (screen: TScreen) =>
  expect(screen.container.textContent).not.toMatch(/\bwise\b|money-transfer/i);

// --- tests ---

describe("registration step 4: choose how you get paid", () => {
  it("starts with nothing chosen, and a saved bank lets the applicant continue", async () => {
    const id = await seed_step_4();
    const screen = await render_step_4(id);

    await expect
      .element(screen.getByRole("heading", { name: "Choose how you get paid" }))
      .toBeVisible();
    await expect.element(radio(screen, "Bank")).not.toBeChecked();
    await expect.element(radio(screen, "Stripe")).not.toBeChecked();
    await expect
      .element(continue_link(screen))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByText("Choose an option to continue."))
      .toBeVisible();
    expect(submit_bank(screen).query()).toBeNull();
    expect_no_wise(screen);

    await screen.getByText("Bank", { exact: true }).click();
    await submit_bank(screen).click();

    // a saved bank comes back to this step, not on to the summary
    await expect
      .element(saved_bank(screen).getByText("Saved", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("heading", { name: "Bank payout", exact: true })
      )
      .toHaveFocus();
    await expect.element(radio(screen, "Bank")).toBeChecked();
    expect_no_wise(screen);
    await continue_link(screen).click();
    await expect.element(screen.getByText(/summary/i)).toBeVisible();
  }, 30_000);

  it("shows a bank saved on arrival as chosen, and offers stripe beside it", async () => {
    const id = await seed_step_4();
    await save_bank(id);
    const screen = await render_step_4(id);

    await expect.element(radio(screen, "Bank")).toBeChecked();
    const bank = saved_bank(screen);
    await expect.element(bank.getByText("999", { exact: true })).toBeVisible();
    await expect
      .element(bank.getByRole("link", { name: "Bank statement" }))
      .toHaveAttribute("href", "https://example.com/bank.pdf");
    await expect
      .element(
        screen.getByRole("heading", { name: "Bank payout", exact: true })
      )
      .not.toHaveFocus();
    await expect
      .element(continue_link(screen))
      .not.toHaveAttribute("aria-disabled", "true");
    expect_no_wise(screen);

    await screen.getByText("Stripe", { exact: true }).click();
    await expect
      .element(
        stripe_card(screen).getByRole("link", { name: "Connect Stripe" })
      )
      .toHaveAttribute(
        "href",
        `/api/stripe-connect/start?kind=reg&reg_id=${id}`
      );
    // the bank still finishes the step
    await expect
      .element(continue_link(screen))
      .not.toHaveAttribute("aria-disabled", "true");
    expect(account_status_live).not.toHaveBeenCalled();
  }, 30_000);

  it("shows a connected but unfinished stripe account as chosen", async () => {
    account_status_live.mockResolvedValue("incomplete");
    const id = await seed_step_4();
    await link_stripe(id);
    const screen = await render_step_4(id);

    await expect.element(radio(screen, "Stripe")).toBeChecked();
    await expect
      .element(
        screen.getByText(
          "Your Stripe account is connected. You can continue now."
        )
      )
      .toBeVisible();
    await expect
      .element(
        stripe_card(screen).getByText("Finish setup on Stripe", { exact: true })
      )
      .toBeVisible();
    await expect
      .element(
        stripe_card(screen).getByText(
          /card, bank and wallet donations are held too/
        )
      )
      .toBeVisible();
    expect(account_status_live).toHaveBeenCalledWith("acct_123");
    expect_no_wise(screen);
    await continue_link(screen).click();
    await expect.element(screen.getByText(/summary/i)).toBeVisible();
  }, 30_000);

  it("shows a ready stripe account as chosen", async () => {
    account_status_live.mockResolvedValue("ready");
    const id = await seed_step_4();
    await link_stripe(id);
    const screen = await render_step_4(id);

    await expect.element(radio(screen, "Stripe")).toBeChecked();
    await expect
      .element(
        stripe_card(screen).getByText(
          "Ready to receive card, bank and wallet donations"
        )
      )
      .toBeVisible();
    // no standing band: only a connect that just landed says it
    expect(
      stripe_card(screen).getByText("Your Stripe account is connected.").query()
    ).toBeNull();
    await expect
      .element(continue_link(screen))
      .not.toHaveAttribute("aria-disabled", "true");
    expect_no_wise(screen);
  }, 30_000);

  it("shows the bank as chosen when both are saved, with stripe a press away", async () => {
    account_status_live.mockResolvedValue("ready");
    const id = await seed_step_4();
    await save_bank(id, { o_stripe_account_id: "acct_123" });
    const screen = await render_step_4(id);

    await expect.element(radio(screen, "Bank")).toBeChecked();
    await expect.element(saved_bank(screen)).toBeVisible();
    await screen.getByText("Stripe", { exact: true }).click();
    await expect
      .element(
        stripe_card(screen).getByText(
          "Ready to receive card, bank and wallet donations"
        )
      )
      .toBeVisible();
  }, 30_000);

  it("asks for stripe before Continue opens when stripe is chosen and nothing is set up", async () => {
    const id = await seed_step_4();
    const screen = await render_step_4(id);

    await screen.getByText("Stripe", { exact: true }).click();
    await expect
      .element(
        stripe_card(screen).getByRole("link", { name: "Connect Stripe" })
      )
      .toBeVisible();
    await expect
      .element(continue_link(screen))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByText("Connect Stripe to continue."))
      .toBeVisible();
  }, 30_000);

  describe("stripe connected, no bank", () => {
    it("lets the applicant finish without a bank, nudges toward one, and offers the skip only once the bank form is open", async () => {
      account_status_live.mockResolvedValue("ready");
      const id = await seed_step_4();
      await link_stripe(id);
      const screen = await render_step_4(id);

      await expect.element(radio(screen, "Stripe")).toBeChecked();
      await expect
        .element(continue_link(screen))
        .not.toHaveAttribute("aria-disabled", "true");
      await expect
        .element(screen.getByText(/want everything to pay out/i))
        .toBeVisible();
      expect(
        screen.getByText("Connect Stripe to continue.").query()
      ).toBeNull();

      // the skip link shows only while the bank form is open and none is saved
      expect(
        screen.getByRole("link", { name: /without a bank account/i }).query()
      ).toBeNull();

      // Bank opens its form; the link is then the way on that skips it
      await screen.getByText("Bank", { exact: true }).click();
      await expect.element(submit_bank(screen)).toBeVisible();
      await screen
        .getByRole("link", { name: /continue without a bank account/i })
        .click();
      await expect.element(screen.getByText(/summary/i)).toBeVisible();
    }, 30_000);

    it("a connected account that is not ready finishes the step too", async () => {
      account_status_live.mockResolvedValue("incomplete");
      const id = await seed_step_4();
      await link_stripe(id);
      const screen = await render_step_4(id);

      await screen.getByText("Stripe", { exact: true }).click();
      await expect
        .element(continue_link(screen))
        .not.toHaveAttribute("aria-disabled", "true");
    }, 30_000);
  });

  it("lands back on the stripe option after connecting, a saved bank or not", async () => {
    account_status_live.mockResolvedValue("ready");
    const id = await seed_step_4();
    await save_bank(id, { o_stripe_account_id: "acct_123" });
    const screen = await render_step_4(id, "?stripe_connect=connected");

    await expect.element(radio(screen, "Stripe")).toBeChecked();
    await expect
      .element(
        stripe_card(screen).getByText("Your Stripe account is connected.")
      )
      .toBeVisible();
  }, 30_000);

  it("shows how a failed connect attempt ended, on the stripe option", async () => {
    const id = await seed_step_4();
    const screen = await render_step_4(
      id,
      "?stripe_connect=error&stripe_connect_reason=expired"
    );

    await expect.element(radio(screen, "Stripe")).toBeChecked();
    await expect
      .element(screen.getByText("The link to Stripe timed out."))
      .toBeVisible();
  }, 30_000);

  it("shows no notice for a result the callback never sends", async () => {
    const id = await seed_step_4();
    await save_bank(id);
    const screen = await render_step_4(
      id,
      "?stripe_connect=error&stripe_connect_reason=made_up"
    );

    await expect.element(radio(screen, "Bank")).toBeChecked();
    await screen.getByText("Stripe", { exact: true }).click();
    const card = stripe_card(screen);
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

  describe("changing a saved bank", () => {
    it("opens the form, and Cancel puts the saved bank back", async () => {
      const id = await seed_step_4();
      await save_bank(id);
      const screen = await render_step_4(id);

      await saved_bank(screen).getByRole("button", { name: "Change" }).click();
      await expect.element(submit_bank(screen)).toBeVisible();
      await screen.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect.element(saved_bank(screen)).toBeVisible();
    }, 30_000);

    it("moves focus into the form Change opens", async () => {
      const id = await seed_step_4();
      await save_bank(id);
      const screen = await render_step_4(id);

      await saved_bank(screen).getByRole("button", { name: "Change" }).click();
      // the stand-in carries the form's first-field ref
      await expect.element(submit_bank(screen)).toHaveFocus();
    }, 30_000);

    it("comes back to the saved bank with focus on it once a change lands", async () => {
      const id = await seed_step_4();
      await save_bank(id);
      bank_statement.url = "https://example.com/new.pdf";
      const screen = await render_step_4(id);

      await saved_bank(screen).getByRole("button", { name: "Change" }).click();
      await submit_bank(screen).click();

      await expect
        .element(
          saved_bank(screen).getByRole("link", { name: "Bank statement" })
        )
        .toHaveAttribute("href", "https://example.com/new.pdf");
      await expect
        .element(
          screen.getByRole("heading", { name: "Bank payout", exact: true })
        )
        .toHaveFocus();
      expect(screen.getByText(/summary/i).query()).toBeNull();
    }, 30_000);

    it("still counts the saved bank while its form is open", async () => {
      const id = await seed_step_4();
      await save_bank(id);
      const screen = await render_step_4(id);

      await saved_bank(screen).getByRole("button", { name: "Change" }).click();
      await expect.element(submit_bank(screen)).toBeVisible();
      await screen.getByText("Stripe", { exact: true }).click();
      await expect
        .element(continue_link(screen))
        .not.toHaveAttribute("aria-disabled", "true");

      // leaving Bank dropped the change, so coming back shows what is saved
      await screen.getByText("Bank", { exact: true }).click();
      await expect.element(saved_bank(screen)).toBeVisible();
    }, 30_000);

    it("does not offer to go on without a bank while one is saved", async () => {
      account_status_live.mockResolvedValue("ready");
      const id = await seed_step_4();
      await save_bank(id, { o_stripe_account_id: "acct_123" });
      const screen = await render_step_4(id);

      await saved_bank(screen).getByRole("button", { name: "Change" }).click();
      await expect.element(submit_bank(screen)).toBeVisible();
      expect(screen.getByText(/without a bank account/i).query()).toBeNull();
    }, 30_000);

    it("keeps the form open when the change fails, and closes it once a retry lands", async () => {
      const id = await seed_step_4();
      await save_bank(id);
      bank_statement.url = "not-a-url";
      const screen = await render_step_4(id);

      await saved_bank(screen).getByRole("button", { name: "Change" }).click();
      await submit_bank(screen).click();
      const failure = screen.getByText(/invalid url/i);
      await expect.element(failure).toBeInTheDocument();
      // the prompt is modal, so the page behind it has no roles until it closes
      await screen.getByRole("button", { name: "Ok", exact: true }).click();
      await expect.element(failure).not.toBeInTheDocument();
      await expect.element(submit_bank(screen)).toBeVisible();
      expect(saved_bank(screen).query()).toBeNull();

      const [row] = await test_db
        .current!.db.select()
        .from(registrations)
        .where(eq(registrations.id, id));
      expect(row.o_bank_statement).toBe("https://example.com/bank.pdf");

      bank_statement.url = "https://example.com/new.pdf";
      await submit_bank(screen).click();
      await expect
        .element(
          saved_bank(screen).getByRole("link", { name: "Bank statement" })
        )
        .toHaveAttribute("href", "https://example.com/new.pdf");
    }, 30_000);
  });

  it("surfaces the failure when a first save is rejected", async () => {
    // a bank statement url the action's schema rejects
    bank_statement.url = "not-a-url";
    const id = await seed_step_4();
    const screen = await render_step_4(id);

    await screen.getByText("Bank", { exact: true }).click();
    await submit_bank(screen).click();

    // a 4xx is the user's to act on, so the action's own message is shown
    await expect.element(screen.getByText(/invalid url/i)).toBeInTheDocument();
    const [row] = await test_db
      .current!.db.select()
      .from(registrations)
      .where(eq(registrations.id, id));
    expect(row.o_bank_id).toBeNull();
  }, 30_000);

  describe("a registration stripe can never route to", () => {
    // outside the transfer countries
    const abroad = async () => {
      const id = await seed_step_4();
      await test_db
        .current!.db.update(registrations)
        .set({ o_hq_country: "Brazil" })
        .where(eq(registrations.id, id));
      return id;
    };

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

    it("requires the bank, says why, and continues once it is saved", async () => {
      const id = await sponsored();
      const screen = await render_step_4(id);

      const required = screen.getByRole("region", {
        name: "Set up your bank payout",
      });
      await expect
        .element(required.getByText("Required", { exact: true }))
        .toBeVisible();
      await expect
        .element(
          required.getByText(
            "Stripe isn't available to fiscally sponsored nonprofits."
          )
        )
        .toBeVisible();
      expect(radio(screen, "Stripe").query()).toBeNull();
      expect(stripe_card(screen).query()).toBeNull();
      expect(continue_link(screen).query()).toBeNull();
      expect_no_wise(screen);

      await submit_bank(screen).click();
      await expect.element(saved_bank(screen)).toBeVisible();
      await continue_link(screen).click();
      await expect.element(screen.getByText(/summary/i)).toBeVisible();
    }, 30_000);

    it("names the country, and never asks stripe about a linked account", async () => {
      const id = await abroad();
      await save_bank(id, { o_stripe_account_id: "acct_123" });
      const screen = await render_step_4(id, "?stripe_connect=connected");

      await expect
        .element(
          screen.getByText(
            /Stripe isn't available for nonprofits headquartered in Brazil/
          )
        )
        .toBeVisible();
      await expect.element(saved_bank(screen)).toBeVisible();
      expect(stripe_card(screen).query()).toBeNull();
      expect(
        screen.getByText("Your Stripe account is connected.").query()
      ).toBeNull();
      expect(account_status_live).not.toHaveBeenCalled();
    }, 30_000);
  });

  describe("while routing is off", () => {
    beforeEach(() => {
      routing.on = false;
    });

    it("asks for the bank without a word of stripe, and hides a return notice", async () => {
      const id = await seed_step_4();
      const screen = await render_step_4(id, "?stripe_connect=connected");

      const required = screen.getByRole("region", {
        name: "Set up your bank payout",
      });
      await expect.element(required).toBeVisible();
      // the badge is for a nonprofit Stripe can't serve; here it isn't offered
      expect(
        required.getByText("Required", { exact: true }).query()
      ).toBeNull();
      expect(required.element().textContent).not.toMatch(/stripe/i);
      expect(radio(screen, "Stripe").query()).toBeNull();
      expect(stripe_card(screen).query()).toBeNull();
      expect(
        screen.getByText("Your Stripe account is connected.").query()
      ).toBeNull();
      expect_no_wise(screen);

      await submit_bank(screen).click();
      await expect.element(saved_bank(screen)).toBeVisible();
      await continue_link(screen).click();
      await expect.element(screen.getByText(/summary/i)).toBeVisible();
    }, 30_000);

    it("holds a stripe-only registration on the bank form, and does not ask stripe", async () => {
      account_status_live.mockResolvedValue("ready");
      const id = await seed_step_4();
      await link_stripe(id);
      const screen = await render_step_4(id);

      await expect.element(submit_bank(screen)).toBeVisible();
      expect(continue_link(screen).query()).toBeNull();
      expect(stripe_card(screen).query()).toBeNull();
      expect(account_status_live).not.toHaveBeenCalled();
    }, 30_000);
  });
});
