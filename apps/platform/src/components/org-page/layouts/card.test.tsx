import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import {
  BANNER,
  donates,
  header_donate,
  pinned_to_bottom,
  scroll_past_hero_donate,
} from "#/__tests__/fixtures/layout-dom";
import {
  above_fold,
  EIN,
  header_donate_in_view,
  in_view,
  LONG_NAME,
  message,
  npo,
  org_figures,
  org_layout,
  TAGLINE_MAX,
} from "#/__tests__/fixtures/org-layout";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import type { INpoPublic } from "$/pg/queries/npo";
import { Card } from "./card";
import type { IOrgLayout } from "./types";
import { FAILED_LINE } from "./ways-to-help";

// the viewer the header's favorite button reads; null is signed out
vi.mock("#/hooks/use-user", () => ({
  use_user: () => ({ user: null, toggle_bookmark: vi.fn() }),
}));

afterEach(async () => {
  await cleanup();
  await reset_viewport();
  window.scrollTo(0, 0);
});

const SIZES = [
  [1440, 900],
  [375, 812],
] as const;

/** `max-w-3xl`, the reading measure */
const READING_WIDTH = 768;

/** an org with no story and nothing to list, with a banner that loads
 * offline, unless told otherwise */
function mount(o: Partial<IOrgLayout> = {}, n: Partial<INpoPublic> = {}) {
  const props = org_layout({
    ...o,
    npo: npo({ image: BANNER, overview_pt: undefined, ...n }),
  });
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Card {...props} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const main_of = (root: Element) => root.querySelector("main") as HTMLElement;
const card_of = (root: Element) =>
  main_of(root).querySelector("article") as HTMLElement;
/** the card and the strip under it, as one centred block */
const block_of = (root: Element) => card_of(root).parentElement as HTMLElement;

describe("Card", () => {
  test.each([3322, 0])(
    "shows none of the org's figures, with %i raised and a goal stored",
    async (raised) => {
      const org = { contributions_total: raised, target: "8000" };
      const screen = await mount({}, org);
      await expect
        .element(screen.getByRole("heading", { level: 1 }))
        .toBeVisible();
      expect(org_figures(screen.container, npo(org))).toEqual([]);
    }
  );

  test.each(SIZES)(
    "Donate and the registration are in view on first load at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount({ messages: [message(1)] });
      const [hero_donate] = donates(main_of(screen.container));
      await expect.poll(() => above_fold(hero_donate)).toBe(true);
      const credential = screen.getByText(EIN, { exact: true });
      await expect.poll(() => in_view(credential.element())).toBe(true);
      expect(credential.element().closest("li")).toHaveTextContent(
        `EIN ${EIN}`
      );
    }
  );

  test.each([
    [1440, 900],
    [375, 812],
  ])(
    "the tallest hero (a long name, the tagline at its limit, a banner) keeps Donate in the first screen at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount(
        { messages: [message(1)] },
        { name: LONG_NAME, tagline: TAGLINE_MAX }
      );
      const [hero_donate] = donates(main_of(screen.container));
      await expect.poll(() => above_fold(hero_donate)).toBe(true);
      await expect
        .poll(() => in_view(screen.getByText(EIN, { exact: true }).element()))
        .toBe(true);
    }
  );

  test("at 1440 the card is centred on the page and no wider than the reading measure", async () => {
    await page.viewport(1440, 900);
    const screen = await mount();
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    const r = card_of(screen.container).getBoundingClientRect();
    expect(r.width).toBeLessThanOrEqual(READING_WIDTH);
    const mid = document.documentElement.clientWidth / 2;
    expect(Math.abs((r.left + r.right) / 2 - mid)).toBeLessThanOrEqual(1);
  });

  test("at 375 the card fills the page between its gutters", async () => {
    await page.viewport(375, 812);
    const screen = await mount();
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    const shape = main_of(screen.container).querySelector(
      ".page"
    ) as HTMLElement;
    const s = getComputedStyle(shape);
    const box = shape.getBoundingClientRect();
    const r = card_of(screen.container).getBoundingClientRect();
    expect(
      Math.abs(r.left - (box.left + Number.parseFloat(s.paddingLeft)))
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(r.right - (box.right - Number.parseFloat(s.paddingRight)))
    ).toBeLessThanOrEqual(1);
  });

  test.each(SIZES)(
    "a short page centres the card in main, and main meets the footer, at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount({}, { image: null, tagline: null });
      await expect
        .element(screen.getByRole("heading", { level: 1 }))
        .toBeVisible();
      const main = main_of(screen.container);
      const m = main.getBoundingClientRect();
      const b = block_of(screen.container).getBoundingClientRect();
      // the fixture is short enough that main is stretched past its content
      expect(m.height).toBeGreaterThan(b.height);
      expect(
        Math.abs((b.top + b.bottom) / 2 - (m.top + m.bottom) / 2)
      ).toBeLessThanOrEqual(2);
      const footer = screen.container.querySelector("footer") as HTMLElement;
      expect(
        Math.abs(footer.getBoundingClientRect().top - m.bottom)
      ).toBeLessThanOrEqual(1);
      // what lies below the block is the centring's half and no more
      expect(
        Math.abs(b.top - m.top - (m.bottom - b.bottom))
      ).toBeLessThanOrEqual(2);
    }
  );

  test("a banner is the card's top strip; no banner, no img", async () => {
    const screen = await mount();
    const card = card_of(screen.container);
    const banner = card.querySelector("img") as HTMLImageElement;
    expect(banner).not.toBeNull();
    expect(card.firstElementChild).toBe(banner);
    await cleanup();

    const none = await mount({}, { image: null });
    await expect.element(none.getByRole("heading", { level: 1 })).toBeVisible();
    expect(none.container.querySelector("main img")).toBeNull();
  });

  test("the tagline shows when there is one, and is absent otherwise", async () => {
    const screen = await mount({}, { tagline: "Every adult a reader." });
    await expect
      .element(screen.getByText("Every adult a reader.", { exact: true }))
      .toBeVisible();
    await cleanup();

    const none = await mount({}, { tagline: "  " });
    const h1 = none.getByRole("heading", { level: 1 });
    await expect.element(h1).toBeVisible();
    // the name is the only line in its group
    expect(h1.element().parentElement?.children).toHaveLength(1);
  });

  test("messages bring the quote strip under the card, and none leave it out", async () => {
    const screen = await mount({ messages: [message(1), message(2)] });
    const strip = screen.getByRole("region", { name: "Donor messages" });
    await expect.element(strip).toBeVisible();
    const card = card_of(screen.container);
    expect(
      card.compareDocumentPosition(strip.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await cleanup();

    const none = await mount();
    await expect.element(none.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      none.getByRole("region", { name: "Donor messages" }).query()
    ).toBeNull();
  });

  test("a list that failed to load keeps its line, between the card and the strip", async () => {
    const screen = await mount({
      failed: { give: false, programs: true, videos: false },
      messages: [message(1)],
    });
    const line = screen.getByText(FAILED_LINE.programs, { exact: true });
    await expect.element(line).toBeVisible();
    expect(screen.getByText(FAILED_LINE.give).query()).toBeNull();
    const strip = screen
      .getByRole("region", { name: "Donor messages" })
      .element();
    const follows = (a: Node, b: Node) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(card_of(screen.container), line.element())).toBe(true);
    expect(follows(line.element(), strip)).toBe(true);
    await cleanup();

    const none = await mount();
    await expect.element(none.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      none.getByRole("heading", { name: "Ways to help" }).query()
    ).toBeNull();
  });

  test("no middle dot anywhere in the rendered page", async () => {
    const screen = await mount({ messages: [message(1)] });
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain("·");
  });

  test.each(SIZES)(
    "nothing is pinned to the screen's bottom edge at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount({ messages: [message(1)] });
      await expect
        .element(screen.getByRole("heading", { level: 1 }))
        .toBeVisible();
      expect(pinned_to_bottom(screen.container)).toEqual([]);
    }
  );

  test.each(SIZES)(
    "the header's Donate waits until the card's has scrolled away at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount({ messages: [message(1)] });
      const root = screen.container;

      const [hero] = donates(main_of(root));
      await expect.poll(() => in_view(hero)).toBe(true);
      expect(header_donate(root)).toBeUndefined();

      scroll_past_hero_donate(root);
      await expect.poll(() => header_donate(root)).toBeDefined();
      await expect.poll(() => header_donate_in_view(root)).toBe(true);

      window.scrollTo(0, 0);
      await expect.poll(() => header_donate(root)).toBeUndefined();
    }
  );
});
