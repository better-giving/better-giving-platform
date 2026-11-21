import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { DateField } from "./date-field";

function Host() {
  const [value, set_value] = useState("2026-11-21");
  return (
    <form>
      <input aria-label="Other" />
      <DateField label="Date" value={value} onChange={set_value} />
    </form>
  );
}

const month_of = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getByRole("spinbutton").first().element() as HTMLElement;

// the date input arms a requestAnimationFrame that focuses a segment; on a
// busy page it arrives after the user has gone to another field
describe("a date segment's focus() from code", () => {
  test("is dropped while focus is on another field of the same form", async () => {
    const screen = await render(<Host />);
    const other = screen.getByLabelText("Other");
    await other.click();
    month_of(screen).focus();
    expect(document.activeElement).toBe(other.element());
  });

  test("goes through right after the user acted on the date field", async () => {
    const screen = await render(<Host />);
    await screen.getByLabelText("Other").click();
    // a press on the date's label, then the code focuses its first segment
    month_of(screen).dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true })
    );
    month_of(screen).focus();
    expect(document.activeElement).toBe(month_of(screen));
  });

  test("goes through while focus is nowhere", async () => {
    const screen = await render(<Host />);
    await screen.getByLabelText("Other").click();
    (document.activeElement as HTMLElement).blur();
    month_of(screen).focus();
    expect(document.activeElement).toBe(month_of(screen));
  });

  test("is dropped again once the user's act on the date is over", async () => {
    const screen = await render(<Host />);
    month_of(screen).dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true })
    );
    await new Promise((r) => setTimeout(r, 400));
    await screen.getByLabelText("Other").click();
    month_of(screen).focus();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Other").element()
    );
  });
});
