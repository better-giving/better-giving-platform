import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { PayoutStatus, type PayoutStatusType } from "./payout-status";

const ink = async (type: PayoutStatusType, label: string) => {
  const screen = await render(<PayoutStatus type={type} />);
  const status = screen.getByText(label);
  await expect.element(status).toBeVisible();
  return getComputedStyle(status.element()).color;
};

const dot_of = (label: HTMLElement) =>
  getComputedStyle(label.firstElementChild as HTMLElement);

describe("PayoutStatus", () => {
  test("labels a processing payout 'Processing'", async () => {
    const screen = await render(<PayoutStatus type="processing" />);
    await expect.element(screen.getByText("Processing")).toBeVisible();
  });

  test("paints processing in pending's in-flight ink, not the cancelled gray", async () => {
    const processing = await ink("processing", "Processing");
    expect(processing).toBe(await ink("pending", "Pending"));
    expect(processing).not.toBe(await ink("cancelled", "Cancelled"));
  });

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

  test("keeps returned's ink and dot apart from cancelled's and void's gray", async () => {
    const screen = await render(
      <>
        <PayoutStatus type="returned" />
        <PayoutStatus type="cancelled" />
        <PayoutStatus type="void" />
      </>
    );
    const label = (name: string) =>
      screen.getByText(name, { exact: true }).element() as HTMLElement;
    const returned = label("Returned");
    const cancelled = label("Cancelled");
    const voided = label("Void");
    await expect.element(returned).toBeVisible();

    expect(getComputedStyle(returned).color).not.toBe(
      getComputedStyle(cancelled).color
    );
    expect(getComputedStyle(returned).color).not.toBe(
      getComputedStyle(voided).color
    );
    expect(dot_of(returned).backgroundColor).not.toBe(
      dot_of(cancelled).backgroundColor
    );
    expect(dot_of(returned).backgroundColor).not.toBe(
      dot_of(voided).backgroundColor
    );
    // void is hollow where cancelled is filled: same ink, different dot
    expect(getComputedStyle(voided).color).toBe(
      getComputedStyle(cancelled).color
    );
    expect(dot_of(voided).backgroundColor).not.toBe(
      dot_of(cancelled).backgroundColor
    );
    expect(dot_of(voided).boxShadow).not.toBe(dot_of(cancelled).boxShadow);
  });

  test("draws a void payout's dot as a gray ring with no fill", async () => {
    const screen = await render(<PayoutStatus type="void" />);
    const label = screen.getByText("Void").element() as HTMLElement;
    await expect.element(label).toBeVisible();
    const dot = dot_of(label);
    expect(dot.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // ring-1 is an inset box-shadow in the label's own gray-11
    expect(dot.boxShadow).toContain(getComputedStyle(label).color);
    expect(dot.boxShadow).toContain("inset");
  });
});
