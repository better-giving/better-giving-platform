import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { BookmarkBtn } from "./bookmark-btn";

const user_mock = vi.hoisted(() => ({ current: null as unknown }));
const toggle_mock = vi.hoisted(() => vi.fn());
vi.mock("#/hooks/use-user", async () => {
  // stateful: a toggle really flips the bookmark, as the real hook does
  const { useState } = await import("react");
  return {
    use_user: () => {
      const [user, set_user] = useState(user_mock.current as any);
      return {
        user,
        toggle_bookmark: async (n: { id: number }, u: any) => {
          await toggle_mock(n, u);
          const saved = u.bookmarks.some((b: { id: number }) => b.id === n.id);
          set_user({
            ...u,
            bookmarks: saved
              ? u.bookmarks.filter((b: { id: number }) => b.id !== n.id)
              : [...u.bookmarks, n],
          });
        },
      };
    },
  };
});

afterEach(async () => {
  await cleanup();
  user_mock.current = null;
  toggle_mock.mockReset();
});

const npo = { id: 7, name: "Acme Relief" };
const btn = (entry = "/org/acme") => (
  <MemoryRouter initialEntries={[entry]}>
    <BookmarkBtn npo={npo} />
  </MemoryRouter>
);

describe("favorites heart", () => {
  it("sends a signed-out visitor to log in and back to the page they were on", async () => {
    const screen = await render(btn("/org/acme?ref=share"));
    const fav = screen.getByRole("link", {
      name: "Add to favorites",
      exact: true,
    });
    await expect
      .element(fav)
      .toHaveAttribute("href", "/login?redirect=%2Forg%2Facme%3Fref%3Dshare");
    expect(screen.getByRole("button").query()).toBeNull();
  });

  it("announces its saved state under one name, and pressing it toggles", async () => {
    const user = { bookmarks: [] };
    user_mock.current = user;
    toggle_mock.mockResolvedValue(undefined);
    const screen = await render(btn());
    const fav = screen.getByRole("button", {
      name: "Add to favorites",
      exact: true,
    });
    await expect.element(fav).toHaveAttribute("aria-pressed", "false");

    await fav.click();
    expect(toggle_mock).toHaveBeenCalledWith(npo, user);

    user_mock.current = { bookmarks: [npo] };
    await screen.rerender(btn());
    await expect.element(fav).toHaveAttribute("aria-pressed", "true");
  });

  describe("heart pop", () => {
    // the pop is the heart's transition class; only a press that saves earns it
    const heart = (screen: Awaited<ReturnType<typeof render>>) =>
      screen.getByRole("button").element().querySelector("svg") as SVGElement;

    it("a heart already saved on load stays still", async () => {
      user_mock.current = { bookmarks: [npo] };
      const screen = await render(btn());
      await expect
        .element(screen.getByRole("button"))
        .toHaveAttribute("aria-pressed", "true");
      expect(heart(screen).getAttribute("class")).toContain("fill-destructive");
      expect(heart(screen).getAttribute("class")).not.toContain("starting:");
    });

    it("pressing to save pops the filled heart in; pressing to unsave does not", async () => {
      user_mock.current = { bookmarks: [] };
      const screen = await render(btn());
      const button = screen.getByRole("button");

      await button.click();
      await expect.element(button).toHaveAttribute("aria-pressed", "true");
      expect(heart(screen).getAttribute("class")).toContain("fill-destructive");
      expect(heart(screen).getAttribute("class")).toContain(
        "starting:scale-75"
      );

      await button.click();
      await expect.element(button).toHaveAttribute("aria-pressed", "false");
      expect(heart(screen).getAttribute("class")).not.toContain(
        "fill-destructive"
      );
      expect(heart(screen).getAttribute("class")).not.toContain("starting:");
    });
  });
});
