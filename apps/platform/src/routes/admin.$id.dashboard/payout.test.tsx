import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { TPayoutTo } from "@/payouts/payout-to";
import { Payout } from "./payout";

const render_payout = (to: TPayoutTo, bank_pending = false) => {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <Payout
          bal_cash={120}
          threshold={50}
          next_payout="2026-11-08T00:00:00.000Z"
          to={to}
          bank_pending={bank_pending}
        />
      ),
    },
  ]);
  return render(<Stub />);
};

const minimum = /edit payout threshold/i;

describe("dashboard Payout", () => {
  test("bank: the progress toward the minimum, and its pencil", async () => {
    const screen = await render_payout({
      kind: "bank",
      summary: "Chase •4242",
    });
    await expect
      .element(screen.getByRole("link", { name: minimum }))
      .toBeVisible();
    await expect.element(screen.getByText("$50.00")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Chase •4242" }))
      .toBeVisible();
  });

  test.each<TPayoutTo>([
    { kind: "none" },
    { kind: "stripe", ready: false },
    { kind: "stripe", ready: true },
  ])(
    "no bank ($kind): no minimum to reach, so no bar and no pencil",
    async (to) => {
      const screen = await render_payout(to);
      await expect
        .element(screen.getByRole("link", { name: "add a bank account" }))
        .toBeVisible();
      expect(screen.getByRole("link", { name: minimum }).query()).toBeNull();
      expect(screen.getByText("$50.00").query()).toBeNull();
    }
  );

  test("Stripe not ready: card, bank and wallet donations wait for a bank, like the held card says", async () => {
    const screen = await render_payout({ kind: "stripe", ready: false });
    const line = screen.getByText(/card, bank and wallet donations/i);
    await expect.element(line).toBeVisible();
    expect(line.element().textContent).not.toMatch(/once stripe says/i);
    expect(line.element().textContent).toMatch(
      /^Card, bank and wallet donations that arrive before your Stripe account is ready wait in your Better Giving balance, along with everything else, until you add a bank account\. Nothing is lost\.$/
    );
  });

  test("Stripe ready: new card, bank and wallet donations go to Stripe, earlier ones and everything else wait", async () => {
    const screen = await render_payout({ kind: "stripe", ready: true });
    const line = screen.getByText(/card, bank and wallet donations/i);
    await expect.element(line).toBeVisible();
    expect(line.element().textContent).toBe(
      "New card, bank and wallet donations go straight to your Stripe account. Any that arrived before it was ready, and everything else, wait in your Better Giving balance until you add a bank account."
    );
  });

  test.each<TPayoutTo>([
    { kind: "none" },
    { kind: "stripe", ready: false },
    { kind: "stripe", ready: true },
  ])(
    "bank under review ($kind): says it pays out once approved, and asks for no bank",
    async (to) => {
      const screen = await render_payout(to, true);
      await expect
        .element(screen.getByText(/until your bank account is approved/i))
        .toBeVisible();
      expect(screen.getByText(/no way to get paid/i).query()).toBeNull();
      expect(
        screen.getByRole("link", { name: "add a bank account" }).query()
      ).toBeNull();
    }
  );
});
