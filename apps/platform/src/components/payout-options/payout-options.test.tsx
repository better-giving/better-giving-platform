import type { ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { TConnectStatus } from "@/stripe-connect/readiness";
import { BankRequired } from "./bank-required";
import { type IPayoutChoice, PayoutChoice } from "./payout-choice";
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
        first: "Until then they're held.",
        others: "until you add a bank account.",
        held: 2,
      },
    ],
    [
      "incomplete",
      false,
      {
        first: "Until then they're held.",
        others: "until you add a bank account.",
        held: 2,
      },
    ],
    [
      "not_connected",
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
      // the card's own wording differs by state; "Held" is the badge, never prose
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

  test("choosing one collapses the other to its summary", async () => {
    const screen = await render_choice({ selected: "stripe" });

    expect(cards(screen).length).toBe(1);
    await expect
      .element(screen.getByText("One payout for everything."))
      .toBeVisible();
    await expect
      .element(screen.getByText(/go straight to your Stripe account/i))
      .toBeVisible();
  });
});

describe("PayoutChoice hints and intro", () => {
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
  });
});

describe("BankRequired", () => {
  test("fiscally sponsored: badged Required, says what pays out and no more", async () => {
    const screen = await render(
      <BankRequired ineligible={{ reason: "fiscal_sponsored" }}>
        <p>form</p>
      </BankRequired>
    );
    const text = screen.container.textContent ?? "";

    await expect
      .element(screen.getByText("Required", { exact: true }))
      .toBeVisible();
    expect(text).toContain("fiscally sponsored");
    expect(text).toContain("including card, bank and wallet donations");
    expect(text).toContain("pays out to your bank");
    expect(text).not.toMatch(/headquartered/i);
    await expect.element(screen.getByText("form")).toBeVisible();
  });

  test("outside the transfer set: names the country and where Stripe is offered", async () => {
    const screen = await render(
      <BankRequired ineligible={{ reason: "country", hq_country: "Brazil" }}>
        <p>form</p>
      </BankRequired>
    );
    const text = screen.container.textContent ?? "";

    expect(text).toContain("headquartered in Brazil");
    expect(text).toMatch(/card, bank and wallet donations to nonprofits/);
    expect(text).toContain("the US, Canada");
  });

  test("routing off: no badge and no word about Stripe", async () => {
    const screen = await render(
      <BankRequired>
        <p>form</p>
      </BankRequired>
    );

    await expect
      .element(screen.getByRole("heading", { name: "Set up your bank payout" }))
      .toBeVisible();
    expect(screen.getByText("Required", { exact: true }).query()).toBeNull();
    expect(screen.container.textContent).not.toMatch(/stripe/i);
    expect(screen.container.textContent).toContain("pays out to your bank");
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
    await expect
      .element(screen.getByText(/every 3 days/i))
      .toMatchTextContent(/payout minimum/);
    await screen.getByRole("button", { name: "Change" }).click();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
