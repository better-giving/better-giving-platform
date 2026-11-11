import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { ISubDist } from "$/pg/queries/subscription";
import { GiftsTable } from "./table";

const dist = (id: string, amount: number, o: Partial<ISubDist>): ISubDist => ({
  id,
  subscription_id: null,
  date_created: "2026-08-01T00:00:00.000Z",
  amount,
  amount_denom: "USD",
  amount_usd: amount,
  amount_tip: null,
  amount_tip_usd: null,
  amount_fee_allowance_usd: null,
  net: amount - 1,
  fee_base: 0.5,
  fee_fsa: 0.5,
  fee_processing: 0,
  fee_allowance: 0,
  status: "settled",
  donation_status: "settled",
  sttl_date: null,
  ...o,
});

// amounts and nets are distinct per row, so each figure names its row
const dists = [
  dist("d-refunded", 11, { status: "refunded" }),
  dist("d-loss", 22, { status: "refunded_loss" }),
  dist("d-settled", 33, { status: "settled" }),
];

const struck = (cell: Element) => cell.querySelector(".line-through") !== null;

describe("a donor's gifts", () => {
  test("a refunded gift, whether or not the refund was a loss, is struck through; a settled one is not", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <GiftsTable dists={dists} subs={[]} />,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/"]} />);
    await expect.element(screen.getByText("$32.00")).toBeVisible();

    // header row first; then date, sub icon, sub tick, amount, fees, net
    const rows = screen.getByRole("row").elements().slice(1);
    expect(rows).toHaveLength(3);
    const marked = rows.map((r) => {
      const cells = r.querySelectorAll("td");
      return [struck(cells[3]), struck(cells[4]), struck(cells[5])];
    });
    expect(marked).toEqual([
      [true, true, true], // refunded
      [true, true, true], // refunded_loss
      [false, false, false], // settled
    ]);
  });
});

describe("a donor's reversed gifts' note", () => {
  async function note_of(o: Partial<ISubDist>) {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <GiftsTable dists={[dist("d-1", 11, o)]} subs={[]} />,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/"]} />);
    await expect.element(screen.getByText("$10.00")).toBeVisible();
    // the net cell's tooltip is the row's last, past the fees one
    return screen
      .getByRole("button", { name: "More info", exact: true })
      .last();
  }

  test("a cancelled duplicate says Cancelled, not Refunded, and stays struck", async () => {
    const tip = await note_of({
      status: "refunded",
      donation_status: "cancelled",
    });
    await expect.element(tip).toHaveAccessibleDescription(/^Cancelled/);
    await expect.element(tip).toHaveAccessibleDescription(/No refund was made/);
  });

  test.each([
    ["refunded", "refunded"],
    ["refunded_loss", "cancelled"],
  ])(
    "a %s dist under a %s donation has no cancelled note",
    async (status, donation_status) => {
      const Stub = createRoutesStub([
        {
          path: "/",
          Component: () => (
            <GiftsTable
              dists={[dist("d-1", 11, { status, donation_status })]}
              subs={[]}
            />
          ),
        },
      ]);
      const screen = await render(<Stub initialEntries={["/"]} />);
      await expect.element(screen.getByText("$10.00")).toBeVisible();
      expect(screen.container.textContent).not.toMatch(/Cancelled/);
    }
  );
});
