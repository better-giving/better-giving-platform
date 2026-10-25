import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import { DonateButton } from "./donate";
import { OrgHeader } from "./header";

const user_mock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("#/hooks/use-user", () => ({
  use_user: () => ({ user: user_mock.current, toggle_bookmark: vi.fn() }),
}));

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  user_mock.current = null;
  window.scrollTo(0, 0);
  await reset_viewport();
});

const header = (name = "Acme Relief") => (
  <MemoryRouter>
    <OrgHeader
      name={name}
      to="/org/acme"
      bookmark={{ id: 7, name }}
      share={{ recipientName: name, url: "https://x/org/acme" }}
      donate_to="/donate/7"
    />
  </MemoryRouter>
);

describe("org header", () => {
  it("makes Favorite a 44px target in Share's ink, signed in or not", async () => {
    await page.viewport(1280, 900);
    // signed out it is a link to log in, signed in a toggle button
    for (const [user, role] of [
      [{ bookmarks: [] }, "button"],
      [null, "link"],
    ] as const) {
      user_mock.current = user;
      const screen = await render(header());
      const fav = screen.getByRole(role, {
        name: "Add to favorites",
        exact: true,
      });
      await expect.element(fav).toBeVisible();
      const box = fav.element().getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const ink = (el: Element) =>
        getComputedStyle(el.querySelector("svg") as SVGElement).color;
      const share = screen.getByRole("button", { name: "Share", exact: true });
      expect(ink(fav.element())).toBe(ink(share.element()));
      await cleanup();
    }
  });

  it.each([1280, 375])(
    "sets Share and Favorite's glyphs 20px apart, overlapping Share's target by no more than 4px, at %i",
    async (w) => {
      await page.viewport(w, 800);
      const screen = await render(header());
      const share = screen.getByRole("button", { name: "Share", exact: true });
      const fav = screen.getByRole("link", { name: "Add to favorites" });
      await expect.element(fav).toBeVisible();
      for (const el of [share.element(), fav.element()]) {
        const r = el.getBoundingClientRect();
        expect(r.width).toBeGreaterThanOrEqual(44);
        expect(r.height).toBeGreaterThanOrEqual(44);
      }
      const glyph = (el: Element) =>
        (el.querySelector("svg") as SVGElement).getBoundingClientRect();
      const gap = glyph(fav.element()).left - glyph(share.element()).right;
      expect(gap).toBeCloseTo(20, 0);
      const overlap =
        share.element().getBoundingClientRect().right -
        fav.element().getBoundingClientRect().left;
      expect(overlap).toBeLessThanOrEqual(4);
    }
  );

  it("leads with the monogram when the org has no logo", async () => {
    const screen = await render(header());
    const home = screen.getByRole("link", { name: "Acme Relief" });
    await expect.element(home).toBeVisible();
    const mark = home.element().querySelector("[data-monogram]");
    expect(mark).toHaveTextContent("A");
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("narrows Donate's side padding on a phone", async () => {
    const inset = async (width: number) => {
      await page.viewport(width, 800);
      const screen = await render(header());
      const donate = screen.getByRole("link", { name: "Donate" });
      await expect.element(donate).toBeVisible();
      const { paddingLeft, paddingRight } = getComputedStyle(donate.element());
      await cleanup();
      return [paddingLeft, paddingRight];
    };
    expect(await inset(375)).toEqual(["16px", "16px"]);
    expect(await inset(640)).toEqual(["24px", "24px"]);
  });

  it("observes the header once per mount, across re-renders, and lets go on unmount", async () => {
    await page.viewport(1280, 900);
    const counts = { made: 0, disconnected: 0 };
    const Real = globalThis.IntersectionObserver;
    vi.stubGlobal(
      "IntersectionObserver",
      class extends Real {
        constructor(...args: ConstructorParameters<typeof Real>) {
          super(...args);
          counts.made++;
        }
        disconnect() {
          counts.disconnected++;
          super.disconnect();
        }
      }
    );
    const screen = await render(header());
    await expect.element(screen.getByRole("banner")).toBeVisible();
    await screen.rerender(header("Acme Relief International"));
    await expect
      .element(screen.getByRole("link", { name: "Acme Relief International" }))
      .toBeVisible();
    expect(counts).toEqual({ made: 1, disconnected: 0 });
    await screen.unmount();
    expect(counts).toEqual({ made: 1, disconnected: 1 });
  });

  describe("Donate once the hero's has scrolled away", () => {
    /** a hero Donate the header watches, with page enough to scroll it off */
    function Page() {
      const [hero_donate, set_hero_donate] = useState<HTMLElement | null>(null);
      return (
        <MemoryRouter>
          <OrgHeader
            name="Acme Relief"
            to="/org/acme"
            donate_to="/donate/7"
            donate_after={hero_donate}
          />
          <main className="h-[300dvh]">
            <DonateButton to="/donate/7" size="lg" ref={set_hero_donate} />
          </main>
        </MemoryRouter>
      );
    }

    it("stays out of the header while the hero's Donate is in view, and comes in after", async () => {
      await page.viewport(1280, 900);
      const screen = await render(<Page />);
      const in_header = screen
        .getByRole("banner")
        .getByRole("link", { name: "Donate" });
      const hero = screen.getByRole("main").getByRole("link", {
        name: "Donate",
      });
      await expect.element(hero).toBeVisible();
      await expect.element(in_header).not.toBeInTheDocument();

      // just under the pinned header is out of view too
      const top = hero.element().getBoundingClientRect().top;
      window.scrollTo(0, top);
      await expect.element(in_header).toBeVisible();
      await expect.element(in_header).toHaveAttribute("href", "/donate/7");

      window.scrollTo(0, 0);
      await expect.element(in_header).not.toBeInTheDocument();
    });

    it("follows the same rule on a phone", async () => {
      await page.viewport(375, 800);
      const screen = await render(<Page />);
      const in_header = screen
        .getByRole("banner")
        .getByRole("link", { name: "Donate" });
      await expect
        .element(screen.getByRole("main").getByRole("link", { name: "Donate" }))
        .toBeVisible();
      await expect.element(in_header).not.toBeInTheDocument();
      window.scrollTo(0, 2000);
      await expect.element(in_header).toBeVisible();
    });

    it("counts a hero Donate with no box as away", async () => {
      await page.viewport(1280, 900);
      function Hidden() {
        const [hero, set_hero] = useState<HTMLElement | null>(null);
        return (
          <MemoryRouter>
            <OrgHeader
              name="Acme Relief"
              to="/org/acme"
              donate_to="/donate/7"
              donate_after={hero}
            />
            <main>
              <DonateButton to="/donate/7" ref={set_hero} classes="hidden" />
            </main>
          </MemoryRouter>
        );
      }
      const screen = await render(<Hidden />);
      await expect
        .element(
          screen.getByRole("banner").getByRole("link", { name: "Donate" })
        )
        .toBeVisible();
    });
  });
});
