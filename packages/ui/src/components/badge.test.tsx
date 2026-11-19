import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Badge } from "./badge";

/** the painted pair a token fill and ink resolve to, read off a probe element */
function painted(bg: string, fg: string) {
  const probe = document.createElement("span");
  probe.style.backgroundColor = `var(${bg})`;
  probe.style.color = `var(${fg})`;
  document.body.append(probe);
  const { backgroundColor, color } = getComputedStyle(probe);
  probe.remove();
  return { backgroundColor, color };
}

describe("Badge", () => {
  test("renders its label", async () => {
    const screen = await render(<Badge variant="success">Completed</Badge>);
    await expect.element(screen.getByText("Completed")).toBeVisible();
  });

  test("a warning badge is the warning band with its own ink", async () => {
    const screen = await render(
      <Badge variant="warning">Pending review</Badge>
    );
    // the authored pair, read off the rendered styles rather than the class
    // string, so a variant that names a token nothing draws fails here
    const style = getComputedStyle(
      screen.getByText("Pending review").element()
    );
    const want = painted("--warning-subtle", "--warning-subtle-fg");
    expect(want.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.backgroundColor).toBe(want.backgroundColor);
    expect(style.color).toBe(want.color);
  });

  test("quiet is a gray fill with gray ink, in the medium weight", async () => {
    const screen = await render(<Badge variant="quiet">Charity</Badge>);
    const style = getComputedStyle(screen.getByText("Charity").element());
    const want = painted("--gray-3", "--gray-11");
    expect(style.backgroundColor).toBe(want.backgroundColor);
    expect(style.color).toBe(want.color);
    expect(style.fontWeight).toBe("500");
  });

  test("outline has no fill, so an ended record is not a status colour", async () => {
    const screen = await render(<Badge variant="outline">Ended</Badge>);
    const style = getComputedStyle(screen.getByText("Ended").element());
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style.boxShadow).not.toBe("none");
  });

  test("classes land on the badge", async () => {
    const screen = await render(
      <Badge classes="shrink-0 justify-self-start">Held</Badge>
    );
    const badge = screen.getByText("Held").element();
    expect(badge.classList.contains("shrink-0")).toBe(true);
    expect(badge.classList.contains("justify-self-start")).toBe(true);
  });
});
