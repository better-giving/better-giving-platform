import type { ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { type Locator, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { doc_href } from "@/docs";
import type { TConnectStatus } from "@/stripe-connect/readiness";
import { BankRequired } from "./bank-required";
import { type IPayoutChoice, PayoutChoice } from "./payout-choice";
import { type IPayoutRails, PayoutOptions } from "./payout-options";
import { SavedBank } from "./saved-bank";

/** `Button`'s link form needs a router around it */
const in_router = (node: ReactNode) => {
  const Stub = createRoutesStub([{ path: "/", Component: () => node }]);
  return render(<Stub />);
};

const no_wise = (l: { element: () => Element }) =>
  expect(l.element().textContent).not.toMatch(/wise|money-transfer/i);

const HELD_OTHERS =
  "In your Better Giving balance until you add a bank account.";
const HELD_WITHDRAWALS =
  "They stay in your balance until you add a bank account.";
const STRIPE_ROW_UNREADY =
  "Straight to your Stripe account as each donation's own transfer, after fees, once Stripe says your account is ready. Until then they're held. They skip your split.";
const STRIPE_ROW_WITH_BANK =
  "Straight to your Stripe account as each donation's own transfer, after fees, once Stripe says your account is ready. They skip your split. Until then, they go to your bank.";
const STRIPE_ROW_READY =
  "Straight to your Stripe account as each donation's own transfer, after fees. They skip your split.";
const BANK_ROW =
  "To your bank, after your Grant, Savings and Investments split.";
const FOOTNOTE =
  "Bank payout: we send it to your bank account every 3 days once your balance reaches your payout minimum. Stripe is available to nonprofits in the US, Canada, the UK, Switzerland, Liechtenstein, Norway and EU countries.";

describe("PayoutOptions: compare your options", () => {
  test.each<[IPayoutRails, string]>([
    [
      { bank: true, stripe: false },
      "Right now: Bank. See how Bank and Stripe differ.",
    ],
    [
      { bank: false, stripe: true },
      "Right now: Stripe. See how Bank and Stripe differ.",
    ],
    [
      { bank: true, stripe: true },
      "Right now: Bank and Stripe. See how they differ.",
    ],
    [
      { bank: false, stripe: false },
      "Right now: nothing set up. See how Bank and Stripe differ.",
    ],
  ])("closed with %o, the row names what is set up", async (current, line) => {
    const screen = await render(<PayoutOptions current={current} />);
    const trigger = screen
      .getByRole("heading", { level: 2 })
      .getByRole("button", { name: /compare your options/i });

    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(trigger.getByText(line, { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText(HELD_OTHERS)).not.toBeVisible();
  });

  test("open: one column per option, the held rows badged, and the have-both footer", async () => {
    const screen = await render(
      <PayoutOptions current={{ bank: false, stripe: true }} />
    );
    const region = screen.getByRole("region", {
      name: "Compare your options",
      exact: true,
    });
    const trigger = region.getByRole("button");
    const name =
      /^Compare your options ?Right now: Stripe\. See how Bank and Stripe differ\.$/;
    await expect.element(trigger).toHaveAccessibleName(name);
    await trigger.click();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");

    // the name holds open; what the comparison is for leads the panel
    await expect.element(trigger).toHaveAccessibleName(name);
    const lead = region.getByText(
      "You need one to get paid. Having both is possible."
    );
    await expect.element(lead).toBeVisible();
    expect(trigger.element().contains(lead.element())).toBe(false);

    const bank = region.getByRole("region", { name: "Bank", exact: true });
    const stripe = region.getByRole("region", { name: "Stripe", exact: true });
    await expect.element(bank).toBeVisible();
    await expect.element(stripe).toBeVisible();

    /** each column's four terms, in order, and the detail under each */
    const ledger = (col: Locator) =>
      [...col.element().querySelectorAll("dt")].map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent,
      ]);
    expect(ledger(bank)).toEqual([
      [
        "Stripe donations",
        "To your bank, every 3 days once your balance reaches your payout minimum, after your Grant, Savings and Investments split.",
      ],
      ["PayPal, DAF grants, crypto, stocks, cheques", "To your bank."],
      ["Savings and Investments withdrawals", "To your bank."],
      ["Available to", "Every nonprofit."],
    ]);
    expect(ledger(stripe)).toEqual([
      ["Stripe donations", STRIPE_ROW_UNREADY],
      ["PayPal, DAF grants, crypto, stocks, cheques", `Held${HELD_OTHERS}`],
      ["Savings and Investments withdrawals", `Held${HELD_WITHDRAWALS}`],
      [
        "Available to",
        "Nonprofits in the US, Canada, the UK, Switzerland, Liechtenstein, Norway and EU countries.",
      ],
    ]);
    // the badge marks only Stripe's two held rows
    expect(stripe.getByText("Held", { exact: true }).elements()).toHaveLength(
      2
    );
    expect(bank.getByText("Held", { exact: true }).query()).toBeNull();

    await expect
      .element(
        region.getByText(
          "Have both? Once Stripe says your account is ready, Stripe donations go to Stripe. Everything else goes to your bank."
        )
      )
      .toBeVisible();
    no_wise(region);
  });
});

const BANK_NODE = <p>bank section</p>;
const STRIPE_NODE = <p>stripe section</p>;

const render_choice = (p: Partial<IPayoutChoice> = {}) => {
  const on_select = vi.fn();
  const view = in_router(
    <PayoutChoice
      selected={null}
      onSelect={on_select}
      bank_saved={false}
      stripe_status="not_connected"
      bank={BANK_NODE}
      stripe={STRIPE_NODE}
      back_to="/back"
      continue_to="/summary"
      {...p}
    />
  );
  return { view, on_select };
};

/** the option card around a radio */
const card_of = (screen: Awaited<ReturnType<typeof in_router>>, name: string) =>
  screen
    .getByRole("radio", { name, exact: true })
    .element()
    .closest(".rounded-card") as HTMLElement;

const continue_link = (screen: Awaited<ReturnType<typeof in_router>>) =>
  screen.getByRole("link", { name: "Continue", exact: true });

describe("PayoutChoice: registration step 4", () => {
  test("nothing chosen: both cards open, Continue held with its reason, and a press reports the option", async () => {
    const { view, on_select } = render_choice();
    const screen = await view;

    await expect
      .element(
        screen.getByText(
          "We need one to finish onboarding. You can add the other later from Banking."
        )
      )
      .toBeVisible();
    await expect
      .element(screen.getByText("How do you want to get paid?"))
      .toBeVisible();
    // both cards carry their rows
    await expect.element(screen.getByText(BANK_ROW)).toBeVisible();
    await expect.element(screen.getByText(STRIPE_ROW_UNREADY)).toBeVisible();
    await expect.element(screen.getByText(HELD_OTHERS)).toBeVisible();
    await expect.element(screen.getByText(FOOTNOTE)).toBeVisible();

    const next = continue_link(screen);
    await expect.element(next).toHaveAttribute("aria-disabled", "true");
    const hint = screen.getByText("Choose an option to continue.");
    await expect.element(hint).toBeVisible();
    await expect
      .element(next)
      .toHaveAccessibleDescription("Choose an option to continue.");
    expect(screen.getByText("Required", { exact: true }).query()).toBeNull();
    // neither section shows before a choice
    expect(screen.getByText("bank section").query()).toBeNull();
    expect(screen.getByText("stripe section").query()).toBeNull();

    await screen.getByText("Stripe", { exact: true }).click();
    expect(on_select).toHaveBeenCalledWith("stripe");
    expect(screen.container.textContent).not.toMatch(/wise|money-transfer/i);
  });

  test("nothing chosen: the hint's text sits directly under Continue, on its right edge", async () => {
    const screen = await render_choice().view;
    const next = continue_link(screen);
    const hint = screen.getByText("Choose an option to continue.");
    await expect.element(hint).toBeVisible();

    // the <p> is a full-width block, so its box shares Continue's right edge
    // however the text is aligned; the text's own extent is what moves
    const text = document.createRange();
    text.selectNodeContents(hint.element());
    const text_box = text.getBoundingClientRect();
    const next_box = next.element().getBoundingClientRect();

    expect(Math.abs(text_box.right - next_box.right)).toBeLessThan(1);
    expect(text_box.top).toBeGreaterThanOrEqual(next_box.bottom - 1);
    expect(text_box.top - next_box.bottom).toBeLessThan(16);
  });

  test("Bank saved: the Stripe card collapses to its summary, and Continue goes on", async () => {
    const { view } = render_choice({ selected: "bank", bank_saved: true });
    const screen = await view;

    await expect
      .element(
        screen.getByText(
          "Your bank payout is saved. You can continue now, and add Stripe here too, or any time from Banking."
        )
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("radio", { name: "Bank", exact: true }))
      .toBeChecked();
    await expect.element(screen.getByText(BANK_ROW)).toBeVisible();

    const stripe = card_of(screen, "Stripe");
    expect(stripe.textContent).toContain(
      "Stripe donations go straight to your Stripe account."
    );
    expect(stripe.querySelector("dl")).toBeNull();
    expect(screen.getByText(HELD_OTHERS).query()).toBeNull();

    await expect.element(screen.getByText("bank section")).toBeVisible();
    expect(screen.getByText("stripe section").query()).toBeNull();
    const next = continue_link(screen);
    await expect.element(next).not.toHaveAttribute("aria-disabled", "true");
    await expect.element(next).toHaveAttribute("href", "/summary");
    expect(
      screen.getByText("Choose an option to continue.").query()
    ).toBeNull();
    // set up, so the footnote has nothing left to explain
    expect(screen.getByText(FOOTNOTE).query()).toBeNull();
    expect(screen.getByText("Required", { exact: true }).query()).toBeNull();
    expect(screen.container.textContent).not.toMatch(/wise|money-transfer/i);
  });

  test.each<[TConnectStatus, string, string]>([
    [
      "incomplete",
      "Your Stripe account is connected. You can continue now.",
      STRIPE_ROW_UNREADY,
    ],
    [
      "ready",
      "Your Stripe account is ready. You can continue now.",
      STRIPE_ROW_READY,
    ],
  ])(
    "Stripe %s: the Bank card collapses, the rows say where money waits, and Continue goes on",
    async (stripe_status, line, stripe_row) => {
      const { view } = render_choice({ selected: "stripe", stripe_status });
      const screen = await view;

      await expect
        .element(screen.getByText(line, { exact: true }))
        .toBeVisible();
      await expect
        .element(screen.getByText(stripe_row, { exact: true }))
        .toBeVisible();
      await expect.element(screen.getByText(HELD_WITHDRAWALS)).toBeVisible();
      const bank = card_of(screen, "Bank");
      expect(bank.textContent).toContain("One payout for everything.");
      expect(bank.querySelector("dl")).toBeNull();

      await expect.element(screen.getByText("stripe section")).toBeVisible();
      await expect
        .element(
          screen.getByText(
            "Want everything to pay out? Add a bank account here too, or any time from Banking. Held money is never lost."
          )
        )
        .toBeVisible();
      await expect
        .element(continue_link(screen))
        .not.toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText("Required", { exact: true }).query()).toBeNull();
      expect(screen.container.textContent).not.toMatch(/wise|money-transfer/i);
    }
  );

  test("Stripe chosen, nothing connected yet: Continue waits for the connect", async () => {
    const { view } = render_choice({ selected: "stripe" });
    const screen = await view;
    await expect
      .element(continue_link(screen))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByText("Connect Stripe to continue."))
      .toBeVisible();
    expect(screen.getByText("Want everything to pay out?").query()).toBeNull();
  });

  test("Bank chosen, nothing saved yet: the bank form owns Back and Submit", async () => {
    const { view } = render_choice({ selected: "bank" });
    const screen = await view;
    await expect.element(screen.getByText("bank section")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back" }).query()).toBeNull();
    expect(continue_link(screen).query()).toBeNull();
  });

  test.each<TConnectStatus>(["incomplete", "pending", "ready"])(
    "Stripe %s, then Bank pressed: the form keeps its actions, and the step can still be finished",
    async (stripe_status) => {
      const { view } = render_choice({ selected: "bank", stripe_status });
      const screen = await view;
      await expect.element(screen.getByText("bank section")).toBeVisible();
      await expect
        .element(
          screen.getByText(
            "Your Stripe account is connected, so you can continue now. Add a bank account here too, or any time from Banking."
          )
        )
        .toBeVisible();
      expect(screen.getByText(/We need one/).query()).toBeNull();
      await expect
        .element(
          screen.getByRole("link", { name: "Continue without a bank account" })
        )
        .toHaveAttribute("href", "/summary");
      // the bank form's Submit is the one primary on screen
      expect(screen.container.querySelector(".btn-primary")).toBeNull();
      expect(screen.getByRole("link", { name: "Back" }).query()).toBeNull();
    }
  );

  test("Stripe pressed with a bank saved: the intro says the bank is set, and Continue goes on", async () => {
    const { view } = render_choice({ selected: "stripe", bank_saved: true });
    const screen = await view;
    await expect
      .element(
        screen.getByText(
          "Your bank payout is saved, so you can continue now. Connect Stripe here too, or any time from Banking."
        )
      )
      .toBeVisible();
    expect(screen.getByText(/We need one/).query()).toBeNull();
    await expect
      .element(continue_link(screen))
      .not.toHaveAttribute("aria-disabled", "true");

    // the open Stripe card sends what it can't take to the saved bank
    const stripe = card_of(screen, "Stripe");
    const cells = [...stripe.querySelectorAll("dd")].map((d) => d.textContent);
    expect(cells).toEqual([
      STRIPE_ROW_WITH_BANK,
      "To your bank.",
      "To your bank.",
    ]);
    expect(stripe.textContent).not.toMatch(/held/i);
  });

  test("Stripe ready with a bank saved: the Stripe card's first row drops its until-ready clause", async () => {
    const { view } = render_choice({
      selected: "stripe",
      bank_saved: true,
      stripe_status: "ready",
    });
    const screen = await view;
    const stripe = card_of(screen, "Stripe");
    await expect
      .element(screen.getByText(STRIPE_ROW_READY, { exact: true }))
      .toBeVisible();
    expect(stripe.textContent).not.toMatch(/held/i);
    // a bank is saved: nothing left to offer under the card
    expect(screen.getByText("Want everything to pay out?").query()).toBeNull();
  });

  test("changing a saved bank: the form owns the actions, and the saved bank still counts", async () => {
    const { view } = render_choice({
      selected: "bank",
      bank_saved: true,
      bank_form_open: true,
      stripe_status: "ready",
    });
    const screen = await view;
    await expect.element(screen.getByText("bank section")).toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Your saved bank payout stays in place until you save a new one."
        )
      )
      .toBeVisible();
    expect(screen.getByRole("link", { name: "Back" }).query()).toBeNull();
    expect(continue_link(screen).query()).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Continue without a bank account" })
        .query()
    ).toBeNull();
  });

  test("Stripe pressed while changing a saved bank: the bank still counts, and Continue goes on", async () => {
    const { view } = render_choice({
      selected: "stripe",
      bank_saved: true,
      bank_form_open: true,
    });
    const screen = await view;
    await expect
      .element(
        screen.getByText(
          "Your bank payout is saved, so you can continue now. Connect Stripe here too, or any time from Banking."
        )
      )
      .toBeVisible();
    expect(screen.getByText(/We need one/).query()).toBeNull();
    expect(screen.getByText("Connect Stripe to continue.").query()).toBeNull();
    await expect
      .element(continue_link(screen))
      .not.toHaveAttribute("aria-disabled", "true");
    expect(card_of(screen, "Stripe").textContent).toContain(
      STRIPE_ROW_WITH_BANK
    );
  });

  test("an option card firms its edge only over the part that selects", async () => {
    const { view } = render_choice();
    const screen = await view;
    await expect
      .element(screen.getByRole("radio", { name: "Bank", exact: true }))
      .toBeInTheDocument();
    const card = card_of(screen, "Bank");
    const edge = () => getComputedStyle(card).borderTopColor;
    const rest = edge();
    await userEvent.hover(card.querySelector("dl") as HTMLElement);
    expect(edge()).toBe(rest);
    await userEvent.hover(card.querySelector("label") as HTMLElement);
    await expect.poll(edge).not.toBe(rest);
  });

  test("the chosen card keeps its primary edge under the pointer", async () => {
    const { view } = render_choice({ selected: "bank", bank_saved: true });
    const screen = await view;
    await expect
      .element(screen.getByRole("radio", { name: "Bank", exact: true }))
      .toBeChecked();
    const card = card_of(screen, "Bank");
    const edge = () => getComputedStyle(card).borderTopColor;
    const chosen = edge();
    await userEvent.hover(card.querySelector("label") as HTMLElement);
    expect(edge()).toBe(chosen);
  });
});

describe("BankRequired: can't use Stripe", () => {
  test("says why, badges the bank Required, and holds the form", async () => {
    const screen = await render(
      <BankRequired ineligible={{ reason: "fiscal_sponsored" }}>
        <p>bank form</p>
      </BankRequired>
    );
    await expect
      .element(screen.getByRole("heading", { name: "Set up your bank payout" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Required", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Stripe isn't available to fiscally sponsored nonprofits."
        )
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Your bank payout is how you get paid, so it's required. Every donation, Stripe donations included, pays out to your bank, every 3 days once your balance reaches your payout minimum."
        )
      )
      .toBeVisible();
    await expect.element(screen.getByText("bank form")).toBeVisible();
    expect(screen.container.textContent).not.toMatch(/wise|money-transfer/i);
  });

  test("Stripe not offered: the bank explained plainly, with no badge and no word of Stripe", async () => {
    const screen = await render(
      <BankRequired>
        <p>bank form</p>
      </BankRequired>
    );
    await expect
      .element(screen.getByRole("heading", { name: "Set up your bank payout" }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Your bank payout is how you get paid. Every donation pays out to your bank, every 3 days once your balance reaches your payout minimum.",
          { exact: true }
        )
      )
      .toBeVisible();
    await expect.element(screen.getByText("bank form")).toBeVisible();
    expect(screen.getByText("Required", { exact: true }).query()).toBeNull();
    expect(screen.container.textContent).not.toMatch(/stripe/i);
    expect(screen.container.textContent).not.toMatch(/wise|money-transfer/i);
  });
});

describe("SavedBank", () => {
  test("states the payout, the account and its statement, and asks to change", async () => {
    const on_change = vi.fn();
    const screen = await render(
      <SavedBank
        account_id="84720193"
        statement_ref="https://example.com/statement.pdf"
        onChange={on_change}
      />
    );
    const card = screen.getByRole("region", { name: "Bank payout" });
    await expect.element(card.getByText("Saved")).toBeVisible();
    // the heading already says it: no "Bank payout:" lead-in
    await expect
      .element(
        card.getByText(
          "We send it to your bank account every 3 days once your balance reaches your payout minimum.",
          { exact: true }
        )
      )
      .toBeVisible();
    await expect.element(card.getByText("84720193")).toBeVisible();
    await expect
      .element(card.getByRole("link", { name: "Bank statement" }))
      .toHaveAttribute("href", doc_href("https://example.com/statement.pdf"));
    await card.getByRole("button", { name: "Change" }).click();
    expect(on_change).toHaveBeenCalledOnce();
    no_wise(card);
  });

  test("offers no statement link when none is on file", async () => {
    const screen = await render(
      <SavedBank account_id="84720193" statement_ref="" onChange={vi.fn()} />
    );
    const card = screen.getByRole("region", { name: "Bank payout" });
    await expect.element(card.getByText("84720193")).toBeVisible();
    await expect.element(card.getByRole("link")).not.toBeInTheDocument();
  });
});
