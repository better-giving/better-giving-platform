import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { FeatureTable } from "./feature-table";

const rows = [
  {
    feature: "Platform fee",
    better_giving: "None",
    better_giving_sources: [],
    competitor: "Optional tip",
    competitor_sources: [],
    core: true,
  },
  {
    feature: "Payouts",
    better_giving: "Weekly",
    better_giving_sources: [],
    competitor: "Daily",
    competitor_sources: [],
    core: false,
  },
];

const render_table = () =>
  render(
    <FeatureTable competitor="Givebutter" rows={rows} numbers={new Map()} />
  );

const border_top = (el: Element) => getComputedStyle(el).borderTopWidth;

afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("FeatureTable", () => {
  test("the extra rows open under a column-group header, not a value cell", async () => {
    const screen = await render_table();
    await expect
      .element(screen.getByRole("columnheader", { name: "More on Givebutter" }))
      .toHaveAttribute("scope", "colgroup");
    expect(
      screen.getByRole("cell", { name: "More on Givebutter" }).query()
    ).toBeNull();
  });

  test("stacked below md: one rule per block, values named once", async () => {
    await page.viewport(375, 800);
    const screen = await render_table();

    const feature = screen.getByRole("rowheader", { name: "Platform fee" });
    await expect.element(feature).toBeVisible();
    await expect.element(screen.getByRole("table")).toBeVisible();
    // the visible "Better Giving" / "Givebutter" labels stay out of the name
    const ours = screen.getByRole("cell", { name: "None", exact: true });
    const theirs = screen.getByRole("cell", {
      name: "Optional tip",
      exact: true,
    });
    await expect.element(ours).toBeVisible();
    await expect
      .element(screen.getByText("Better Giving").last())
      .toBeVisible();

    expect(border_top(feature.element())).toBe("0px");
    expect(border_top(ours.element())).toBe("0px");
    expect(border_top(theirs.element())).toBe("0px");
    // the second block's own rule is the one divider left
    const second = screen.getByRole("row").nth(3).element();
    expect(border_top(second)).toBe("1px");
  });

  test("from md the table keeps its row dividers", async () => {
    await page.viewport(1440, 900);
    const screen = await render_table();
    const ours = screen.getByRole("cell", { name: "None", exact: true });
    await expect.element(ours).toBeVisible();
    expect(border_top(ours.element())).toBe("1px");
  });
});
