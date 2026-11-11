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

/** the foot's rows, as text: the netting under the gross */
const foot_rows = (scope: Locator) =>
  [...scope.element().querySelectorAll("tfoot tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent)
  );

/** the headline's label, amount and any line under it, as one text */
const headline = (scope: Locator) =>
  scope.getByText("Held right now").element().parentElement?.textContent;

const no_wise = (scope: Locator) =>
  expect(scope.element().textContent).not.toMatch(/wise|money-transfer/i);

describe("held card, net of what is owed", () => {
  const AFTER_OWED = "After amounts you owe Better Giving";

  test.each([
    ["Banking", HeldMoneyCard],
    ["Payouts", PayoutsHeldCard],
  ])(
    "%s: the headline is the net, and the table's foot takes the gross down to it",
    async (_, Card) => {
      const screen = await in_router(
        <Card {...base} held={{ ...HELD, net: 1500 }} />
      );
      const region = screen.getByRole("region");
      await expect.element(region.getByText(AFTER_OWED)).toBeVisible();
      expect(headline(region)).toBe(`Held right now$1,500.00${AFTER_OWED}`);
      expect(foot_rows(region)).toEqual([
        ["Owed to Better Giving", "-$284.50"],
        ["Total", "$1,500.00"],
      ]);
      expect(region.element().textContent).not.toContain("less any refunds");
    }
  );

  test("owing all of it: 0, said plainly, and no payout promised", async () => {
    const screen = await in_router(
      <HeldMoneyCard {...base} held={{ ...HELD, net: 0 }} />
    );
    const region = screen.getByRole("region");
    const covered =
      "What you owe Better Giving covers all of it, so none of it will pay out to you.";
    await expect.element(region.getByText(covered)).toBeVisible();
    expect(headline(region)).toBe(`Held right now$0.00${covered}`);
    expect(foot_rows(region)).toEqual([
      ["Owed to Better Giving", "-$1,784.50"],
      ["Total", "$0.00"],
    ]);
    expect(region.element().textContent).not.toMatch(/pays out with/);
    expect(region.element().textContent).not.toContain(AFTER_OWED);
    // a bank still pays out what arrives next
    await expect
      .element(region.getByRole("link", { name: "Add bank account" }))
      .toBeVisible();
  });

  test("owed money back: the foot adds it, and the headline says so", async () => {
    const screen = await in_router(
      <PayoutsHeldCard {...base} held={{ ...HELD, net: 1800 }} />
    );
    const region = screen.getByRole("region");
    const caption = "With amounts Better Giving owes you";
    await expect.element(region.getByText(caption)).toBeVisible();
    expect(headline(region)).toBe(`Held right now$1,800.00${caption}`);
    expect(foot_rows(region)).toEqual([
      ["Due back to you from Better Giving", "$15.50"],
      ["Total", "$1,800.00"],
    ]);
  });

  test.each([
    ["no net given", undefined],
    ["a net equal to the total", HELD.total],
  ])("%s: shows the total, no line and no foot", async (_, net) => {
    const screen = await in_router(
      <HeldMoneyCard {...base} held={{ ...HELD, net }} />
    );
    const region = screen.getByRole("region");
    await expect.element(region.getByText("Held right now")).toBeVisible();
    expect(headline(region)).toBe("Held right now$1,784.50");
    expect(region.element().querySelector("tfoot")).toBeNull();
  });
});

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
          "Stripe can only receive card, bank and wallet donations. The rest can't go to Stripe, so they stay in your Better Giving balance until you add a bank account. Nothing is lost."
        )
      )
      .toBeVisible();
    await expect.element(card.getByText("Held right now")).toBeVisible();
    await expect
      .element(card.getByText("$1,784.50", { exact: true }))
      .toBeVisible();
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
    await expect
      .element(card.getByText("$2,310.00", { exact: true }))
      .toBeVisible();
    expect(body_rows(card)[0]).toEqual([
      "Card, bank and wallet donations",
      "$525.50",
    ]);
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
  "Card, bank and wallet donations that arrive before your Stripe account is ready wait here, along with the donations Stripe can't receive. They stay in your Better Giving balance until you add a bank account. Nothing is lost.";

const WITH_STRIPE: IHeldMoney = {
  total: 2310,
  by_rail: [{ rail: "stripe", amount: 525.5 }, ...HELD.by_rail],
  // the newest last, so its first place is the sort's doing
  items: [
    ...HELD.items,
    { rail: "stripe", date: "2026-10-31T15:00:00Z", amount: 525.5 },
  ],
};

describe("Stripe linked, card, bank and wallet donations held", () => {
  test("Banking: the lead says card, bank and wallet donations wait too, and the table lists them", async () => {
    const screen = await in_router(
      <HeldMoneyCard {...base} held={WITH_STRIPE} />
    );
    const card = screen.getByRole("region", {
      name: "Waiting for a bank account",
    });
    await expect.element(card.getByText(STRIPE_LEAD)).toBeVisible();
    expect(card.getByText(/These can't go to Stripe/).query()).toBeNull();
    expect(body_rows(card)[0]).toEqual([
      "Card, bank and wallet donations",
      "$525.50",
    ]);
    await expect
      .element(card.getByText("$2,310.00", { exact: true }))
      .toBeVisible();
  });

  test("Payouts: the lead says card, bank and wallet donations wait too, and the table lists them", async () => {
    const screen = await in_router(
      <PayoutsHeldCard {...base} held={WITH_STRIPE} />
    );
    const card = screen.getByRole("region", {
      name: "On hold until you add a bank account",
    });
    await expect.element(card.getByText(STRIPE_LEAD)).toBeVisible();
    expect(card.getByText(/everything else waits/).query()).toBeNull();
    expect(body_rows(card)[0]).toEqual([
      "Card, bank or wallet donation",
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
          "Stripe can only receive card, bank and wallet donations, so everything else waits in your Better Giving balance. Nothing is lost."
        )
      )
      .toBeVisible();
    await expect
      .element(card.getByText("$1,784.50", { exact: true }))
      .toBeVisible();
    expect(body_rows(card)).toEqual([
      ["PayPal donation", "Oct 30, 2026", "$640.00"],
      ["DAF grant", "Oct 28, 2026", "$420.00"],
      ["Savings withdrawal", "Oct 27, 2026", "$500.00"],
      ["Crypto donation", "Oct 25, 2026", "$150.50"],
      ["Stock or cheque donation", "Oct 22, 2026", "$74.00"],
    ]);
    await expect
      .element(card.getByRole("link", { name: "Add bank account" }))
      .toBeVisible();
    no_wise(card);
  });

  // chromium takes the host's zone, UTC in CI, so this can't tell a UTC day
  // from a local one: `to_utc_day`'s own test pins a western zone
  test("dates a payout by its UTC day", async () => {
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
      ["Stock or cheque donation", "Jul 4, 2026", "$74.00"],
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

describe("a bank account under review", () => {
  test.each<[string, typeof HeldMoneyCard, string, string]>([
    [
      "Banking",
      HeldMoneyCard,
      "Waiting for your bank account to be approved",
      "Stripe can only receive card, bank and wallet donations. The rest can't go to Stripe, so they stay in your Better Giving balance until your bank account is approved. Nothing is lost.",
    ],
    [
      "Payouts",
      PayoutsHeldCard,
      "On hold until your bank account is approved",
      "Stripe can only receive card, bank and wallet donations, so everything else waits in your Better Giving balance until your bank account is approved. Nothing is lost.",
    ],
  ])(
    "%s, Stripe linked: the money waits for the review, and no bank is asked for",
    async (_, Card, heading, lead) => {
      const screen = await in_router(<Card {...base} bank_pending />);
      const card = screen.getByRole("region", { name: heading });
      await expect.element(card.getByText(lead)).toBeVisible();
      await expect
        .element(
          card.getByText(
            "Once your bank account is approved, this money pays out with your bank payout, less any refunds or disputes owed, once your balance reaches your payout minimum."
          )
        )
        .toBeVisible();
      expect(card.getByRole("link").query()).toBeNull();
      expect(card.element().textContent).not.toMatch(/add a bank/i);
    }
  );

  test("Stripe disconnected: the money waits for the review, and Stripe can be connected again", async () => {
    const screen = await in_router(
      <HeldMoneyCard {...base} rails="none" bank_pending held={WITH_STRIPE} />
    );
    const card = screen.getByRole("region", {
      name: "Waiting for your bank account to be approved",
    });
    await expect
      .element(
        card.getByText(
          "Stripe is disconnected and your bank account is still under review, so every donation is held in your Better Giving balance. Nothing is lost. It pays out once your bank account is approved, or connect Stripe again to get paid there."
        )
      )
      .toBeVisible();
    expect(
      card.getByRole("link", { name: "Add bank account" }).query()
    ).toBeNull();
    await expect
      .element(card.getByRole("link", { name: "Connect Stripe" }))
      .toHaveAttribute("href", base.connect_href);
  });

  test("Banking's bank section says the bank is under review, and offers no Add", async () => {
    const screen = await in_router(
      <BankPayoutSection
        add_href="new"
        table={<p>accounts table</p>}
        stripe_status="incomplete"
        holds_money={false}
        bank_pending
      />
    );
    const section = screen.getByRole("region", { name: "Bank payout" });
    await expect
      .element(
        section.getByText(
          "Your bank account is under review. Bank payouts start once it's approved.",
          { exact: false }
        )
      )
      .toBeVisible();
    expect(section.getByRole("link").query()).toBeNull();
  });
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
          "We send it to your bank account every 3 days once your balance reaches your payout minimum.",
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
        screen.getByText(
          "Everything except card, bank and wallet donations pays out here."
        )
      )
      .toBeVisible();
  });

  test.each<[TConnectStatus, string]>([
    [
      "ready",
      "Add one to release held money and have everything else pay out to your bank.",
    ],
    // before ready, card, bank and wallet donations wait for a bank too
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
          .getByText(
            "Everything except card, bank and wallet donations pays out here."
          )
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

describe("held-money figures", () => {
  test.each([
    ["Banking", HeldMoneyCard],
    ["Payouts", PayoutsHeldCard],
  ])("%s: stay tabular and carry no slashed zero", async (_, Card) => {
    const screen = await in_router(<Card {...base} />);
    const tables = [...screen.container.querySelectorAll("table")];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      const features = getComputedStyle(table).fontFeatureSettings;
      expect(features).toContain("tnum");
      expect(features).not.toContain("zero");
    }
  });
});
