import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ILog } from "@/nav";

vi.mock("./api", () => ({ loader: vi.fn(), action: vi.fn() }));

import Page from "./route";

const ticker = (id: string, qty: number, price: number) => ({
  id,
  qty,
  price,
  price_date: "2026-10-01T00:00:00.000Z",
  value: qty * price,
});

// holdings carried over, but no unit has been issued against them
const unitless_ltd: ILog = {
  reason: "rebalance",
  date: "2026-10-01T00:00:00.000Z",
  units: 0,
  price: 0,
  price_updated: "2026-10-01T00:00:00.000Z",
  composition: { CASH: ticker("CASH", 100, 1), IVV: ticker("IVV", 0, 10) },
  value: 100,
  holders: {},
};

// the same holdings once units have been issued: 100 units at $1
const unitful_ltd: ILog = { ...unitless_ltd, units: 100, price: 1 };

async function review_swap(screen: Awaited<ReturnType<typeof render>>) {
  // spends 20 CASH on 2 IVV
  await screen.getByPlaceholder("bndx").fill("CASH");
  await screen.getByPlaceholder("cash").fill("IVV");
  await screen.getByPlaceholder("2.023").fill("20");
  await screen.getByPlaceholder("100", { exact: true }).fill("2");
  await screen.getByPlaceholder("49.42").fill("10");
  await screen.getByPlaceholder("tx123abc..").fill("t1");
  (
    screen.getByRole("button", { name: "Review" }).element() as HTMLElement
  ).click();
}

describe("rebalancing a portfolio that has units", () => {
  test("the review shows the unit price, Submit is on and no reason is given", async () => {
    const Stub = createRoutesStub([
      {
        path: "/platform/investments/rebalance",
        Component: Page as any,
        loader: () => unitful_ltd,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={["/platform/investments/rebalance"]} />
    );
    await review_swap(screen);

    const submit = screen.getByRole("button", { name: "Submit" });
    await expect.element(submit).toBeVisible();
    await expect.element(submit).toBeEnabled();
    expect(
      screen
        .getByText("Can't rebalance: the portfolio has no units yet.")
        .query()
    ).toBeNull();
    const unit_price = screen.getByText("Unit price").element();
    expect(unit_price.nextElementSibling?.textContent).toMatch(/^\$1(\.0+)?/);
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});

describe("rebalancing a portfolio with no units", () => {
  test("the review shows a dash for the unit price, never NaN, and Submit stays off with its reason beside it", async () => {
    const Stub = createRoutesStub([
      {
        path: "/platform/investments/rebalance",
        Component: Page as any,
        loader: () => unitless_ltd,
      },
    ]);
    const screen = await render(
      <Stub initialEntries={["/platform/investments/rebalance"]} />
    );

    await review_swap(screen);

    const submit = screen.getByRole("button", { name: "Submit" });
    await expect.element(submit).toBeVisible();
    await expect.element(submit).toBeDisabled();
    await expect
      .element(submit)
      .toHaveAccessibleDescription(
        "Can't rebalance: the portfolio has no units yet."
      );
    await expect
      .element(
        screen.getByText("Can't rebalance: the portfolio has no units yet.")
      )
      .toBeVisible();
    const unit_price = screen.getByText("Unit price").element();
    expect(unit_price.nextElementSibling?.textContent).toBe("—");
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});
