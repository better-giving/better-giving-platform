import type { ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import type { Locator } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { IHeldMoney } from "@/payouts";
import type { TConnectStatus } from "@/stripe-connect/readiness";
import { BankPayoutSection } from "./bank-payout-section";
import {
  HeldMoneyCard,
  type IHeldMoneyCard,
  PayoutsHeldCard,
} from "./held-money";

/** `Button`'s link form needs a router around it */
const in_router = (node: ReactNode) => {
  const Stub = createRoutesStub([{ path: "/", Component: () => node }]);
  return render(<Stub />);
};

const HELD: IHeldMoney = {
  total: 1784.5,
  by_rail: [
    { rail: "paypal", amount: 640 },
    { rail: "daf", amount: 420 },
    { rail: "crypto", amount: 150.5 },
    { rail: "stock_cheque", amount: 74 },
    { rail: "withdrawal", amount: 500 },
  ],
  // out of order on purpose: the card sorts newest first
  items: [
    { rail: "crypto", date: "2026-10-25T15:00:00Z", amount: 150.5 },
    { rail: "daf", date: "2026-10-28T15:00:00Z", amount: 420 },
    { rail: "stock_cheque", date: "2026-10-22T15:00:00Z", amount: 74 },
    { rail: "paypal", date: "2026-10-30T15:00:00Z", amount: 640 },
    { rail: "withdrawal", date: "2026-10-27T15:00:00Z", amount: 500 },
  ],
};

const NOTHING: IHeldMoney = { total: 0, by_rail: [], items: [] };

const base: IHeldMoneyCard = {
  held: HELD,
  rails: "stripe",
  add_bank_href: "/admin/42/banking/new",
  connect_href: "/api/stripe-connect/start?kind=npo&npo_id=42",
};

/** each body row's cells, as text */
const body_rows = (scope: Locator) =>
  [...scope.element().querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent)
  );

const no_wise = (scope: Locator) =>
  expect(scope.element().textContent).not.toMatch(/wise|money-transfer/i);

describe("HeldMoneyCard: Banking", () => {
  test("nothing held: nothing renders", async () => {
    const screen = await in_router(
      <>
        <HeldMoneyCard {...base} held={NOTHING} />
        <PayoutsHeldCard {...base} held={NOTHING} />
        <p>page</p>
      </>
    );
    await expect.element(screen.getByText("page")).toBeVisible();
    expect(screen.getByRole("region").query()).toBeNull();
    expect(screen.getByText("Held right now").query()).toBeNull();
  });

  test("Stripe only: why it waits, the total, what waits, and the one way to release it", async () => {
    const screen = await in_router(<HeldMoneyCard {...base} />);
    const card = screen.getByRole("region", {
      name: "Waiting for a bank account",
    });

    await expect.element(card.getByText("Held", { exact: true })).toBeVisible();
    await expect
      .element(
        card.getByText(
          "Stripe can only receive Stripe donations. These can't go to Stripe, so they stay in your Better Giving balance until you add a bank account. Nothing is lost."
        )
      )
      .toBeVisible();
    await expect.element(card.getByText("Held right now")).toBeVisible();
    await expect.element(card.getByText("$1,784.50")).toBeVisible();
    await expect
      .element(card.getByText("What's waiting", { exact: true }))
      .toBeVisible();
    expect(body_rows(card)).toEqual([
      ["PayPal donations", "$640.00"],
      ["DAF grants", "$420.00"],
      ["Crypto donations", "$150.50"],
      ["Stock and cheque donations", "$74.00"],
      ["Savings and Investments withdrawals", "$500.00"],
    ]);
    await expect
      .element(
        card.getByText(
          "Once you add a bank account, this money pays out with your bank payout, less any refunds or disputes owed, once your balance reaches your payout minimum."
        )
      )
      .toBeVisible();
    await expect
      .element(card.getByRole("link", { name: "Add bank account" }))
      .toHaveAttribute("href", "/admin/42/banking/new");
    // Stripe is already linked: nothing to connect
    expect(
      card.getByRole("link", { name: "Connect Stripe" }).query()
    ).toBeNull();
    no_wise(card);
  });

  test("neither rail: every donation waits, and both ways to get paid are offered", async () => {
    const screen = await in_router(
      <HeldMoneyCard
        {...base}
        rails="none"
        held={{
          ...HELD,
          total: 2310,
          by_rail: [{ rail: "stripe", amount: 525.5 }, ...HELD.by_rail],
        }}
      />
    );
    const card = screen.getByRole("region", {
      name: "No way to get paid right now",
    });

    await expect
      .element(
        card.getByText(
          "Stripe is disconnected and you have no bank account, so every donation is held in your Better Giving balance. Nothing is lost. Add a bank account or connect Stripe again to get paid."
        )
      )
      .toBeVisible();
    await expect.element(card.getByText("$2,310.00")).toBeVisible();
    expect(body_rows(card)[0]).toEqual(["Stripe donations", "$525.50"]);
    await expect
      .element(card.getByRole("link", { name: "Add bank account" }))
      .toHaveAttribute("href", "/admin/42/banking/new");
    await expect
      .element(card.getByRole("link", { name: "Connect Stripe" }))
      .toHaveAttribute("href", base.connect_href);
    no_wise(card);
  });

  test("the card's edge is the warning edge, not the hairline", async () => {
    const screen = await in_router(
      <>
        <HeldMoneyCard {...base} />
        <span data-testid="probe" className="border border-warning" />
      </>
    );
    const card = screen.getByRole("region", {
      name: "Waiting for a bank account",
    });
    await expect.element(card).toBeVisible();
    const edge = (l: Locator) => getComputedStyle(l.element()).borderTopColor;
    expect(edge(card)).toBe(edge(screen.getByTestId("probe")));
  });
});

// Stripe linked but not yet ready (incomplete, pending) holds Stripe gifts too,
// and a gift held then still waits once Stripe is ready: the lead follows the
// table, whatever the status
const STRIPE_LEAD =
  "Stripe donations that arrive before your Stripe account is ready wait here, along with the donations Stripe can't receive. They stay in your Better Giving balance until you add a bank account. Nothing is lost.";

const WITH_STRIPE: IHeldMoney = {
  total: 2310,
  by_rail: [{ rail: "stripe", amount: 525.5 }, ...HELD.by_rail],
  // the newest last, so its first place is the sort's doing
  items: [
    ...HELD.items,
    { rail: "stripe", date: "2026-10-31T15:00:00Z", amount: 525.5 },
  ],
};

describe("Stripe linked, Stripe donations held", () => {
  test("Banking: the lead says Stripe donations wait too, and the table lists them", async () => {
    const screen = await in_router(
      <HeldMoneyCard {...base} held={WITH_STRIPE} />
    );
    const card = screen.getByRole("region", {
      name: "Waiting for a bank account",
    });
    await expect.element(card.getByText(STRIPE_LEAD)).toBeVisible();
    expect(card.getByText(/These can't go to Stripe/).query()).toBeNull();
    expect(body_rows(card)[0]).toEqual(["Stripe donations", "$525.50"]);
    await expect.element(card.getByText("$2,310.00")).toBeVisible();
  });

  test("Payouts: the lead says Stripe donations wait too, and the table lists them", async () => {
    const screen = await in_router(
      <PayoutsHeldCard {...base} held={WITH_STRIPE} />
    );
    const card = screen.getByRole("region", {
      name: "On hold until you add a bank account",
    });
    await expect.element(card.getByText(STRIPE_LEAD)).toBeVisible();
    expect(card.getByText(/everything else waits/).query()).toBeNull();
    expect(body_rows(card)[0]).toEqual([
      "Stripe donations",
      "Oct 31, 2026",
      "$525.50",
    ]);
  });
});

describe("PayoutsHeldCard: Payouts", () => {
  test("Stripe only: one row per waiting payout, labelled by its rail, newest first", async () => {
    const screen = await in_router(<PayoutsHeldCard {...base} />);
    const card = screen.getByRole("region", {
      name: "On hold until you add a bank account",
    });

    await expect
      .element(
        card.getByText(
          "Stripe can only receive Stripe donations, so everything else waits in your Better Giving balance. Nothing is lost."
        )
      )
      .toBeVisible();
    await expect.element(card.getByText("$1,784.50")).toBeVisible();
    expect(body_rows(card)).toEqual([
      ["PayPal donations", "Oct 30, 2026", "$640.00"],
      ["DAF grants", "Oct 28, 2026", "$420.00"],
      ["Savings and Investments withdrawals", "Oct 27, 2026", "$500.00"],
      ["Crypto donations", "Oct 25, 2026", "$150.50"],
      ["Stock and cheque donations", "Oct 22, 2026", "$74.00"],
    ]);
    await expect
      .element(card.getByRole("link", { name: "Add bank account" }))
      .toBeVisible();
    no_wise(card);
  });

  test("dates a payout by its UTC day, whatever the viewer's zone", async () => {
    const screen = await in_router(
      <PayoutsHeldCard
        {...base}
        held={{
          total: 74,
          by_rail: [{ rail: "stock_cheque", amount: 74 }],
          items: [
            { rail: "stock_cheque", date: "2026-07-04T00:00:00Z", amount: 74 },
          ],
        }}
      />
    );
    const card = screen.getByRole("region", {
      name: "On hold until you add a bank account",
    });
    expect(body_rows(card)).toEqual([
      ["Stock and cheque donations", "Jul 4, 2026", "$74.00"],
    ]);
  });
});

test("both held tables right-align Amount, header and cells alike", async () => {
  const screen = await in_router(
    <>
      <HeldMoneyCard {...base} />
      <PayoutsHeldCard {...base} />
    </>
  );
  await expect
    .element(screen.getByText("On hold until you add a bank account"))
    .toBeVisible();
  const regions = screen.getByRole("region").all();
  expect(regions).toHaveLength(2);
  for (const region of regions) {
    const amounts = [
      ...region.element().querySelectorAll("tr > :last-child"),
    ].map((c) => getComputedStyle(c).textAlign);
    expect(amounts.length).toBeGreaterThan(1);
    expect(new Set(amounts)).toEqual(new Set(["right"]));
  }
});

describe("BankPayoutSection: Banking", () => {
  const TABLE = <p>accounts table</p>;
  const render_section = (p: {
    table?: ReactNode;
    stripe_status: TConnectStatus;
    holds_money: boolean;
  }) => in_router(<BankPayoutSection add_href="new" {...p} />);

  test("bank only: the payout line, the accounts, and Add bank account", async () => {
    const screen = await render_section({
      table: TABLE,
      stripe_status: "not_connected",
      holds_money: false,
    });
    const section = screen.getByRole("region", { name: "Bank payout" });
    await expect
      .element(
        section.getByText(
          "Bank payout: we send it to your bank account every 3 days once your balance reaches your payout minimum.",
          { exact: true }
        )
      )
      .toBeVisible();
    await expect.element(section.getByText("accounts table")).toBeVisible();
    await expect
      .element(section.getByRole("link", { name: "Add bank account" }))
      .toHaveAttribute("href", "/new");
    no_wise(section);
  });

  test("bank and Stripe ready: says what the bank no longer gets", async () => {
    const screen = await render_section({
      table: TABLE,
      stripe_status: "ready",
      holds_money: false,
    });
    await expect
      .element(
        screen.getByText("Everything except Stripe donations pays out here.")
      )
      .toBeVisible();
  });

  test.each<[TConnectStatus, string]>([
    [
      "ready",
      "Add one to release held money and have everything else pay out to your bank.",
    ],
    // before ready, Stripe donations wait for a bank too
    [
      "incomplete",
      "Add one to release held money and get everything paid out to your bank.",
    ],
    [
      "pending",
      "Add one to release held money and get everything paid out to your bank.",
    ],
    [
      "disconnected",
      "Add one to release held money and get everything paid out to your bank.",
    ],
  ])(
    "no bank, Stripe %s, money held: the empty state says what a bank releases, and the held card keeps the one Add",
    async (stripe_status, line) => {
      const screen = await render_section({ stripe_status, holds_money: true });
      const section = screen.getByRole("region", { name: "Bank payout" });
      await expect
        .element(section.getByText("No bank account yet"))
        .toBeVisible();
      await expect.element(section.getByText(line)).toBeVisible();
      expect(section.getByRole("link").query()).toBeNull();
      expect(
        section
          .getByText("Everything except Stripe donations pays out here.")
          .query()
      ).toBeNull();
      no_wise(section);
    }
  );

  test("no bank, nothing held: the section keeps its own Add", async () => {
    const screen = await render_section({
      stripe_status: "ready",
      holds_money: false,
    });
    const section = screen.getByRole("region", { name: "Bank payout" });
    await expect
      .element(
        section.getByText(
          "Add one to have everything else pay out to your bank."
        )
      )
      .toBeVisible();
    await expect
      .element(section.getByRole("link", { name: "Add bank account" }))
      .toBeVisible();
  });
});
