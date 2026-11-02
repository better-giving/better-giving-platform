import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Fees } from "./fees";

const none = { base: 0, fsa: 0, processing: 0, processing_allowance: 0 };

describe("donation fees cell", () => {
  test("a gift that took no fee reads $0.00, not an empty cell", async () => {
    const screen = await render(<Fees {...none} />);
    await expect
      .element(screen.getByText("$0.00", { exact: true }))
      .toBeVisible();
  });

  test("each fee shows as money to the cent", async () => {
    const screen = await render(
      <Fees {...none} base={1.42857} processing={2.7619} />
    );
    await expect
      .element(screen.getByText("$1.43", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText("$2.76", { exact: true }))
      .toBeVisible();
  });
});
