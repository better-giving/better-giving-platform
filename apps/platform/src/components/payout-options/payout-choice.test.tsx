import type { ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { TConnectStatus } from "@/stripe-connect/readiness";
import { BankRequired } from "./bank-required";
import { type IPayoutChoice, PayoutChoice } from "./payout-choice";
import type { TPayoutOption } from "./rows";
import { SavedBank } from "./saved-bank";

/** `Button`'s link form needs a router around it */
const in_router = (node: ReactNode) => {
  const Stub = createRoutesStub([{ path: "/", Component: () => node }]);
  return render(<Stub />);
};

const render_choice = (props: Partial<IPayoutChoice> = {}) =>
  in_router(
    <PayoutChoice
      selected={null}
      onSelect={vi.fn()}
      bank_saved={false}
      stripe_status="not_connected"
      bank={<p>bank slot</p>}
      stripe={<p>stripe slot</p>}
      back_to="/back"
      continue_to="/next"
      {...props}
    />
  );

type TScreen = Awaited<ReturnType<typeof render_choice>>;

/** each option card's `dl`, bank first; both are open while nothing is chosen */
const cards = (screen: TScreen) =>
  screen.container.querySelectorAll("dl") as NodeListOf<HTMLElement>;
const cells = (dl: HTMLElement) =>
  [...dl.querySelectorAll("dd")].map((d) => d.textContent ?? "");
const held_badges = (dl: HTMLElement) =>
  [...dl.querySelectorAll("dd")].filter((d) =>
    d.textContent?.startsWith("Held")
  ).length;

/** the option card around a radio */
const card_of = (screen: TScreen, name: string) =>
  screen
    .getByRole("radio", { name, exact: true })
    .element()
    .closest(".rounded-card") as HTMLElement;

const READY_CELL =
  "Straight to your Stripe account as each donation's own transfer, after fees. They skip your split.";

describe("PayoutChoice option cards", () => {
  test.each<
    [TConnectStatus, boolean, { first: string; others: string; held: number }]
  >([
    [
      "not_connected",
      false,
      {
        first: "They skip your split. Until then they're held.",
        others: "until you add a bank account.",
        held: 2,
      },
    ],
    [
      "incomplete",
      false,
      {
        first: "They skip your split. Until then they're held.",
        others: "until you add a bank account.",
        held: 2,
      },
    ],
    [
      "not_connected",
      true,
      { first: "Until then, they go to your bank.", others: "", held: 0 },
    ],
    [
      "pending",
      false,
      {
        first: "They skip your split. Until then they're held.",
        others: "until you add a bank account.",
        held: 2,
      },
    ],
    [
      "incomplete",
      true,
      { first: "Until then, they go to your bank.", others: "", held: 0 },
    ],
    [
      "pending",
      true,
      { first: "Until then, they go to your bank.", others: "", held: 0 },
    ],
    ["ready", false, { first: READY_CELL, others: "until you add", held: 2 }],
    ["ready", true, { first: READY_CELL, others: "", held: 0 }],
  ])(
    "stripe card, status %s, bank saved %s: its three cells and its Held badges",
    async (stripe_status, bank_saved, want) => {
      const screen = await render_choice({ stripe_status, bank_saved });
      const stripe = cards(screen)[1];
      const [donations, others, withdrawals] = cells(stripe);

      expect(donations).toContain("Straight to your Stripe account");
      expect(donations).toContain(want.first);
      // "Held" is the badge, never prose. the Stripe outcome never carries it:
      // holding is only its until-ready tail
      expect(donations.startsWith("Held")).toBe(false);
      if (want.held) {
        expect(others).toMatch(/^Held.*Better Giving balance/);
        expect(withdrawals).toMatch(/^Held.*stay in your balance/);
        expect(others).toContain(want.others);
      } else {
        expect(others).toBe("To your bank.");
        expect(withdrawals).toBe("To your bank.");
      }
      expect(held_badges(stripe)).toBe(want.held);
    }
  );

  test("the bank card sends everything to the bank and never shows Held", async () => {
    const screen = await render_choice();
    const bank = cards(screen)[0];

    expect(cells(bank)).toEqual([
      "To your bank, after your Grant, Savings and Investments split.",
      "To your bank.",
      "To your bank.",
    ]);
    expect(held_badges(bank)).toBe(0);
  });

  const SUMMARY_WITH_STRIPE =
    "One payout for everything your Stripe account doesn't receive.";

  test.each<[TConnectStatus, string, boolean]>([
    [
      "incomplete",
      "To your bank, after your Grant, Savings and Investments split, until Stripe says your account is ready. Then they go straight to your Stripe account instead.",
      false,
    ],
    [
      "pending",
      "To your bank, after your Grant, Savings and Investments split, until Stripe says your account is ready. Then they go straight to your Stripe account instead.",
      false,
    ],
    [
      "ready",
      "To your Stripe account, not your bank. If you disconnect Better Giving in your Stripe dashboard, they go to your bank instead.",
      true,
    ],
  ])(
    "Stripe %s: the bank card says what Stripe takes off it, and the other two rows stay with the bank",
    async (stripe_status, first, stripe_receives) => {
      const screen = await render_choice({ stripe_status });
      const bank = cards(screen)[0];

      expect(cells(bank)).toEqual([first, "To your bank.", "To your bank."]);
      // the summary claims a split only once Stripe receives something
      const [shown, hidden] = stripe_receives
        ? [SUMMARY_WITH_STRIPE, "One payout for everything."]
        : ["One payout for everything.", SUMMARY_WITH_STRIPE];
      await expect
        .element(screen.getByText(shown, { exact: true }))
        .toBeVisible();
      expect(screen.getByText(hidden, { exact: true }).query()).toBeNull();
      expect(held_badges(bank)).toBe(0);
    }
  );

  test.each<TConnectStatus>(["not_connected", "disconnected"])(
    "Stripe %s counts as not linked: the bank card keeps its plain summary and cells",
    async (stripe_status) => {
      const screen = await render_choice({ stripe_status });

      expect(cells(cards(screen)[0])).toEqual([
        "To your bank, after your Grant, Savings and Investments split.",
        "To your bank.",
        "To your bank.",
      ]);
      expect(
        screen.getByText(SUMMARY_WITH_STRIPE, { exact: true }).query()
      ).toBeNull();
    }
  );

  test("the terms are the three kinds of money, on both cards", async () => {
    const screen = await render_choice();
    for (const dl of cards(screen)) {
      expect([...dl.querySelectorAll("dt")].map((t) => t.textContent)).toEqual([
        "Card, bank and wallet donations",
        "PayPal, DAF grants, crypto, stocks, cheques",
        "Savings and Investments withdrawals",
      ]);
    }
  });

  test.each<[TPayoutOption, string, string]>([
    [
      "stripe",
      "Straight to your Stripe account",
      "To your bank, after your Grant",
    ],
    [
      "bank",
      "To your bank, after your Grant",
      "Straight to your Stripe account",
    ],
  ])(
    "choosing %s keeps its card open and collapses the other to its summary",
    async (selected, open_cell, closed_cell) => {
      const screen = await render_choice({ selected });

      expect(cards(screen).length).toBe(1);
      const [donations] = cells(cards(screen)[0]);
      expect(donations).toContain(open_cell);
      expect(donations).not.toContain(closed_cell);
      await expect
        .element(
          screen.getByText(
            selected === "stripe"
              ? "One payout for everything."
              : /go straight to your Stripe account/i
          )
        )
        .toBeVisible();
    }
  );

  test("an option card firms its edge only over the part that selects", async () => {
    const screen = await render_choice();
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
    const screen = await render_choice({ selected: "bank", bank_saved: true });
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

describe("PayoutChoice summaries", () => {
  test("the Stripe summary promises the transfer only once the account is ready", async () => {
    const screen = await render_choice();

    await expect
      .element(
        screen.getByText(
          "Card, bank and wallet donations go straight to your Stripe account once it's ready.",
          { exact: true }
        )
      )
      .toBeVisible();
  });
});

describe("PayoutChoice slots", () => {
  test.each<[TPayoutOption, string, string]>([
    ["bank", "bank slot", "stripe slot"],
    ["stripe", "stripe slot", "bank slot"],
  ])(
    "choosing %s shows its slot and not the other",
    async (selected, shown, hidden) => {
      const screen = await render_choice({ selected });

      await expect
        .element(screen.getByText(shown, { exact: true }))
        .toBeVisible();
      expect(screen.getByText(hidden, { exact: true }).query()).toBeNull();
    }
  );

  test("nothing chosen shows neither slot", async () => {
    const screen = await render_choice();

    await expect
      .element(screen.getByRole("radio", { name: "Bank", exact: true }))
      .toBeInTheDocument();
    expect(screen.getByText("bank slot", { exact: true }).query()).toBeNull();
    expect(screen.getByText("stripe slot", { exact: true }).query()).toBeNull();
  });

  test("a saved bank, Stripe chosen but unlinked: Continue is open and Stripe is no gate", async () => {
    const screen = await render_choice({
      selected: "stripe",
      bank_saved: true,
    });

    await expect
      .element(screen.getByRole("link", { name: "Continue", exact: true }))
      .not.toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("link", { name: "Continue", exact: true }))
      .toHaveAttribute("href", "/next");
    expect(screen.getByText("Connect Stripe to continue.").query()).toBeNull();
  });

  test.each<TConnectStatus>(["incomplete", "pending", "ready"])(
    "Stripe %s, then Bank pressed: the skip is a link and Submit stays the one primary",
    async (stripe_status) => {
      const screen = await render_choice({
        selected: "bank",
        stripe_status,
        bank: (
          <button type="submit" className="btn btn-primary">
            Submit
          </button>
        ),
      });

      const skip = screen.getByRole("link", {
        name: /continue without a bank account/i,
      });
      await expect.element(skip).toBeVisible();
      expect(skip.element().tagName).toBe("A");
      expect(skip.element().classList.contains("btn")).toBe(false);
      expect(screen.container.querySelectorAll(".btn-primary").length).toBe(1);
      await expect
        .element(screen.getByRole("button", { name: "Submit", exact: true }))
        .toBeVisible();
    }
  );
});

describe("PayoutChoice footnote", () => {
  const footnote = (screen: TScreen) =>
    screen.getByText(/Bank payout: we send it to your bank account/);

  test("shows the bank cadence and where Stripe is offered until the chosen option is set up", async () => {
    for (const props of [
      {},
      { selected: "stripe" as const },
      { selected: "bank" as const, bank_form_open: true, bank_saved: true },
    ]) {
      const screen = await render_choice(props);
      await expect
        .element(footnote(screen))
        .toMatchTextContent(
          /every 3 days once your balance reaches your payout minimum\. Stripe is available to nonprofits in the US, Canada/
        );
      await cleanup();
    }
  });

  test.each<[string, Partial<IPayoutChoice>]>([
    ["bank saved and chosen", { selected: "bank", bank_saved: true }],
    [
      "stripe linked and chosen",
      { selected: "stripe", stripe_status: "incomplete" },
    ],
  ])("%s: nothing is left to explain, so it hides", async (_, props) => {
    const screen = await render_choice(props);

    await expect
      .element(screen.getByRole("link", { name: "Continue", exact: true }))
      .toBeVisible();
    expect(footnote(screen).query()).toBeNull();
  });
});

describe("PayoutChoice hints and intro", () => {
  test.each<[string, Partial<IPayoutChoice>, string]>([
    [
      "nothing chosen, nothing set up",
      {},
      "We need one to finish onboarding. You can add the other later from Banking.",
    ],
    [
      "disconnected Stripe is not set up",
      { stripe_status: "disconnected" },
      "We need one to finish onboarding. You can add the other later from Banking.",
    ],
    [
      "bank saved and chosen",
      { selected: "bank", bank_saved: true },
      "Your bank payout is saved. You can continue now, and add Stripe here too, or any time from Banking.",
    ],
    [
      "stripe ready and chosen",
      { selected: "stripe", stripe_status: "ready" },
      "Your Stripe account is ready. You can continue now.",
    ],
    [
      "stripe incomplete and chosen",
      { selected: "stripe", stripe_status: "incomplete" },
      "Your Stripe account is connected. You can continue now.",
    ],
    [
      "bank chosen, Stripe already linked",
      { selected: "bank", stripe_status: "pending" },
      "Your Stripe account is connected, so you can continue now. Add a bank account here too, or any time from Banking.",
    ],
    [
      "Stripe pressed over a saved bank",
      { selected: "stripe", bank_saved: true },
      "Your bank payout is saved, so you can continue now. Connect Stripe here too, or any time from Banking.",
    ],
    [
      "Stripe pressed while the bank form is open over a saved bank",
      { selected: "stripe", bank_saved: true, bank_form_open: true },
      "Your bank payout is saved, so you can continue now. Connect Stripe here too, or any time from Banking.",
    ],
  ])("%s: the step's guidance", async (_, props, line) => {
    const screen = await render_choice(props);

    await expect.element(screen.getByText(line, { exact: true })).toBeVisible();
  });

  test("nothing chosen: Continue is held, described by its hint, which sits under it on its right edge", async () => {
    const onSelect = vi.fn();
    const screen = await render_choice({ onSelect });
    const next = screen.getByRole("link", { name: "Continue", exact: true });
    const hint = screen.getByText("Choose an option to continue.");

    await expect.element(next).toHaveAttribute("aria-disabled", "true");
    await expect.element(hint).toBeVisible();
    await expect
      .element(next)
      .toHaveAccessibleDescription("Choose an option to continue.");

    // the <p> is a full-width block, so its box shares Continue's right edge
    // however the text is aligned; the text's own extent is what moves
    const text = document.createRange();
    text.selectNodeContents(hint.element());
    const text_box = text.getBoundingClientRect();
    const next_box = next.element().getBoundingClientRect();
    expect(Math.abs(text_box.right - next_box.right)).toBeLessThan(1);
    expect(text_box.top).toBeGreaterThanOrEqual(next_box.bottom - 1);
    expect(text_box.top - next_box.bottom).toBeLessThan(16);

    await screen.getByText("Stripe", { exact: true }).click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("stripe");
  });

  test("an option set up: Back and Continue go where the step says", async () => {
    const screen = await render_choice({ selected: "bank", bank_saved: true });

    await expect
      .element(screen.getByRole("link", { name: "Back", exact: true }))
      .toHaveAttribute("href", "/back");
    await expect
      .element(screen.getByRole("link", { name: "Continue", exact: true }))
      .toHaveAttribute("href", "/next");
  });

  test("stripe chosen without a link: Continue is held and says why", async () => {
    const screen = await render_choice({ selected: "stripe" });

    await expect
      .element(screen.getByRole("link", { name: "Continue", exact: true }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByText("Connect Stripe to continue."))
      .toBeVisible();
  });

  test("stripe linked, no bank: Continue is open, with the nudge to add a bank", async () => {
    const screen = await render_choice({
      selected: "stripe",
      stripe_status: "incomplete",
    });

    await expect
      .element(screen.getByRole("link", { name: "Continue", exact: true }))
      .not.toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByText(/want everything to pay out/i))
      .toBeVisible();
    expect(screen.getByText("Connect Stripe to continue.").query()).toBeNull();
  });

  test("a saved bank is no nudge target: no add-a-bank line, no skip link", async () => {
    const screen = await render_choice({
      selected: "stripe",
      stripe_status: "ready",
      bank_saved: true,
    });

    expect(screen.getByText(/want everything to pay out/i).query()).toBeNull();
    expect(
      screen.getByRole("link", { name: /without a bank account/i }).query()
    ).toBeNull();
  });

  test("Stripe linked, bank saved, Change pressed: the form is open and offers no skip", async () => {
    const screen = await render_choice({
      selected: "bank",
      stripe_status: "incomplete",
      bank_saved: true,
      bank_form_open: true,
    });

    await expect
      .element(screen.getByText(/stays in place until you save a new one/i))
      .toBeVisible();
    expect(
      screen.getByRole("link", { name: /without a bank account/i }).query()
    ).toBeNull();
  });

  test("Stripe linked, no bank, form open: the skip link is offered", async () => {
    const screen = await render_choice({
      selected: "bank",
      stripe_status: "incomplete",
    });

    await expect
      .element(
        screen.getByRole("link", { name: /continue without a bank account/i })
      )
      .toHaveAttribute("href", "/next");
  });

  test("Bank chosen, nothing saved yet: the form draws its own Back, so neither Back nor Continue is here", async () => {
    const screen = await render_choice({ selected: "bank" });

    await expect.element(screen.getByText("bank slot")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back", exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Continue", exact: true }).query()
    ).toBeNull();
  });

  test("bank form open over a saved bank: the saved one stays until replaced", async () => {
    const screen = await render_choice({
      selected: "bank",
      bank_saved: true,
      bank_form_open: true,
    });

    await expect
      .element(screen.getByText(/stays in place until you save a new one/i))
      .toBeVisible();
    // the form draws its own Back and Submit
    expect(
      screen.getByRole("link", { name: "Continue", exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Back", exact: true }).query()
    ).toBeNull();
  });
});

describe("BankRequired", () => {
  const REQUIRED_LINE =
    "Your bank payout is how you get paid, so it's required. Every donation, including card, bank and wallet donations, pays out to your bank, every 3 days once your balance reaches your payout minimum.";
  const PLAIN_LINE =
    "Your bank payout is how you get paid. Every donation pays out to your bank, every 3 days once your balance reaches your payout minimum.";

  test("fiscally sponsored: badged Required, says what pays out and no more", async () => {
    const screen = await render(
      <BankRequired ineligible={{ reason: "fiscal_sponsored" }}>
        <p>form</p>
      </BankRequired>
    );

    await expect
      .element(screen.getByText("Required", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Stripe isn't available to fiscally sponsored nonprofits.",
          { exact: true }
        )
      )
      .toBeVisible();
    await expect
      .element(screen.getByText(REQUIRED_LINE, { exact: true }))
      .toBeVisible();
    expect(screen.getByText(PLAIN_LINE, { exact: true }).query()).toBeNull();
    expect(screen.container.textContent).not.toMatch(/headquartered/i);
    await expect
      .element(screen.getByText("form", { exact: true }))
      .toBeVisible();
  });

  test("outside the transfer set: names the country and where Stripe is offered", async () => {
    const screen = await render(
      <BankRequired ineligible={{ reason: "country", hq_country: "Brazil" }}>
        <p>form</p>
      </BankRequired>
    );

    await expect
      .element(
        screen.getByText(
          /^Stripe isn't available for nonprofits headquartered in Brazil\. We can send card, bank and wallet donations to a Stripe account for nonprofits headquartered in the US, Canada/
        )
      )
      .toBeVisible();
    await expect
      .element(screen.getByText(REQUIRED_LINE, { exact: true }))
      .toBeVisible();
  });

  test("routing off: no badge, no word about Stripe, and the plain paragraph", async () => {
    const screen = await render(
      <BankRequired>
        <p>form</p>
      </BankRequired>
    );

    await expect
      .element(screen.getByRole("heading", { name: "Set up your bank payout" }))
      .toBeVisible();
    await expect
      .element(screen.getByText(PLAIN_LINE, { exact: true }))
      .toBeVisible();
    expect(screen.getByText(REQUIRED_LINE, { exact: true }).query()).toBeNull();
    expect(screen.getByText("Required", { exact: true }).query()).toBeNull();
    expect(screen.container.textContent).not.toMatch(/stripe/i);
  });
});

describe("SavedBank", () => {
  test("shows the account, the statement link and the payout cadence; Change fires", async () => {
    const onChange = vi.fn();
    const screen = await render(
      <SavedBank
        account_id="acct-77"
        statement_href="https://example.com/s.pdf"
        onChange={onChange}
      />
    );

    await expect.element(screen.getByText("Saved")).toBeVisible();
    await expect.element(screen.getByText("acct-77")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Bank statement" }))
      .toHaveAttribute("href", "https://example.com/s.pdf");
    // the heading already says it: no "Bank payout:" lead-in
    await expect
      .element(
        screen
          .getByRole("region", { name: "Bank payout" })
          .getByText(
            "We send it to your bank account every 3 days once your balance reaches your payout minimum.",
            { exact: true }
          )
      )
      .toBeVisible();
    await screen.getByRole("button", { name: "Change" }).click();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
