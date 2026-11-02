import { useState } from "react";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CheckField } from "./check-field";

function Controlled() {
  const [on, set_on] = useState(false);
  return (
    <CheckField
      name="hide_bg_tip"
      checked={on}
      onChange={(e) => set_on(e.target.checked)}
    >
      Hide Better Giving tip
    </CheckField>
  );
}

describe("CheckField", () => {
  test("a click on the label toggles the box and the checked state follows", async () => {
    const screen = await render(<Controlled />);
    const box = screen.getByRole("checkbox", {
      name: "Hide Better Giving tip",
    });
    await expect.element(box).not.toBeChecked();
    await screen.getByText("Hide Better Giving tip").click();
    await expect.element(box).toBeChecked();
    await box.click();
    await expect.element(box).not.toBeChecked();
  });

  test("space toggles it from the keyboard", async () => {
    const screen = await render(<Controlled />);
    const box = screen.getByRole("checkbox", {
      name: "Hide Better Giving tip",
    });
    await userEvent.tab();
    await expect.element(box).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect.element(box).toBeChecked();
    await userEvent.keyboard(" ");
    await expect.element(box).not.toBeChecked();
  });

  test("the box is drawn by the system, not the UA: field edge at rest, brand fill when checked", async () => {
    const screen = await render(<Controlled />);
    const el = screen
      .getByRole("checkbox", { name: "Hide Better Giving tip" })
      .element() as HTMLInputElement;
    const css = () => getComputedStyle(el);
    expect(css().appearance).toBe("none");
    // tailwind's `before:` writes `content` itself, so the glyph exists at
    // rest too — what keeps it off an unchecked box is display
    expect(getComputedStyle(el, "::before").display).toBe("none");
    const rest_edge = css().borderTopColor;
    const rest_fill = css().backgroundColor;
    expect(css().borderTopWidth).toBe("1px");
    el.click();
    await expect.poll(() => css().backgroundColor).not.toBe(rest_fill);
    expect(css().borderTopColor).not.toBe(rest_edge);
    expect(getComputedStyle(el, "::before").display).not.toBe("none");
  });

  test("disabled: does not toggle", async () => {
    const screen = await render(
      <CheckField name="locked" disabled>
        Locked option
      </CheckField>
    );
    const box = screen.getByRole("checkbox", { name: "Locked option" });
    await expect.element(box).toBeDisabled();
    await screen.getByText("Locked option").click({ force: true });
    await expect.element(box).not.toBeChecked();
  });
});
