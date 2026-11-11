import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { IRow } from "../helpers";
import { Table } from "../table";

const row = (o: Partial<IRow>): IRow => ({
  id: "don-001",
  date: "2025-01-01",
  status: "settled",
  currency: "USD",
  amount: 25,
  usd_value: 25,
  payment_method: "card",
  frequency: "one-time",
  recipient_id: "1",
  recipient_name: "Test NPO",
  recipient_type: "npo",
  via_id: "stripe:card",
  ...o,
});

async function render_table(items: IRow[]) {
  const Stub = createRoutesStub([
    {
      path: "/dashboard/donations",
      Component: () => <Table items={items} />,
    },
  ]);
  return await render(<Stub initialEntries={["/dashboard/donations"]} />);
}

describe("my donations — the row's receipt control", () => {
  test("a settled row links to its receipt", async () => {
    const screen = await render_table([row({ status: "settled" })]);
    await expect
      .element(screen.getByRole("link", { name: "View receipt" }))
      .toBeInTheDocument();
  });

  test.each(["refunded", "refunded_loss"] as const)(
    "a %s row offers no receipt, and no bank verification from its old intent",
    async (status) => {
      // a stripe bank payment keeps its verification link in via_extra
      // after it settles and is refunded
      const screen = await render_table([
        row({
          status,
          via_id: "stripe:us_bank_account",
          via_extra: "https://verify.example/x",
        }),
      ]);
      await expect.element(screen.getByText("Test NPO")).toBeVisible();
      expect(
        screen.getByRole("link", { name: "View receipt" }).query()
      ).toBeNull();
      expect(screen.getByText("Verify Bank").query()).toBeNull();
    }
  );
});

describe("my donations — stripe bank verification link", () => {
  const bank_row = (status: IRow["status"]) =>
    row({
      status,
      via_id: "stripe:us_bank_account",
      via_extra: "https://verify.example/x",
    });

  test("an intent bank row links to its microdeposit verification", async () => {
    const screen = await render_table([bank_row("intent")]);
    await expect
      .element(screen.getByRole("link", { name: "Verify Bank" }))
      .toHaveAttribute("href", "https://verify.example/x");
  });

  test.each(["failed", "cancelled", "expired", "confirmed"] as const)(
    "a %s bank row keeps its old link in via_extra but offers no verification",
    async (status) => {
      const screen = await render_table([bank_row(status)]);
      await expect.element(screen.getByText("Test NPO")).toBeVisible();
      expect(screen.getByText("Verify Bank").query()).toBeNull();
    }
  );
});

describe("my donations — a refunded gift's amount", () => {
  // text-decoration is not inherited, so the strike sits on some element
  // between the figure and its cell
  const struck = (cell: Element) =>
    [cell, ...cell.querySelectorAll("*")].some((el) =>
      getComputedStyle(el).textDecorationLine.includes("line-through")
    );

  test.each(["refunded", "refunded_loss"] as const)(
    "a %s row strikes its amount",
    async (status) => {
      const screen = await render_table([row({ status })]);
      const amount = screen.getByRole("row").nth(1).getByRole("cell").nth(2);
      await expect.element(amount).toBeVisible();
      expect(struck(amount.element())).toBe(true);
    }
  );

  test("a settled row does not", async () => {
    const screen = await render_table([row({ status: "settled" })]);
    const amount = screen.getByRole("row").nth(1).getByRole("cell").nth(2);
    await expect.element(amount).toBeVisible();
    expect(struck(amount.element())).toBe(false);
  });
});

describe("my donations — a cancelled duplicate", () => {
  test("strikes its amount and tells the donor no refund was made", async () => {
    const screen = await render_table([row({ status: "cancelled" })]);
    const cells = screen.getByRole("row").nth(1).getByRole("cell");
    await expect.element(cells.nth(4)).toBeVisible();
    expect(cells.nth(4).element().firstElementChild?.textContent).toBe(
      "Cancelled"
    );
    const figure = cells.nth(2).element().querySelector("*") as Element;
    const struck = [figure, ...figure.querySelectorAll("*")].some((el) =>
      getComputedStyle(el).textDecorationLine.includes("line-through")
    );
    expect(struck).toBe(true);
    const tip = cells.nth(4).getByRole("button", { name: "More info" });
    await expect
      .element(tip)
      .toHaveAccessibleDescription(
        "Cancelled Recorded twice. This duplicate was cancelled. No refund was made, and your gift is recorded once."
      );
  });

  test("a refunded row still says Refunded, with no cancelled note", async () => {
    const screen = await render_table([row({ status: "refunded" })]);
    const status = screen.getByRole("row").nth(1).getByRole("cell").nth(4);
    await expect.element(status).toBeVisible();
    expect(status.element().firstElementChild?.textContent).toBe("Refunded");
    expect(status.element().querySelector("svg")).toBeNull();
  });
});
