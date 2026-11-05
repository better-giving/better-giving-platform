import { describe, expect, test } from "vitest";
import type { Locator } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TRANSFER_COUNTRIES_COPY } from "@/stripe-connect/eligibility";
import { PayoutOptions } from "./payout-options";

const WHO_STRIPE = `Not available to fiscally sponsored nonprofits, or to nonprofits headquartered outside ${TRANSFER_COUNTRIES_COPY}.`;
const BANK_COVERS =
  "PayPal, DAF grants (through Chariot), crypto (through NOWPayments), stocks and cheques. Also Stripe donations, until you connect Stripe.";
const BANK_SPLIT =
  "Your Grant share pays out to your bank. If you send a share to Savings or Investments, it stays in those accounts.";
const STRIPE_SPLIT =
  "Stripe donations skip your Savings and Investments split: the whole donation goes to your Stripe account, after fees.";

/** the one heading the box adds to the page: an h2, open or closed. the
 * options are not headings — banking's own sections carry those names */
const expect_one_h2 = async (box: Locator) => {
  await expect
    .element(box.getByRole("heading", { level: 2, name: "How you get paid" }))
    .toBeVisible();
  expect(box.getByRole("heading").elements()).toHaveLength(1);
};

describe("PayoutOptions", () => {
  test("open: both options side by side, with the footer in Stripe donations", async () => {
    const screen = await render(<PayoutOptions variant="open" />);
    const region = screen.getByRole("region", { name: "How you get paid" });

    await expect_one_h2(region);
    const [bank, stripe] = region.getByRole("listitem").all();
    await expect
      .element(bank.getByText("Bank payout", { exact: true }))
      .toBeVisible();
    await expect.element(bank.getByText("Required")).toBeVisible();
    await expect
      .element(stripe.getByText("Stripe account", { exact: true }))
      .toBeVisible();
    await expect
      .element(stripe.getByText("Optional", { exact: true }))
      .toBeVisible();
    await expect
      .element(region.getByText(WHO_STRIPE, { exact: true }))
      .toBeVisible();
    await expect
      .element(
        region.getByText(
          "every donation, Stripe donations included, pays out to your bank."
        )
      )
      .toBeVisible();
    await expect
      .element(
        region.getByText(
          /^Stripe donations go to your Stripe account and everything else goes to your bank\./
        )
      )
      .toBeVisible();
    // the card says "Stripe donations", never "Stripe payments"
    expect(region.element().textContent).not.toMatch(/stripe payments/i);
  });

  test("open: each option says what it covers and how its money is split", async () => {
    const screen = await render(<PayoutOptions variant="open" />);
    const region = screen.getByRole("region", { name: "How you get paid" });
    const [bank, stripe] = region.getByRole("listitem").all();

    /** the detail under `term` in `option`'s list of facts */
    const detail_of = (option: Locator, term: string) => {
      const dt = option
        .getByText(term, { exact: true })
        .element() as HTMLElement;
      expect(dt.tagName).toBe("DT");
      return dt.nextElementSibling?.textContent;
    };

    await expect
      .element(bank.getByText(BANK_COVERS, { exact: true }))
      .toBeVisible();
    expect(detail_of(bank, "What it covers")).toBe(BANK_COVERS);
    expect(detail_of(bank, "How it's split")).toBe(BANK_SPLIT);
    expect(detail_of(stripe, "How it's split")).toBe(STRIPE_SPLIT);

    // each split line belongs to its own option and appears once in the box
    expect(bank.getByText(STRIPE_SPLIT).query()).toBeNull();
    expect(stripe.getByText(BANK_SPLIT).query()).toBeNull();
    expect(
      region.getByText(STRIPE_SPLIT, { exact: true }).elements()
    ).toHaveLength(1);
    expect(
      region.getByText(BANK_SPLIT, { exact: true }).elements()
    ).toHaveLength(1);
  });

  test("collapsed: closed until its trigger is pressed", async () => {
    const screen = await render(<PayoutOptions variant="collapsed" />);
    const region = screen.getByRole("region", { name: "How you get paid" });
    // heading navigation lands on the trigger itself while the box is closed
    await expect_one_h2(region);
    const trigger = region
      .getByRole("heading", { level: 2 })
      .getByRole("button", { name: /how you get paid/i });

    await expect
      .element(
        trigger.getByText("Your bank payout is required. Stripe is optional.")
      )
      .toBeVisible();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(screen.getByText(WHO_STRIPE, { exact: true }))
      .not.toBeVisible();

    await trigger.click();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
    await expect
      .element(screen.getByText(WHO_STRIPE, { exact: true }))
      .toBeVisible();
    // opening it adds nothing below the h2, so the outline matches the open box
    await expect_one_h2(region);
  });
});
