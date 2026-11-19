import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Group } from "./group";

const has_card = (el: Element) => /\bcard\b/.test(el.className);

describe("Group", () => {
  it("sits on a card by default", async () => {
    const screen = await render(
      <Group title="Details">
        <p>fields</p>
      </Group>
    );
    const region = screen.getByRole("region", { name: "Details" }).element();
    expect(has_card(region)).toBe(true);
  });

  it("drops the card for a group alone on its page", async () => {
    const screen = await render(
      <Group title="Details" card={false} classes="max-w-2xl">
        <p>fields</p>
      </Group>
    );
    const region = screen.getByRole("region", { name: "Details" }).element();
    expect(has_card(region)).toBe(false);
    expect(region.className).toContain("max-w-2xl");
  });

  it.each([true, false])(
    "names the region by its heading, at level 2 or 3, with card=%s",
    async (card) => {
      const screen = await render(
        <>
          <Group title="Two" card={card} heading_level={2}>
            <p>a</p>
          </Group>
          <Group title="Three" card={card}>
            <p>b</p>
          </Group>
        </>
      );
      await expect
        .element(screen.getByRole("heading", { name: "Two", level: 2 }))
        .toBeVisible();
      await expect
        .element(screen.getByRole("heading", { name: "Three", level: 3 }))
        .toBeVisible();
      const region = screen.getByRole("region", { name: "Two" }).element();
      const heading = screen.getByRole("heading", { name: "Two" }).element();
      expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    }
  );
});
