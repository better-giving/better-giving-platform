import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { IBalanceTx } from "@/balance-txs";
import { row_meta as investments_row_meta } from "../../admin.$id.investments/txs/row-meta";
import { row_meta as savings_row_meta } from "./row-meta";

const tx = (bal_begin: number, bal_end: number): IBalanceTx => ({
  id: "abcd1234-5678",
  date_created: "2026-01-01T00:00:00.000Z",
  date_updated: "2026-01-01T00:00:00.000Z",
  npo_id: 1,
  account: "liq",
  bal_begin,
  bal_end,
  amount: Math.abs(bal_end - bal_begin),
  amount_units: 0,
  status: "final",
  account_other_id: null,
  account_other: "adjustment",
  account_other_bal_begin: null,
  account_other_bal_end: null,
});

const html = (meta: ReturnType<typeof savings_row_meta>) =>
  renderToStaticMarkup(createElement("div", null, meta.icon, meta.description));

describe.each([
  ["savings", savings_row_meta],
  ["investments", investments_row_meta],
])("%s row_meta adjustment", (_, row_meta) => {
  test("falling balance: label, red arrow, entry id", () => {
    const out = html(row_meta(tx(100, 60)));
    expect(out).toContain("Balance adjustment");
    expect(out).toContain("text-destructive");
    expect(out).not.toContain("text-success");
    expect(out).toContain("1234-5678".slice(-4));
    expect(out).not.toContain("Transfer");
  });

  test("rising balance: green arrow", () => {
    const out = html(row_meta(tx(60, 100)));
    expect(out).toContain("Balance adjustment");
    expect(out).toContain("text-success");
    expect(out).not.toContain("text-destructive");
  });
});
