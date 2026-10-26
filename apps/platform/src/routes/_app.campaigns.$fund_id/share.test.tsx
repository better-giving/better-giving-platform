import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { shared_via_facebook } from "#/__tests__/fixtures/share-target";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import { Share } from "./share";

describe("Share", () => {
  test("the default render keeps the heading", async () => {
    const screen = await render(
      <Share recipientName="Harbor Clinic" url="https://better.giving/c" />
    );
    await expect
      .element(screen.getByRole("heading", { name: "Spread the word!" }))
      .toBeVisible();
    await expect
      .element(screen.getByText(/Encourage your friends/))
      .toBeVisible();
  });

  test("the button trigger opens the networks and skips the invested line", async () => {
    const screen = await render(
      <Share
        trigger="button"
        recipientName="Harbor Clinic"
        url="https://better.giving/c"
      />
    );
    expect(screen.getByText("Spread the word!").query()).toBeNull();
    expect(screen.getByText(/Encourage your friends/).query()).toBeNull();

    await screen.getByRole("button", { name: "Share", exact: true }).click();
    await userEvent.click(
      screen.getByRole("button", { name: "Share on LinkedIn" })
    );
    const prompt = screen.getByText(/Donate to/);
    await expect.element(prompt).toBeVisible();
    expect(prompt.element().textContent).not.toContain(
      "Every gift is invested"
    );
    expect(prompt.element().textContent).toContain("Donate to");
    expect(prompt.element().textContent).toContain("Harbor Clinic");
  });

  test("the icon trigger is named by its label and opens the same chooser", async () => {
    const screen = await render(
      <>
        <Share
          trigger="icon"
          recipientName="Harbor Clinic"
          url="https://better.giving/c"
        />
        <Share
          trigger="icon"
          label="Share Spring Drive"
          recipientName="Spring Drive"
          url="https://better.giving/f"
        />
      </>
    );
    expect(screen.getByText("Spread the word!").query()).toBeNull();
    await expect
      .element(screen.getByRole("button", { name: "Share", exact: true }))
      .toBeVisible();
    await screen
      .getByRole("button", { name: "Share Spring Drive", exact: true })
      .click();
    await expect
      .element(screen.getByRole("dialog", { name: "Share" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Share on LinkedIn" }))
      .toBeVisible();
  });

  test("the icon trigger shares its own recipient and url, not a sibling's", async () => {
    const screen = await render(
      <>
        <Share
          trigger="icon"
          recipientName="Harbor Clinic"
          url="https://better.giving/c"
        />
        <Share
          trigger="icon"
          label="Share Spring Drive"
          recipientName="Spring Drive"
          url="https://better.giving/f"
        />
      </>
    );
    await screen
      .getByRole("button", { name: "Share Spring Drive", exact: true })
      .click();
    expect(await shared_via_facebook(screen)).toEqual({
      recipient: "Spring Drive",
      url: "https://better.giving/f",
    });
  });

  describe("the chooser", () => {
    afterEach(async () => {
      await reset_viewport();
    });

    const open_chooser = async () => {
      const screen = await render(
        <Share
          trigger="icon"
          recipientName="Harbor Clinic"
          url="https://better.giving/c"
        />
      );
      await screen.getByRole("button", { name: "Share", exact: true }).click();
      const dialog = screen.getByRole("dialog", { name: "Share" });
      await expect.element(dialog).toBeVisible();
      return { screen, dialog };
    };

    test("opens with a visible heading and Close on one row, every network, and Close dismisses it", async () => {
      await page.viewport(1440, 900);
      const { dialog } = await open_chooser();
      const heading = dialog.getByRole("heading", { name: "Share" });
      await expect.element(heading).toBeVisible();
      const close = dialog.getByRole("button", { name: "Close" });
      const h = heading.element().getBoundingClientRect();
      const c = close.element().getBoundingClientRect();
      expect(h.top).toBeLessThan(c.bottom);
      expect(c.top).toBeLessThan(h.bottom);
      expect(h.right).toBeLessThanOrEqual(c.left);

      for (const name of ["LinkedIn", "Facebook", "X", "Telegram"]) {
        const btn = dialog.getByRole("button", { name: `Share on ${name}` });
        await expect.element(btn).toBeVisible();
        // offset sizes: the open animation scales the box, layout does not
        const el = btn.element() as HTMLElement;
        expect(el.offsetWidth).toBeGreaterThanOrEqual(44);
        expect(el.offsetHeight).toBeGreaterThanOrEqual(44);
        expect(el.getBoundingClientRect().top).toBeGreaterThanOrEqual(h.bottom);
      }

      (close.element() as HTMLElement).click();
      await expect.element(dialog).not.toBeInTheDocument();
    });

    test("fits inside a 375px viewport", async () => {
      await page.viewport(375, 812);
      const { dialog } = await open_chooser();
      await vi.waitFor(() => {
        const r = dialog.element().getBoundingClientRect();
        expect(r.left).toBeGreaterThan(0);
        expect(r.right).toBeLessThan(375);
      });
    });
  });
});
