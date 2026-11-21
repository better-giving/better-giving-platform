import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import type { IManualWireRow } from "./types";
import {
  type IWiresTable,
  WiresTable,
  wire_return_target,
} from "./wires-table";

const wire_row = (o: Partial<IManualWireRow> = {}): IManualWireRow => ({
  npo_id: 1293826,
  name: "SXM Paws",
  gross: 4812.4,
  owed: 612.4,
  net: 4200,
  minimum: 100,
  bank: "USD account ending in 0412",
  payouts: [
    { id: "p1", label: "a@x.org", date: "2026-10-01", amount: 1904.1 },
    { id: "p2", label: "b@x.org", date: "2026-11-01", amount: 2311.8 },
    { id: "p3", label: "c@x.org", date: "2026-11-12", amount: 596.5 },
  ],
  ...o,
});

const casa = wire_row({
  npo_id: 1184407,
  name: "Casa Esperanza Foundation",
  gross: 1250,
  owed: 0,
  net: 1250,
  bank: "EUR account ending in 7731",
  payouts: [{ id: "p4", label: "Savings", date: "2026-10-02", amount: 1250 }],
});

const kaya = wire_row({
  npo_id: 1360152,
  name: "Kaya Youth Trust",
  gross: 62,
  owed: 0,
  net: 62,
  minimum: 250,
  bank: "USD account ending in 5508",
  payouts: [
    { id: "p5", label: "d@x.org", date: "2026-10-03", amount: 30 },
    { id: "p6", label: "e@x.org", date: "2026-10-04", amount: 32 },
  ],
});

const props = (o: Partial<IWiresTable> = {}): IWiresTable => ({
  rows: [wire_row(), casa, kaya],
  on_mark: vi.fn(),
  ...o,
});

describe("manual wires table", () => {
  // the runner's phone-width viewport draws stacked cards with no header
  beforeEach(() => page.viewport(1440, 900));
  afterEach(reset_viewport);

  test("one row per nonprofit with its amount due, payout count and bank; Mark wired calls back with the row and where it sat", async () => {
    const p = props();
    const screen = await render(<WiresTable {...p} />);

    const body_rows = screen.container.querySelectorAll(
      "tbody > tr[data-row-id]"
    );
    expect(body_rows.length).toBe(3);

    await expect.element(screen.getByText("ID 1293826")).toBeVisible();
    await expect.element(screen.getByText("$4,200.00")).toBeVisible();
    await expect.element(screen.getByText("after $612.40 owed")).toBeVisible();
    await expect.element(screen.getByText("3 payouts")).toBeVisible();
    await expect.element(screen.getByText("1 payout")).toBeVisible();
    await expect
      .element(screen.getByText("EUR account ending in 7731"))
      .toBeVisible();
    // nothing is owed by Casa, so its amount stands alone
    expect(screen.getByText(/^after .* owed$/).elements().length).toBe(1);

    await screen
      .getByRole("button", { name: "Mark wired, Casa Esperanza Foundation" })
      .click();
    expect(p.on_mark).toHaveBeenCalledWith(casa, { row_id: 1184407, index: 1 });
  });

  test("a row under its own payout minimum holds its button and says why", async () => {
    const p = props();
    const screen = await render(<WiresTable {...p} />);
    const button = screen.getByRole("button", {
      name: "Mark wired, Kaya Youth Trust",
    });

    await expect.element(button).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(button)
      .toHaveAccessibleDescription("Under the $250.00 payout minimum");
    // native: playwright refuses to press an aria-disabled button at all
    (button.element() as HTMLElement).click();
    expect(p.on_mark).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("button", { name: "Mark wired, SXM Paws" }))
      .not.toHaveAttribute("aria-disabled");
  });

  test("no rows keeps the header and says none are due", async () => {
    const screen = await render(<WiresTable {...props({ rows: [] })} />);
    await expect.element(screen.getByText("No manual wires due")).toBeVisible();
    await expect
      .element(screen.getByRole("columnheader", { name: "Amount due" }))
      .toBeInTheDocument();
  });

  test("a gone row's return target: the same row, the next, the nearest above, then the empty state", async () => {
    const screen = await render(
      <WiresTable {...props({ rows: [casa, kaya] })} />
    );
    const button = (name: string) =>
      screen.getByRole("button", { name: `Mark wired, ${name}` }).element();

    // still listed, wherever it moved to
    expect(wire_return_target({ row_id: kaya.npo_id, index: 0 })).toBe(
      button("Kaya Youth Trust")
    );
    // gone from the top: the row that slid into its place
    expect(wire_return_target({ row_id: 1293826, index: 0 })).toBe(
      button("Casa Esperanza Foundation")
    );
    // gone from the bottom: the row above
    expect(wire_return_target({ row_id: 1293826, index: 2 })).toBe(
      button("Kaya Youth Trust")
    );

    await screen.rerender(<WiresTable {...props({ rows: [] })} />);
    expect(wire_return_target({ row_id: casa.npo_id, index: 0 })).toBe(
      screen.getByText("No manual wires due").element().closest("td")
    );
  });
});
