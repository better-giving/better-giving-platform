import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { IPayout, PayoutStatus } from "@/payouts";
import { PayoutsTable } from "./payouts-table";

const payout = (id: string, status: PayoutStatus, amount: number): IPayout =>
  ({
    id,
    source_id: `don-${id}`,
    npo_id: 42,
    source: "donation",
    date: "2026-11-09T15:00:00.000Z",
    amount,
    ...status,
  }) as IPayout;

const ITEMS: IPayout[] = [
  payout("a", { type: "returned" }, 250),
  payout("b", { type: "void" }, 480),
  payout("c", { type: "processing", ref: "" }, 75),
  payout("d", { type: "refunded" }, 320),
];

const render_table = (items: IPayout[]) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <PayoutsTable items={items} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

describe("payouts table — returned and void", () => {
  // an open tooltip is portaled out of the render and would cover the next test's button
  afterEach(async () => {
    await userEvent.keyboard("{Escape}");
  });

  test("a returned and a void payout each get a (!) button, and no other row does", async () => {
    const screen = await render_table(ITEMS);
    await expect
      .element(screen.getByText("Returned", { exact: true }))
      .toBeVisible();
    // four payouts, no explanation rows
    expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(4);
    await expect
      .element(screen.getByRole("button", { name: "What Returned means" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "What Void means" }))
      .toBeVisible();
    expect(screen.getByRole("button").elements()).toHaveLength(2);
  });

  test("opening the returned button shows what it means", async () => {
    const screen = await render_table(ITEMS);
    await screen.getByRole("button", { name: "What Returned means" }).click();
    await expect
      .element(
        screen.getByRole("tooltip", {
          name: "Your bank sent this back, and the money is in your balance. Update your bank details; it goes out again once the new ones are approved.",
        })
      )
      .toBeVisible();
  });

  test("opening the void button shows what it means", async () => {
    const screen = await render_table(ITEMS);
    await screen.getByRole("button", { name: "What Void means" }).click();
    await expect
      .element(screen.getByRole("tooltip", { name: "Not counted as a grant." }))
      .toBeVisible();
  });

  test("strikes a void amount, not a returned one", async () => {
    const screen = await render_table(ITEMS);
    const struck = (text: string) =>
      getComputedStyle(screen.getByText(text, { exact: true }).element())
        .textDecorationLine;
    await expect.element(screen.getByText("$480.00")).toBeVisible();
    expect(struck("$480.00")).toBe("line-through");
    expect(struck("$250.00")).toBe("none");
    // refunded keeps its own strike
    expect(struck("$320.00")).toBe("line-through");
  });

  test("a table with no returned or void payout has no (!) button", async () => {
    const screen = await render_table([ITEMS[2]!, ITEMS[3]!]);
    await expect.element(screen.getByText("Processing")).toBeVisible();
    expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByRole("button").query()).toBeNull();
  });
});
