import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Badge } from "./badge";

describe("Badge", () => {
  test("renders its label with the tone it was given", async () => {
    const screen = await render(<Badge tone="success">Completed</Badge>);
    const badge = screen.getByText("Completed");
    await expect.element(badge).toBeVisible();
    await expect.element(badge).toHaveAttribute("data-tone", "success");
  });

  test("a warning badge is the warning band with its own ink", async () => {
    const screen = await render(<Badge tone="warning">Pending review</Badge>);
    const badge = screen.getByText("Pending review");
    await expect.element(badge).toHaveAttribute("data-tone", "warning");
    // the authored pair, read off the rendered styles rather than the class
    // string, so a tone that names a token nothing draws fails here
    const style = getComputedStyle(badge.element());
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--warning-subtle)";
    probe.style.color = "var(--warning-subtle-fg)";
    document.body.append(probe);
    const want = getComputedStyle(probe);
    expect(want.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.backgroundColor).toBe(want.backgroundColor);
    expect(style.color).toBe(want.color);
    probe.remove();
  });
});
