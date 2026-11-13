import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { type IBappRow, Table } from "./table";

const row = (id: string, o: Partial<IBappRow>): IBappRow => ({
  id,
  npo_id: 7,
  npo_name: `Npo ${id}`,
  bank_summary: `Chase ****${id}`,
  bank_statement_url: "https://example.com/s.pdf",
  date_created: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  status: "under-review",
  rejection_reason: "",
  account_holder: null,
  holder_match: "unknown",
  ...o,
});

const render_table = (items: IBappRow[]) => {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Table items={items} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
};

describe("banking applications list — account holder", () => {
  test("puts the stored holder under the account, and flags only a mismatched one", async () => {
    const screen = await render_table([
      row("4821", {
        account_holder: "Dana Whitfield",
        holder_match: "mismatch",
      }),
      row("9930", {
        account_holder: "Harbor Light Food Pantry Inc.",
        holder_match: "match",
      }),
    ]);
    const dana = screen.getByText("Dana Whitfield");
    await expect.element(dana).toBeVisible();
    await expect
      .element(screen.getByText("Harbor Light Food Pantry Inc."))
      .toBeVisible();

    const badges = screen.getByText("Name mismatch", { exact: true });
    expect(badges.elements()).toHaveLength(1);
    expect(dana.element().contains(badges.element())).toBe(true);
  });

  test("draws no second row without a stored holder", async () => {
    const screen = await render_table([row("6115", {})]);
    const summary = screen.getByText("Chase ****6115", { exact: true });
    await expect.element(summary).toBeVisible();
    // the account cell holds only the summary
    expect(summary.element().closest("td")?.children).toHaveLength(0);
  });
});
