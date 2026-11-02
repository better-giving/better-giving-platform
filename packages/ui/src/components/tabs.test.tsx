import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TabPanel, Tabs } from "./tabs";

const items = [
  { value: "profile", label: "Profile" },
  { value: "donation", label: "Donation Page" },
  { value: "fundraiser", label: "Fundraiser" },
];

function Subject() {
  return (
    <Tabs items={items} defaultValue="profile">
      {items.map((it) => (
        <TabPanel key={it.value} value={it.value}>
          {it.label} panel
        </TabPanel>
      ))}
    </Tabs>
  );
}

describe("Tabs", () => {
  test("clicking a trigger selects it and shows its panel", async () => {
    const screen = await render(<Subject />);
    await expect
      .element(screen.getByRole("tabpanel"))
      .toHaveTextContent("Profile panel");

    await screen.getByRole("tab", { name: "Donation Page" }).click();

    await expect
      .element(screen.getByRole("tab", { name: "Donation Page" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("tabpanel"))
      .toHaveTextContent("Donation Page panel");
  });

  test("arrow keys move the selection", async () => {
    const screen = await render(<Subject />);
    await screen.getByRole("tab", { name: "Profile" }).click();

    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("tab", { name: "Donation Page" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("tab", { name: "Profile" }))
      .toHaveAttribute("aria-selected", "false");

    await userEvent.keyboard("{ArrowLeft}");
    await expect
      .element(screen.getByRole("tab", { name: "Profile" }))
      .toHaveAttribute("aria-selected", "true");

    // loops from the first trigger back to the last
    await userEvent.keyboard("{ArrowLeft}");
    await expect
      .element(screen.getByRole("tab", { name: "Fundraiser" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("tabpanel"))
      .toHaveTextContent("Fundraiser panel");
  });

  test("controlled value reports the chosen item's value", async () => {
    const seen: string[] = [];
    const screen = await render(
      <Tabs items={items} value="profile" onValueChange={(v) => seen.push(v)}>
        <TabPanel value="profile">Profile panel</TabPanel>
      </Tabs>
    );
    await screen.getByRole("tab", { name: "Fundraiser" }).click();
    expect(seen).toEqual(["fundraiser"]);
  });

  describe("a row wider than the screen", () => {
    // restore what the file found, not a size nothing configures
    let before = { width: 0, height: 0 };
    beforeEach(() => {
      before = { width: window.innerWidth, height: window.innerHeight };
    });
    afterEach(() => page.viewport(before.width, before.height));

    const many = [
      "Profile",
      "Donation Page",
      "Fundraisers and campaigns",
      "Supporters",
      "Receipts and tax documents",
      "Integrations",
      "Team members",
      "Settings",
    ].map((label) => ({ value: label, label }));

    test("keeps every label on one line and scrolls the row, not the page", async () => {
      await page.viewport(375, 812);
      const screen = await render(
        <Tabs items={many} defaultValue="Profile">
          <TabPanel value="Profile">Profile panel</TabPanel>
        </Tabs>
      );
      const list = screen.getByRole("tablist").element() as HTMLElement;
      const tabs = Array.from(list.querySelectorAll<HTMLElement>("[role=tab]"));
      expect(tabs).toHaveLength(many.length);

      // the row scrolls sideways inside its own box
      expect(getComputedStyle(list).overflowX).toBe("auto");
      expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
      expect(list.getBoundingClientRect().right).toBeLessThanOrEqual(
        window.innerWidth
      );
      // and the page does not widen to hold it
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        window.innerWidth
      );

      for (const tab of tabs) {
        // no label wraps: one line of text high, and the full label shown
        const line = Number.parseFloat(getComputedStyle(tab).lineHeight);
        const pad =
          Number.parseFloat(getComputedStyle(tab).paddingTop) +
          Number.parseFloat(getComputedStyle(tab).paddingBottom);
        expect(tab.clientHeight).toBeLessThan(line * 2 + pad);
        expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth);
      }
      // none is squeezed to fit: the row holds more than the box does
      const total = tabs.reduce(
        (n, t) => n + t.getBoundingClientRect().width,
        0
      );
      expect(total).toBeGreaterThan(list.clientWidth);
    });

    /** how far the row's mask fades in from each edge, as computed */
    const fades = (list: HTMLElement) => {
      const cs = getComputedStyle(list);
      return {
        start: Number.parseFloat(cs.getPropertyValue("--scroll-fade-start")),
        end: Number.parseFloat(cs.getPropertyValue("--scroll-fade-end")),
      };
    };

    test("an overflowing row fades the edge it runs past, and moves the fade as it scrolls", async () => {
      await page.viewport(375, 812);
      const screen = await render(
        <Tabs items={many} defaultValue="Profile">
          <TabPanel value="Profile">Profile panel</TabPanel>
        </Tabs>
      );
      const list = screen.getByRole("tablist").element() as HTMLElement;
      // at rest only the far edge fades: there is nothing behind the first tab
      await expect.poll(() => fades(list).end).toBeGreaterThan(0);
      expect(fades(list).start).toBe(0);

      list.scrollLeft = list.scrollWidth;
      await expect.poll(() => fades(list).end).toBe(0);
      expect(fades(list).start).toBeGreaterThan(0);
    });

    test("a tab focused by keyboard scrolls fully clear of the faded edge", async () => {
      await page.viewport(375, 812);
      const screen = await render(
        <Tabs items={many} defaultValue="Profile">
          <TabPanel value="Profile">Profile panel</TabPanel>
        </Tabs>
      );
      const list = screen.getByRole("tablist").element() as HTMLElement;
      await expect.poll(() => fades(list).end).toBeGreaterThan(0);
      (
        screen.getByRole("tab", { name: "Profile" }).element() as HTMLElement
      ).focus();
      await userEvent.keyboard("{ArrowRight}");
      await userEvent.keyboard("{ArrowRight}");
      const tab = screen
        .getByRole("tab", { name: "Fundraisers and campaigns" })
        .element() as HTMLElement;
      await expect.element(tab).toHaveFocus();

      await expect
        .poll(() => {
          const fade = fades(list).end;
          return (
            list.getBoundingClientRect().right -
            tab.getBoundingClientRect().right -
            fade
          );
        })
        .toBeGreaterThanOrEqual(-1);
    });

    test("a row that fits fades neither edge", async () => {
      await page.viewport(1440, 900);
      const screen = await render(<Subject />);
      const list = screen.getByRole("tablist").element() as HTMLElement;
      expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
      expect(fades(list)).toEqual({ start: 0, end: 0 });
    });
  });
});
