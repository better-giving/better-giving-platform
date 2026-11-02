import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Summary } from "./common/summary";
import { Context, use_donation } from "./context";
import type { TDonation } from "./types";
import { use_pay_hold } from "./use-pay-hold";

function Hold() {
  use_pay_hold(true);
  return null;
}

function Screen(props: { on_back: () => void }) {
  const { pay_busy } = use_donation();
  return (
    <Summary
      Amount={({ amount }) => <span>{amount}</span>}
      amount={10}
      back_disabled={pay_busy === true}
      on_back={() => {
        if (pay_busy) return;
        props.on_back();
      }}
    >
      <Hold />
    </Summary>
  );
}

describe("use_pay_hold", () => {
  test("a payment in flight shuts go back", async () => {
    const on_back = vi.fn();
    const on_pay_busy = vi.fn();
    const screen = await render(
      <Context {...({} as TDonation)} on_pay_busy={on_pay_busy}>
        <Screen on_back={on_back} />
      </Context>
    );
    const back = screen.getByRole("button", { name: "Go back" });
    await expect.element(back).toBeDisabled();
    expect(on_pay_busy).toHaveBeenCalledWith(true);
    await back.click({ force: true });
    expect(on_back).not.toHaveBeenCalled();
  });
});
