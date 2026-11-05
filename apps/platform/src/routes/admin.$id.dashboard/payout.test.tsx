import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Payout } from "./payout";
import type { TPayoutTo } from "./payout-to";

const render_payout = (to: TPayoutTo) => {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <Payout
          bal_cash={120}
          threshold={50}
          next_payout="2026-11-08T00:00:00.000Z"
          to={to}
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

  test("Stripe not ready: Stripe donations wait for a bank, like the held card says", async () => {
    const screen = await render_payout({ kind: "stripe", ready: false });
    const line = screen.getByText(/stripe donations/i);
    await expect.element(line).toBeVisible();
    expect(line.element().textContent).not.toMatch(/once stripe says/i);
    expect(line.element().textContent).toMatch(
      /before your stripe account is ready wait in your better giving balance.*until you add a bank account/i
    );
  });
});
