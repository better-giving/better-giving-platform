import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { PayoutStatus } from "./payout-status";

const dot_of = (label: HTMLElement) =>
  getComputedStyle(label.firstElementChild as HTMLElement);

describe("PayoutStatus", () => {
  test("labels a returned payout 'Returned' with pending's amber dot and ink", async () => {
    const screen = await render(
      <>
        <PayoutStatus type="returned" />
        <PayoutStatus type="pending" />
      </>
    );
    const returned = screen.getByText("Returned").element() as HTMLElement;
    const pending = screen.getByText("Pending").element() as HTMLElement;
    await expect.element(returned).toBeVisible();
    expect(getComputedStyle(returned).color).toBe(
      getComputedStyle(pending).color
    );
    expect(dot_of(returned).backgroundColor).toBe(
      dot_of(pending).backgroundColor
    );
  });

  test("draws a void payout's dot as a ring with no fill", async () => {
    const screen = await render(<PayoutStatus type="void" />);
    const label = screen.getByText("Void").element() as HTMLElement;
    await expect.element(label).toBeVisible();
    const dot = dot_of(label);
    expect(dot.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // 1.5px authored; chromium snaps a border to whole device pixels, so a
    // 1x screen draws 1px
    expect(Number.parseFloat(dot.borderTopWidth)).toBeGreaterThanOrEqual(1);
    expect(dot.borderTopColor).toBe(getComputedStyle(label).color);
  });

  test("hands every other type to the system's status", async () => {
    const screen = await render(<PayoutStatus type="refunded_loss" />);
    await expect.element(screen.getByText("Settled")).toBeVisible();
  });
});
