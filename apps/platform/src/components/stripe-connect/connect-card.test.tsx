import { AskHost } from "@better-giving/ui";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TRANSFER_COUNTRIES_COPY } from "@/stripe-connect/eligibility";
import { type IStripeConnectCard, StripeConnectCard } from "./connect-card";

const START = "/api/stripe-connect/start?npo=42";

/** the confirm is raised through `ask`, which mounts at `AskHost`. */
const render_card = (props: Partial<IStripeConnectCard> = {}) =>
  render(
    <>
      <StripeConnectCard
        status="not_connected"
        start_href={START}
        has_bank
        {...props}
      />
      <AskHost />
    </>
  );

/** records where each link press would have navigated, and stops it — a real
 *  navigation would take the test page with it. */
function capture_navigation() {
  const hrefs: string[] = [];
  const on_click = (e: MouseEvent) => {
    const a = (e.target as Element).closest("a");
    if (!a) return;
    e.preventDefault();
    hrefs.push(a.getAttribute("href") ?? "");
  };
  document.addEventListener("click", on_click, { capture: true });
  return {
    hrefs,
    stop: () =>
      document.removeEventListener("click", on_click, { capture: true }),
  };
}

let nav: ReturnType<typeof capture_navigation> | undefined;
afterEach(() => {
  nav?.stop();
  nav = undefined;
});

describe("StripeConnectCard", () => {
  test("not connected: connecting is a plain link to the start url", async () => {
    const screen = await render_card();

    await expect
      .element(screen.getByText("Not connected", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Connect Stripe" }))
      .toHaveAttribute("href", START);
    await expect
      .element(
        screen.getByRole("button", { name: /connect a different account/i })
      )
      .not.toBeInTheDocument();
  });

  test("disconnected: connecting again is a plain link to the start url, no confirm", async () => {
    nav = capture_navigation();
    const screen = await render_card({ status: "disconnected" });

    await expect
      .element(screen.getByText("Disconnected", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("button", { name: /connect a different account/i })
      )
      .not.toBeInTheDocument();
    const reconnect = screen.getByRole("link", { name: "Connect Stripe" });
    await expect.element(reconnect).toHaveAttribute("href", START);
    await reconnect.click();
    // one press leaves for Stripe — without replace=1, and nothing asked first
    expect(nav.hrefs).toEqual([START]);
    expect(screen.getByRole("dialog").query()).toBeNull();
  });

  test.each<IStripeConnectCard["status"]>(["not_connected", "disconnected"])(
    "%s, money held: the held card above carries Connect Stripe, so this card offers none",
    async (status) => {
      const screen = await render_card({
        status,
        has_bank: false,
        holds_money: true,
      });
      const card = screen.getByRole("region", { name: "Stripe account" });
      await expect.element(card).toBeVisible();
      expect(
        card.getByRole("link", { name: "Connect Stripe" }).query()
      ).toBeNull();
      expect(card.getByRole("button").query()).toBeNull();
    }
  );

  test("disconnected, money held: the body says only what the held card above doesn't", async () => {
    const screen = await render_card({
      status: "disconnected",
      has_bank: false,
      holds_money: true,
    });
    const card = screen.getByRole("region", { name: "Stripe account" });
    await expect
      .element(
        card.getByText(
          "Donations already sent to your Stripe account stay there.",
          { exact: true }
        )
      )
      .toBeVisible();
    expect(card.element().textContent).not.toMatch(
      /was disconnected from your Stripe account|Connect Stripe again/
    );
  });

  test("incomplete, money held: switching accounts stays, the held card offers no connect then", async () => {
    const screen = await render_card({
      status: "incomplete",
      has_bank: false,
      holds_money: true,
    });
    await expect
      .element(
        screen.getByRole("button", { name: /connect a different account/i })
      )
      .toBeVisible();
  });

  test.each<IStripeConnectCard["status"]>(["incomplete", "pending", "ready"])(
    "%s: offers switching accounts, never connecting",
    async (status) => {
      const screen = await render_card({ status });
      await expect
        .element(
          screen.getByRole("button", { name: /connect a different account/i })
        )
        .toBeVisible();
      await expect
        .element(screen.getByRole("link", { name: "Connect Stripe" }))
        .not.toBeInTheDocument();
    }
  );

  test("connected: switching accounts waits for a confirm, then goes with replace=1", async () => {
    nav = capture_navigation();
    const screen = await render_card({ status: "ready" });

    await expect
      .element(
        screen.getByText("Ready to receive card, bank and wallet donations")
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Connect Stripe" }))
      .not.toBeInTheDocument();

    await screen
      .getByRole("button", { name: /connect a different account/i })
      .click();

    const dialog = screen.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    // the press only asked — nothing has navigated yet
    expect(nav.hrefs).toEqual([]);
    // the dismiss control holds focus, not the one that commits
    await expect
      .element(screen.getByRole("button", { name: /keep current account/i }))
      .toHaveFocus();

    // dialog content sits behind the backdrop layer; a native click passes it
    (
      screen
        .getByRole("link", { name: /continue to stripe/i })
        .element() as HTMLElement
    ).click();
    expect(nav.hrefs).toEqual([`${START}&replace=1`]);
  });

  test("connected: keeping the current account closes the confirm without navigating", async () => {
    nav = capture_navigation();
    const screen = await render_card({
      status: "pending",
      start_href: "/api/stripe-connect/start",
    });

    await screen
      .getByRole("button", { name: /connect a different account/i })
      .click();
    // no query string on the start url: the flag opens one
    await expect
      .element(screen.getByRole("link", { name: /continue to stripe/i }))
      .toHaveAttribute("href", "/api/stripe-connect/start?replace=1");

    (
      screen
        .getByRole("button", { name: /keep current account/i })
        .element() as HTMLElement
    ).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(nav.hrefs).toEqual([]);
  });

  test.each<[IStripeConnectCard["notice"], RegExp]>([
    [{ result: "connected" }, /your stripe account is connected/i],
    [{ result: "denied" }, /didn't approve access on stripe/i],
    [{ result: "error" }, /couldn't connect your stripe account/i],
    [
      { result: "error", reason: "already_linked" },
      /already linked to another nonprofit/i,
    ],
    [
      { result: "error", reason: "replace_unconfirmed" },
      /wasn't changed.*confirm/i,
    ],
    [{ result: "error", reason: "expired" }, /timed out/i],
    [
      { result: "error", reason: "forbidden" },
      /don't have permission to connect/i,
    ],
    [
      { result: "error", reason: "failed" },
      /couldn't connect your stripe account/i,
    ],
  ])("notice %o reads its message and takes focus", async (notice, message) => {
    const screen = await render_card({ status: "not_connected", notice });

    const band = screen.getByText(message);
    await expect.element(band).toBeVisible();
    // arriving back from Stripe is a full page load; focus is what carries the
    // outcome to a screen reader
    await vi.waitFor(() =>
      expect((band.element() as HTMLElement).closest("[tabindex='-1']")).toBe(
        document.activeElement
      )
    );
  });

  const FIRST =
    "card, bank and wallet donations (like Apple Pay, Google Pay and Link)";
  const SPLIT =
    "go straight to your Stripe account as each donation's own transfer, after fees. They skip your Grant, Savings and Investments split.";
  const NOT_CONNECTED_WITH_BANK = `Once Stripe says your account is ready, ${FIRST} ${SPLIT} Until then, they go to your bank.`;
  const NOT_CONNECTED_HELD = `Once Stripe says your account is ready, ${FIRST} ${SPLIT} Until then, they're held in your Better Giving balance.`;
  const BOTH_READY = `Card, bank and wallet donations (like Apple Pay, Google Pay and Link) ${SPLIT} What Stripe pays on to the bank on your Stripe account is in your Stripe dashboard. If you disconnect Better Giving in your Stripe dashboard, card, bank and wallet donations go to your bank again.`;
  const STRIPE_ONLY_READY = `Card, bank and wallet donations (like Apple Pay, Google Pay and Link) ${SPLIT} What Stripe pays on to the bank on your Stripe account is in your Stripe dashboard.`;
  const DISCONNECTED =
    "Better Giving was disconnected from your Stripe account in your Stripe dashboard. Connect Stripe again to get card, bank and wallet donations (like Apple Pay, Google Pay and Link) straight to your Stripe account, after fees, once Stripe says your account is ready. Donations already sent to your Stripe account stay there.";
  const DISCONNECTED_WITH_BANK = [
    "Better Giving was disconnected from your Stripe account in your Stripe dashboard. Card, bank and wallet donations (like Apple Pay, Google Pay and Link) now go to your bank.",
    "Connect Stripe again to get them straight to your Stripe account, after fees, once Stripe says your account is ready. Donations already sent to your Stripe account stay there.",
  ];
  const INCOMPLETE_BANK = [
    "Stripe needs a few more details before it can receive donations. Finish setup on Stripe, in your Stripe dashboard.",
    "Until you do and Stripe says your account is ready, card, bank and wallet donations (like Apple Pay, Google Pay and Link) go to your bank, so nothing is lost. Then each one goes straight to your Stripe account, after fees, and skips your Grant, Savings and Investments split.",
  ];
  const PENDING_BANK =
    "Stripe is reviewing your account. Until it's ready, card, bank and wallet donations (like Apple Pay, Google Pay and Link) go to your bank.";
  const INCOMPLETE_HELD =
    "Your Stripe account is connected, but Stripe hasn't finished setting it up. Finish on Stripe. Until it's ready, your card, bank and wallet donations are held too.";
  const PENDING_HELD =
    "Stripe is reviewing your account. Until it's ready, your card, bank and wallet donations are held too.";
  const CONNECTED = "Your Stripe account is connected.";

  // every paragraph and band the card can show, so each case can say which
  // of them it must not carry
  const ALL = [
    NOT_CONNECTED_WITH_BANK,
    NOT_CONNECTED_HELD,
    DISCONNECTED,
    ...DISCONNECTED_WITH_BANK,
    ...INCOMPLETE_BANK,
    PENDING_BANK,
    BOTH_READY,
    STRIPE_ONLY_READY,
    INCOMPLETE_HELD,
    PENDING_HELD,
    CONNECTED,
  ];

  test.each<[IStripeConnectCard["status"], boolean, string[]]>([
    ["not_connected", true, [NOT_CONNECTED_WITH_BANK]],
    ["not_connected", false, [NOT_CONNECTED_HELD]],
    ["disconnected", true, DISCONNECTED_WITH_BANK],
    ["disconnected", false, [DISCONNECTED]],
    ["incomplete", true, INCOMPLETE_BANK],
    ["incomplete", false, [INCOMPLETE_HELD]],
    ["pending", true, [PENDING_BANK]],
    ["pending", false, [PENDING_HELD]],
    ["ready", true, [BOTH_READY]],
    ["ready", false, [STRIPE_ONLY_READY]],
  ])(
    "%s, bank on file %s: names the methods Stripe receives and says what happens to them, and nothing another state says",
    async (status, has_bank, phrases) => {
      const screen = await render_card({ status, has_bank });
      const card = screen.getByRole("region", { name: "Stripe account" });

      for (const phrase of phrases) {
        await expect.element(card.getByText(phrase)).toBeVisible();
      }
      const text = card.element().textContent ?? "";
      for (const other of ALL.filter(
        (p) => !phrases.some((own) => own.includes(p))
      )) {
        expect(text).not.toContain(other);
      }
      expect(text).not.toMatch(/wise|money-transfer/i);
    }
  );

  test.each<IStripeConnectCard["status"]>(["incomplete", "ready"])(
    "%s, brief (step 4): the status, and its band where it has one, no body",
    async (status) => {
      const screen = await render_card({
        status,
        has_bank: false,
        brief: true,
        heading_level: 3,
      });
      const card = screen.getByRole("region", { name: "Stripe account" });
      await expect
        .element(card.getByRole("heading", { level: 3 }))
        .toHaveTextContent("Stripe account");
      await expect
        .element(
          card.getByText(
            status === "ready"
              ? "Ready to receive card, bank and wallet donations"
              : INCOMPLETE_HELD
          )
        )
        .toBeVisible();
      expect(card.getByText(STRIPE_ONLY_READY).query()).toBeNull();
      expect(card.getByText(CONNECTED).query()).toBeNull();
      await expect
        .element(
          card.getByRole("button", { name: /connect a different account/i })
        )
        .toBeVisible();
    }
  );

  const DISCONNECTED_BRIEF =
    "Better Giving was disconnected from your Stripe account in your Stripe dashboard.";
  const KEPT_ON_STRIPE =
    "Donations already sent to your Stripe account stay there.";

  test("pending, brief (step 4, no bank): the band alone", async () => {
    const screen = await render_card({
      status: "pending",
      has_bank: false,
      brief: true,
      heading_level: 3,
    });
    const card = screen.getByRole("region", { name: "Stripe account" });

    await expect.element(card.getByText(PENDING_HELD)).toBeVisible();
    const text = card.element().textContent ?? "";
    for (const other of ALL.filter((p) => p !== PENDING_HELD)) {
      expect(text).not.toContain(other);
    }
  });

  // the Stripe option row above says where card, bank and wallet donations go
  // until and once the account is ready, so the body keeps only the rest
  test.each<[IStripeConnectCard["status"], boolean, string[]]>([
    ["not_connected", false, []],
    ["not_connected", true, []],
    ["disconnected", false, [`${DISCONNECTED_BRIEF} ${KEPT_ON_STRIPE}`]],
    ["disconnected", true, [`${DISCONNECTED_BRIEF} ${KEPT_ON_STRIPE}`]],
    ["incomplete", true, [INCOMPLETE_BANK[0]]],
    ["pending", true, []],
  ])(
    "%s, bank on file %s, brief (step 4): says only what the option row can't",
    async (status, has_bank, phrases) => {
      const screen = await render_card({
        status,
        has_bank,
        brief: true,
        heading_level: 3,
      });
      const card = screen.getByRole("region", { name: "Stripe account" });

      for (const phrase of phrases) {
        await expect
          .element(card.getByText(phrase, { exact: true }))
          .toBeVisible();
      }
      const text = card.element().textContent ?? "";
      for (const other of ALL.filter(
        (p) => !phrases.some((own) => own.includes(p))
      )) {
        expect(text).not.toContain(other);
      }
      expect(text).not.toMatch(/as each donation's own transfer|until then/i);
    }
  );

  test("ready, bank on file, brief (step 4): the status alone, no body", async () => {
    const screen = await render_card({
      status: "ready",
      has_bank: true,
      brief: true,
      heading_level: 3,
    });
    const card = screen.getByRole("region", { name: "Stripe account" });

    await expect
      .element(
        card.getByText("Ready to receive card, bank and wallet donations")
      )
      .toBeVisible();
    expect(card.element().textContent).not.toContain(
      "is in your Stripe dashboard"
    );
    expect(card.element().textContent).not.toContain("go to your bank again");
  });

  test("a connect that landed is said once, by the status's own band, which takes focus", async () => {
    const screen = await render_card({
      status: "incomplete",
      has_bank: false,
      notice: { result: "connected" },
    });
    const band = screen.getByText(INCOMPLETE_HELD);
    await expect.element(band).toBeVisible();
    expect(screen.getByText(CONNECTED, { exact: true }).query()).toBeNull();
    await vi.waitFor(() =>
      expect((band.element() as HTMLElement).closest("[tabindex='-1']")).toBe(
        document.activeElement
      )
    );
  });

  test("incomplete, bank on file: the body asks for the same step as the status line, then says where donations go meanwhile, and never says it can wait", async () => {
    const screen = await render_card({ status: "incomplete" });
    const card = screen.getByRole("region", { name: "Stripe account" });
    // the status label is a bare "Finish setup on Stripe"; the body's sentence is longer
    await expect
      .element(card.getByText("Finish setup on Stripe", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        card.getByText(
          "Stripe needs a few more details before it can receive donations. Finish setup on Stripe, in your Stripe dashboard.",
          { exact: true }
        )
      )
      .toBeVisible();
    await expect
      .element(card.getByText(/^Until you do and Stripe says your account/))
      .toBeVisible();
    expect(card.element().textContent).not.toMatch(
      /don't need to do anything|nothing else/i
    );
  });

  test("ready, no notice: no band, so nothing takes focus", async () => {
    const screen = await render_card({ status: "ready" });
    await expect
      .element(
        screen.getByText("Ready to receive card, bank and wallet donations")
      )
      .toBeVisible();
    expect(screen.getByText(CONNECTED).query()).toBeNull();
    expect(screen.container.querySelector("[tabindex='-1']")).toBeNull();
  });

  test("ready, just connected: the one-shot notice band says so and takes focus", async () => {
    const screen = await render_card({
      status: "ready",
      notice: { result: "connected" },
    });
    const band = screen.getByText(CONNECTED);
    await expect.element(band).toBeVisible();
    await vi.waitFor(() =>
      expect((band.element() as HTMLElement).closest("[tabindex='-1']")).toBe(
        document.activeElement
      )
    );
  });

  test("ready beside a bank: links the Payouts page when given its href", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <StripeConnectCard
            status="ready"
            start_href={START}
            has_bank
            payouts_href="/admin/42/payouts"
          />
        ),
      },
    ]);
    const screen = await render(<Stub />);
    await expect
      .element(
        screen.getByRole("link", {
          name: "See what's been sent on your Payouts page",
        })
      )
      .toHaveAttribute("href", "/admin/42/payouts");
  });

  test("ready, Stripe only: no Payouts link even when given its href", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <StripeConnectCard
            status="ready"
            start_href={START}
            payouts_href="/admin/42/payouts"
            has_bank={false}
          />
        ),
      },
    ]);
    const screen = await render(<Stub />);
    await expect
      .element(
        screen.getByText("Ready to receive card, bank and wallet donations")
      )
      .toBeVisible();
    expect(
      screen.getByRole("link", { name: /payouts page/i }).query()
    ).toBeNull();
  });

  test("ready: no Payouts link without its href", async () => {
    // registration passes none, and renders outside any router
    const screen = await render_card({ status: "ready" });
    await expect
      .element(
        screen.getByText("Ready to receive card, bank and wallet donations")
      )
      .toBeVisible();
    expect(
      screen.getByRole("link", { name: /payouts page/i }).query()
    ).toBeNull();
  });

  test.each<IStripeConnectCard["status"]>([
    "not_connected",
    "disconnected",
    "incomplete",
    "pending",
  ])("%s: no Payouts link even when given its href", async (status) => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <StripeConnectCard
            status={status}
            start_href={START}
            has_bank
            payouts_href="/admin/42/payouts"
          />
        ),
      },
    ]);
    const screen = await render(<Stub />);
    await expect
      .element(screen.getByRole("region", { name: "Stripe account" }))
      .toBeVisible();
    expect(
      screen.getByRole("link", { name: /payouts page/i }).query()
    ).toBeNull();
  });

  test.each<[NonNullable<IStripeConnectCard["ineligible"]>, string]>([
    [
      { reason: "fiscal_sponsored" },
      "Stripe isn't available to fiscally sponsored nonprofits, so there's nothing to connect.",
    ],
    [
      { reason: "country", hq_country: "Brazil" },
      `Stripe isn't available for nonprofits headquartered in Brazil. We can send card, bank and wallet donations to a Stripe account for nonprofits headquartered in ${TRANSFER_COUNTRIES_COPY}.`,
    ],
  ])(
    "not eligible (%o): says why, offers nothing",
    async (ineligible, reason) => {
      const screen = await render_card({ status: "ready", ineligible });
      const card = screen.getByRole("region", { name: "Stripe account" });

      await expect.element(card.getByText("Not available")).toBeVisible();
      await expect
        .element(card.getByText(reason, { exact: true }))
        .toBeVisible();
      await expect
        .element(
          card.getByText(
            "All your donations, including card, bank and wallet donations, pay out to your bank. You don't need to do anything."
          )
        )
        .toBeVisible();
      // no status line, no dashboard link, no control of any kind
      expect(
        card
          .getByText("Ready to receive card, bank and wallet donations")
          .query()
      ).toBeNull();
      expect(card.getByRole("link").query()).toBeNull();
      expect(card.getByRole("button").query()).toBeNull();
    }
  );

  test("not eligible, no bank: says every donation is held, and leaves adding one to the bank section", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <StripeConnectCard
            status="not_connected"
            start_href={START}
            ineligible={{ reason: "fiscal_sponsored" }}
            has_bank={false}
          />
        ),
      },
    ]);
    const screen = await render(<Stub />);
    const card = screen.getByRole("region", { name: "Stripe account" });

    await expect
      .element(
        card.getByText(
          "Until you add a bank account, all your donations, including card, bank and wallet donations, are held in your Better Giving balance. Nothing is lost."
        )
      )
      .toBeVisible();
    expect(card.getByText(/don't need to do anything/).query()).toBeNull();
    expect(card.getByRole("link").query()).toBeNull();
    expect(card.getByRole("button").query()).toBeNull();
  });

  test("not eligible, bank under review: says the money waits for the review, and asks for no bank", async () => {
    const screen = await render_card({
      ineligible: { reason: "country", hq_country: "Brazil" },
      has_bank: false,
      bank_pending: true,
    });
    const card = screen.getByRole("region", { name: "Stripe account" });

    await expect
      .element(
        card.getByText(
          "Your bank account is under review. Until it's approved, all your donations, including card, bank and wallet donations, are held in your Better Giving balance. Nothing is lost."
        )
      )
      .toBeVisible();
    expect(card.getByRole("link").query()).toBeNull();
  });
});
