import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import { TerminalCard } from "./terminal-card";

afterEach(async () => {
  await cleanup();
  await reset_viewport();
});

describe("terminal card label", () => {
  it("breaks at the slash, never inside a name, at 375px", async () => {
    await page.viewport(375, 800);
    const screen = await render(
      <div style={{ width: 150 }}>
        <TerminalCard label="better-giving / better-giving-platform">
          body
        </TerminalCard>
      </div>
    );
    const caption = screen.container.querySelector("figcaption");
    const name = [...(caption?.querySelectorAll("span") ?? [])].find(
      (s) => s.textContent === "better-giving-platform"
    );
    expect(name).toBeTruthy();
    const line = Number.parseFloat(
      getComputedStyle(caption as Element).lineHeight
    );
    // one line tall: the name did not wrap inside itself
    expect(name?.getBoundingClientRect().height).toBeLessThanOrEqual(line + 1);
    expect(caption?.textContent).toBe("better-giving / better-giving-platform");
    // the slash stays on the first line
    expect(caption?.firstElementChild?.textContent).toBe("better-giving /");
    // and the label did wrap, onto two lines, at the slash
    expect(caption?.getBoundingClientRect().height).toBeGreaterThan(line * 1.5);
  });

  it("stays one line when it fits", async () => {
    await page.viewport(1280, 800);
    const screen = await render(
      <TerminalCard label="better-giving / better-giving-platform">
        body
      </TerminalCard>
    );
    const caption = screen.container.querySelector("figcaption") as Element;
    const line = Number.parseFloat(getComputedStyle(caption).lineHeight);
    expect(caption.getBoundingClientRect().height).toBeLessThanOrEqual(
      line + 1
    );
  });

  it("renders a label without a slash as before", async () => {
    const screen = await render(
      <TerminalCard label="plain">body</TerminalCard>
    );
    await expect.element(screen.getByText("plain")).toBeVisible();
  });
});
