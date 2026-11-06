import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { INpoSent } from "@/stripe-connect/sent";
import { SentToStripe, WhereMoneyShows } from "./sent";

const sent = (p: Pick<INpoSent, "on_stripe" | "connected">): INpoSent => ({
  items: [],
  truncated: false,
  ...p,
});

describe("no bank on file: nothing promises a bank payout", () => {
  test.each<[string, INpoSent, string]>([
    [
      "Stripe off",
      sent({ on_stripe: false, connected: true }),
      "Stripe donations sent to your Stripe account before. New Stripe donations wait in your Better Giving balance until you add a bank account.",
    ],
    [
      "Stripe disconnected",
      sent({ on_stripe: false, connected: false }),
      "Your Stripe account is disconnected, so new Stripe donations wait in your Better Giving balance until you add a bank account. These were sent to it while it was connected.",
    ],
  ])("%s: the list says new Stripe donations wait", async (_, s, lead) => {
    const screen = await render(<SentToStripe sent={s} has_bank={false} />);
    const list = screen.getByRole("region", { name: "Sent to Stripe earlier" });
    await expect.element(list.getByText(lead)).toBeVisible();
    expect(list.element().textContent).not.toMatch(/pay out to your bank/);
  });

  test.each<[string, "off" | "disconnected", string]>([
    [
      "Stripe off",
      "off",
      "Everything sent to your bank before. New donations, Stripe donations included, wait in your Better Giving balance until you add a bank account.",
    ],
    [
      "Stripe disconnected",
      "disconnected",
      "Everything sent to your bank before. Your Stripe account is disconnected, so new donations, Stripe donations included, wait in your Better Giving balance until you add a bank account.",
    ],
  ])(
    "%s: the Payouts well says new donations wait",
    async (_, link, detail) => {
      const screen = await render(
        <WhereMoneyShows link={link} has_bank={false} />
      );
      await expect.element(screen.getByText(detail)).toBeVisible();
      expect(
        screen.getByText(/new Stripe donations included/).query()
      ).toBeNull();
    }
  );
});

describe("a bank under review: new donations wait for its approval", () => {
  test.each<[string, INpoSent, string]>([
    [
      "Stripe off",
      sent({ on_stripe: false, connected: true }),
      "Stripe donations sent to your Stripe account before. New Stripe donations wait in your Better Giving balance until your bank account is approved.",
    ],
    [
      "Stripe disconnected",
      sent({ on_stripe: false, connected: false }),
      "Your Stripe account is disconnected, so new Stripe donations wait in your Better Giving balance until your bank account is approved. These were sent to it while it was connected.",
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
      "Everything sent to your bank before. New donations, Stripe donations included, wait in your Better Giving balance until your bank account is approved.",
    ],
    [
      "Stripe disconnected",
      "disconnected",
      "Everything sent to your bank before. Your Stripe account is disconnected, so new donations, Stripe donations included, wait in your Better Giving balance until your bank account is approved.",
    ],
  ])("%s: the Payouts well asks for no bank", async (_, link, detail) => {
    const screen = await render(
      <WhereMoneyShows link={link} has_bank={false} bank_pending />
    );
    await expect.element(screen.getByText(detail)).toBeVisible();
    expect(screen.container.textContent).not.toMatch(/add a bank account/);
  });
});

test("a bank on file: new Stripe donations pay out to it", async () => {
  const screen = await render(
    <SentToStripe sent={sent({ on_stripe: false, connected: false })} />
  );
  await expect
    .element(
      screen.getByText(
        "Your Stripe account is disconnected, so new Stripe donations pay out to your bank. These were sent to it while it was connected."
      )
    )
    .toBeVisible();
});
