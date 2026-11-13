import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
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

const row_of = (cell: Element) => cell.closest("tr") as HTMLTableRowElement;

describe("payouts table — returned and void", () => {
  test("an explanation row follows a returned and a void payout, and no other", async () => {
    const screen = await render_table(ITEMS);
    await expect.element(screen.getByText("Returned")).toBeVisible();
    // four payouts, two explanations
    expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(6);

    const returned_note = screen
      .getByText(/Your bank sent this back, and the money is in your balance/)
      .element();
    expect(row_of(returned_note).previousElementSibling).toBe(
      row_of(screen.getByText("Returned").element())
    );
    await expect
      .element(screen.getByRole("link", { name: "bank details", exact: true }))
      .toHaveAttribute("href", "/admin/42/banking");

    const void_note = screen
      .getByText("Not counted as a grant.", { exact: true })
      .element();
    expect(row_of(void_note).previousElementSibling).toBe(
      row_of(screen.getByText("Void", { exact: true }).element())
    );

    // the processing row is followed by the refunded one, nothing between
    expect(
      row_of(screen.getByText("Processing").element()).nextElementSibling
    ).toBe(row_of(screen.getByText("Refunded").element()));
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

  test("a table with no returned or void payout has no explanation rows", async () => {
    const screen = await render_table([ITEMS[2]!, ITEMS[3]!]);
    await expect.element(screen.getByText("Processing")).toBeVisible();
    expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(2);
  });
});
