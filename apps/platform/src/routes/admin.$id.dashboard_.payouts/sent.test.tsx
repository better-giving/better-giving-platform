import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { INpoSent } from "@/stripe-connect/sent";
import { SentToStripe, stripe_link, WhereMoneyShows } from "./sent";

const sent = (p: Pick<INpoSent, "on_stripe" | "connected">): INpoSent => ({
  items: [],
  unsent: [],
  unsent_truncated: false,
  truncated: false,
  ...p,
});

/** a transfer sent while the account still took them */
const PAST: INpoSent["items"] = [
  {
    id: "tr_past",
    amount: 90,
    date: "2026-07-01T00:00:00.000Z",
    standing: { kind: "paid" },
  },
];

/** connected, off stripe, with transfers from before */
const off = (): INpoSent => ({
  ...sent({ on_stripe: false, connected: true }),
  items: PAST,
});

describe("no bank on file: nothing promises a bank payout", () => {
  test.each<[string, INpoSent, string]>([
    [
      "Stripe off",
      off(),
      "Your Stripe account is connected but no longer receives card, bank and wallet donations, so new ones wait in your Better Giving balance until you add a bank account. These were made while it received them.",
    ],
    [
      "Stripe disconnected",
      sent({ on_stripe: false, connected: false }),
      "Your Stripe account is disconnected, so new card, bank and wallet donations wait in your Better Giving balance until you add a bank account. These were sent to it while it was connected.",
    ],
  ])("%s: the list says new ones wait", async (_, s, lead) => {
    const screen = await render(<SentToStripe sent={s} has_bank={false} />);
    const list = screen.getByRole("region", {
      name: "Sent to Stripe earlier",
    });
    await expect.element(list.getByText(lead)).toBeVisible();
    expect(list.element().textContent).not.toMatch(/pay out to your bank/);
  });

  test.each<[string, "off" | "disconnected", string]>([
    [
      "Stripe off",
      "off",
      "Everything sent to your bank before. New donations, including card, bank and wallet donations, wait in your Better Giving balance until you add a bank account.",
    ],
    [
      "Stripe disconnected",
      "disconnected",
      "Everything sent to your bank before. Your Stripe account is disconnected, so new donations, including card, bank and wallet donations, wait in your Better Giving balance until you add a bank account.",
    ],
  ])(
    "%s: the Payouts well says new donations wait",
    async (_, link, detail) => {
      const screen = await render(
        <WhereMoneyShows link={link} has_bank={false} />
      );
      await expect.element(screen.getByText(detail)).toBeVisible();
      expect(
        screen
          .getByText(/including new card, bank and wallet donations/)
          .query()
      ).toBeNull();
    }
  );
});

describe("a bank under review: new donations wait for its approval", () => {
  test.each<[string, INpoSent, string]>([
    [
      "Stripe off",
      off(),
      "Your Stripe account is connected but no longer receives card, bank and wallet donations, so new ones wait in your Better Giving balance until your bank account is approved. These were made while it received them.",
    ],
    [
      "Stripe disconnected",
      sent({ on_stripe: false, connected: false }),
      "Your Stripe account is disconnected, so new card, bank and wallet donations wait in your Better Giving balance until your bank account is approved. These were sent to it while it was connected.",
    ],
  ])("%s: the list asks for no bank", async (_, s, lead) => {
    const screen = await render(
      <SentToStripe sent={s} has_bank={false} bank_pending />
    );
    const list = screen.getByRole("region", { name: "Sent to Stripe earlier" });
    await expect.element(list.getByText(lead)).toBeVisible();
    expect(list.element().textContent).not.toMatch(/add a bank account/);
  });

  test.each<[string, "off" | "disconnected", string]>([
    [
      "Stripe off",
      "off",
      "Everything sent to your bank before. New donations, including card, bank and wallet donations, wait in your Better Giving balance until your bank account is approved.",
    ],
    [
      "Stripe disconnected",
      "disconnected",
      "Everything sent to your bank before. Your Stripe account is disconnected, so new donations, including card, bank and wallet donations, wait in your Better Giving balance until your bank account is approved.",
    ],
  ])("%s: the Payouts well asks for no bank", async (_, link, detail) => {
    const screen = await render(
      <WhereMoneyShows link={link} has_bank={false} bank_pending />
    );
    await expect.element(screen.getByText(detail)).toBeVisible();
    expect(screen.container.textContent).not.toMatch(/add a bank account/);
  });
});

describe("connected, off stripe, nothing sent yet", () => {
  const waiting = sent({ on_stripe: false, connected: true });

  test("the list says the account takes no donations and claims no past transfers", async () => {
    const screen = await render(<SentToStripe sent={waiting} />);
    const list = screen.getByRole("region", { name: "Your Stripe account" });
    await expect
      .element(
        list.getByText(
          "Your Stripe account is connected but isn't receiving card, bank and wallet donations, so new ones pay out to your bank."
        )
      )
      .toBeVisible();
    expect(list.element().textContent).not.toMatch(/earlier|before/);
  });

  test("with no bank, the list says new ones wait", async () => {
    const screen = await render(
      <SentToStripe sent={waiting} has_bank={false} />
    );
    await expect
      .element(
        screen.getByText(
          "so new ones wait in your Better Giving balance until you add a bank account."
        )
      )
      .toBeVisible();
  });

  test("the Stripe well claims nothing was sent", async () => {
    const screen = await render(
      <WhereMoneyShows link={stripe_link(waiting)} />
    );
    await expect
      .element(
        screen.getByText(
          "Nothing has been sent to your Stripe account. New card, bank and wallet donations are not sent there."
        )
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Everything sent to your bank, including new card, bank and wallet donations."
        )
      )
      .toBeVisible();
  });
});

test("a bank on file: new card, bank and wallet donations pay out to it", async () => {
  const screen = await render(
    <SentToStripe sent={sent({ on_stripe: false, connected: false })} />
  );
  await expect
    .element(
      screen.getByText(
        "Your Stripe account is disconnected, so new card, bank and wallet donations pay out to your bank. These were sent to it while it was connected."
      )
    )
    .toBeVisible();
});

describe("routed donations with no transfer", () => {
  test("a cut list says it shows the most recent", async () => {
    const base = sent({ on_stripe: true, connected: true });
    const unsent = [
      {
        id: "d1",
        amount: 40,
        date: "2026-07-01T00:00:00.000Z",
        kind: "sending" as const,
      },
    ];
    const screen = await render(
      <SentToStripe sent={{ ...base, unsent, unsent_truncated: true }} />
    );
    await expect
      .element(screen.getByText("Showing the most recent."))
      .toBeVisible();
    await screen.unmount();

    const whole = await render(<SentToStripe sent={{ ...base, unsent }} />);
    expect(whole.container.textContent).not.toContain(
      "Showing the most recent"
    );
  });

  test("are listed, worded as the donations list words them", async () => {
    const screen = await render(
      <SentToStripe
        sent={{
          ...sent({ on_stripe: true, connected: true }),
          unsent: [
            {
              id: "d1",
              amount: 40,
              date: "2026-07-01T00:00:00.000Z",
              kind: "sending",
            },
            {
              id: "d2",
              amount: 25,
              date: "2026-06-01T00:00:00.000Z",
              kind: "not_sent",
            },
          ],
        }}
      />
    );
    await expect
      .element(screen.getByText("Sending to Stripe", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("table", { name: "Not sent to Stripe" })
          .getByText("Not sent to Stripe", { exact: true })
      )
      .toBeVisible();
  });

  test("sit under their own heading, apart from the transfers sent", async () => {
    const screen = await render(
      <SentToStripe
        sent={{
          ...off(),
          unsent: [
            {
              id: "d1",
              amount: 40,
              date: "2026-07-01T00:00:00.000Z",
              kind: "sending",
            },
          ],
        }}
      />
    );
    const waiting = screen.getByRole("table", {
      name: "Not sent to Stripe",
    });
    await expect.element(waiting).toBeVisible();
    expect(waiting.element().textContent).toContain("Sending to Stripe");
    expect(waiting.element().textContent).not.toContain("Paid out");
    const sent_table = screen
      .getByRole("table", { name: "Sent to Stripe earlier" })
      .element();
    expect(sent_table.textContent).toContain("Paid out");
    expect(sent_table.textContent).not.toContain("Sending to Stripe");
  });

  test("off stripe with only unsent routed donations is not the waiting account", async () => {
    const only_unsent: INpoSent = {
      ...sent({ on_stripe: false, connected: true }),
      unsent: [
        {
          id: "d1",
          amount: 40,
          date: "2026-07-01T00:00:00.000Z",
          kind: "not_sent",
        },
      ],
    };
    expect(stripe_link(only_unsent)).toBe("off");

    const screen = await render(
      <>
        <SentToStripe sent={only_unsent} />
        <WhereMoneyShows link={stripe_link(only_unsent)} />
      </>
    );
    await expect
      .element(screen.getByRole("region", { name: "Sent to Stripe earlier" }))
      .toBeVisible();
    await expect
      .element(
        screen
          .getByRole("table", { name: "Not sent to Stripe" })
          .getByText("Not sent to Stripe", { exact: true })
      )
      .toBeVisible();
    expect(screen.container.textContent).not.toMatch(
      /isn't receiving|Nothing has been sent/
    );
    // no transfer went out, so neither the lead nor the well claims one did
    await expect
      .element(
        screen.getByText(
          "Card, bank and wallet donations made while your Stripe account received them. New ones are not sent there."
        )
      )
      .toBeVisible();
    expect(screen.container.textContent).not.toMatch(
      /sent to your Stripe account/
    );
  });
});

describe("Stripe on: the Payouts well follows the bank", () => {
  const link = stripe_link(sent({ on_stripe: true, connected: true }));
  const PRIOR =
    "PayPal, DAF grants, crypto, stocks, cheques, and any card, bank and wallet donations from before Stripe was ready:";

  test("a bank on file: the Grant share of each, and withdrawals, are sent to it", async () => {
    const screen = await render(<WhereMoneyShows link={link} has_bank />);
    await expect
      .element(
        screen.getByText(
          `${PRIOR} the Grant share of each, sent to your bank. Savings and Investments withdrawals are sent there too.`
        )
      )
      .toBeVisible();
  });

  test.each<[string, boolean, string]>([
    [
      "no bank",
      false,
      "wait in your Better Giving balance until you add a bank account",
    ],
    [
      "a bank under review",
      true,
      "wait in your Better Giving balance until your bank account is approved",
    ],
  ])(
    "%s: new ones wait, and nothing promises a bank payout",
    async (_, bank_pending, wait) => {
      const screen = await render(
        <WhereMoneyShows
          link={link}
          has_bank={false}
          bank_pending={bank_pending}
        />
      );
      await expect
        .element(
          screen.getByText(
            `${PRIOR} the Grant share of each that was sent to your bank before. New PayPal, DAF grants, crypto, stocks and cheques, and Savings and Investments withdrawals, ${wait}.`
          )
        )
        .toBeVisible();
      expect(screen.container.textContent).not.toMatch(/sent to your bank\./);
      // it names the held methods, not a bare "New ones"
      expect(screen.container.textContent).not.toContain("New ones");
    }
  );
});
