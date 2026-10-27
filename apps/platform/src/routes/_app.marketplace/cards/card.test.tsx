import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { EndowmentCard } from "#/types/npo";
import { Card } from "./card";

const toggle_mock = vi.hoisted(() => vi.fn());
vi.mock("#/hooks/use-user", () => ({
  use_user: () => ({ user: { bookmarks: [] }, toggle_bookmark: toggle_mock }),
}));

afterEach(async () => {
  await cleanup();
  toggle_mock.mockReset();
});

const TAGLINE = "Fresh groceries for every family in the valley";
const org: EndowmentCard = {
  id: 7,
  name: "Riverbend Food Collective",
  tagline: TAGLINE,
  logo: "https://example.com/logo.png",
  image: "https://example.com/banner.png",
  card_img: "https://example.com/card.png",
};

/** in a grid, as `Cards` lays it out: the card's rows are its parent's subgrid */
const card = (o: Partial<EndowmentCard> = {}) =>
  render(
    <MemoryRouter>
      <div className="grid">
        <Card {...org} {...o} />
      </div>
    </MemoryRouter>
  );

const banner = (c: HTMLElement) =>
  c.querySelector<HTMLImageElement>("[data-banner] img:not([width])");
const logo = (c: HTMLElement) =>
  c.querySelector<HTMLImageElement>("[data-banner] img[width]");

describe("marketplace card banner", () => {
  it("shows the org's banner, then its card image, then a plain fill", async () => {
    let screen = await card();
    await expect.element(screen.getByText(org.name)).toBeVisible();
    expect(banner(screen.container)?.getAttribute("src")).toBe(org.image);

    await cleanup();
    screen = await card({ image: null });
    await expect.element(screen.getByText(org.name)).toBeVisible();
    expect(banner(screen.container)?.getAttribute("src")).toBe(org.card_img);

    await cleanup();
    screen = await card({ image: null, card_img: null });
    await expect.element(screen.getByText(org.name)).toBeVisible();
    expect(screen.container.querySelector("[data-banner]")).not.toBeNull();
    expect(banner(screen.container)).toBeNull();
  });
});

describe("marketplace card body and actions", () => {
  it("shows the org's logo, or the placeholder in the same frame", async () => {
    let screen = await card();
    await expect.element(screen.getByText(org.name)).toBeVisible();
    expect(logo(screen.container)?.getAttribute("src")).toBe(org.logo);

    await cleanup();
    screen = await card({ logo: null });
    await expect.element(screen.getByText(org.name)).toBeVisible();
    expect(logo(screen.container)?.getAttribute("src")).toMatch(
      /flying-character/
    );
  });

  it("renders no tagline line when the tagline is empty or the placeholder", async () => {
    let screen = await card();
    await expect.element(screen.getByText(TAGLINE)).toBeVisible();

    for (const tagline of ["", " "]) {
      await cleanup();
      screen = await card({ tagline });
      await expect.element(screen.getByText(org.name)).toBeVisible();
      expect(screen.container.querySelector("p")).toBeNull();
    }
  });

  it("Donate opens the org's donate page, and Save bookmarks the org with its logo", async () => {
    const screen = await card({ logo: null });
    await expect
      .element(screen.getByRole("link", { name: "Donate", exact: true }))
      .toHaveAttribute("href", "/donate/7");

    toggle_mock.mockResolvedValue(undefined);
    await screen.getByRole("button", { name: "Add to favorites" }).click();
    expect(toggle_mock).toHaveBeenCalledWith(
      { id: 7, name: org.name, logo: org.card_img },
      { bookmarks: [] }
    );

    await cleanup();
    toggle_mock.mockClear();
    const with_logo = await card();
    await with_logo.getByRole("button", { name: "Add to favorites" }).click();
    expect(toggle_mock).toHaveBeenCalledWith(
      { id: 7, name: org.name, logo: org.logo },
      { bookmarks: [] }
    );
  });
});
