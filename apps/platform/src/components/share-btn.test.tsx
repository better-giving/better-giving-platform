import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ShareButton } from "./share-btn";

const url = "https://better.giving/marketplace/123";
const orgName = "Test Org";

async function open_menu() {
  const screen = await render(<ShareButton orgName={orgName} url={url} />);
  await screen.getByRole("button").first().click();
  return screen;
}

describe("ShareButton", () => {
  test("opens menu showing all social links and Copy link", async () => {
    const screen = await open_menu();

    await expect
      .element(screen.getByRole("menuitem", { name: /facebook/i }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: /twitter/i }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: /linkedin/i }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: /instagram/i }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: /email/i }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: /copy link/i }))
      .toBeVisible();
  });

  test("social links carry correct hrefs", async () => {
    const screen = await open_menu();

    const fb_href = screen
      .getByRole("menuitem", { name: /facebook/i })
      .element()
      .getAttribute("href");
    expect(fb_href).toContain("facebook.com/dialog/share");
    expect(fb_href).toContain(encodeURIComponent(url));

    const x_href = screen
      .getByRole("menuitem", { name: /twitter/i })
      .element()
      .getAttribute("href");
    expect(x_href).toContain("x.com/intent/tweet");
    expect(x_href).toContain(encodeURIComponent(orgName));
  });

  test("Copy link writes url to clipboard", async () => {
    const write_text = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const screen = await open_menu();

    await screen.getByRole("menuitem", { name: /copy link/i }).click();
    expect(write_text).toHaveBeenCalledWith(url);
  });
});
