import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { GrantsTable, type IGrantLine } from "./grants-table";

const grant = (id: string, amount: number, o: Partial<IGrantLine> = {}) =>
  ({
    id,
    other_id: null,
    npo_id: 42,
    date: "2026-11-09T15:00:00.000Z",
    amount,
    sources: null,
    status: "outgoing_payment_sent",
    hold_alerted_at: null,
    ...o,
  }) as IGrantLine;

const WHY =
  "Your bank sent this grant back, so it isn't counted in your grant totals. It goes out again once new bank details are approved.";

describe("grants table — a returned grant", () => {
  test("strikes the amount, marks it Returned and says why", async () => {
    const screen = await render(
      <GrantsTable
        items={[grant("g1", 1250, { status: "returned" }), grant("g2", 960.4)]}
      />
    );
    const amount = screen.getByText("$1,250.00", { exact: true });
    await expect.element(amount).toBeVisible();
    expect(getComputedStyle(amount.element()).textDecorationLine).toBe(
      "line-through"
    );
    await expect
      .element(screen.getByText("Returned", { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText(WHY, { exact: true })).toBeVisible();
  });

  test("gives any other grant nothing extra", async () => {
    const screen = await render(<GrantsTable items={[grant("g2", 960.4)]} />);
    await expect.element(screen.getByText("$960.40")).toBeVisible();
    expect(screen.getByText("Returned").query()).toBeNull();
    expect(screen.getByText(WHY).query()).toBeNull();
  });

  test("keeps a returned grant's gross and net under its explanation", async () => {
    const screen = await render(
      <GrantsTable
        items={[
          grant("g1", 1200, {
            status: "returned",
            run: {
              gross: 1250,
              net: 1200,
              deductions: [
                {
                  owed_id: "o1",
                  donation_id: "don-1",
                  gift_date: "2026-10-01T00:00:00.000Z",
                  gift_amount: 50,
                  gift_currency: "USD",
                  usd: 50,
                },
              ],
            },
          }),
        ]}
      />
    );
    const why = screen.getByText(WHY, { exact: true }).element();
    const gross = screen.getByText("Gross $1,250.00").element();
    await expect.element(gross).toBeVisible();
    expect(
      why.compareDocumentPosition(gross) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
