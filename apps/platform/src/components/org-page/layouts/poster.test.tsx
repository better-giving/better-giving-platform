import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import {
  BANNER,
  donates,
  give_panel,
  header_donate,
  imgs_outside_panel,
  panel_banner,
  panel_parts,
  pinned_to_bottom,
  scroll_past_hero_donate,
} from "#/__tests__/fixtures/layout-dom";
import {
  above_fold,
  EIN,
  give,
  header_donate_in_view,
  in_view,
  LONG_NAME,
  many,
  message,
  npo,
  org_figures,
  org_layout,
  program,
  story,
  TAGLINE_MAX,
} from "#/__tests__/fixtures/org-layout";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import type { INpoPublic } from "$/pg/queries/npo";
import { Poster } from "./poster";
import type { IOrgLayout } from "./types";

// the viewer the header's favorite button reads; null is signed out
vi.mock("#/hooks/use-user", () => ({
  use_user: () => ({ user: null, toggle_bookmark: vi.fn() }),
}));

afterEach(async () => {
  await cleanup();
  await reset_viewport();
  window.scrollTo(0, 0);
});

const STORY_AT_MAX =
  "Riverside Literacy puts a trained reading tutor beside every adult learner who asks for one, twice a week, in libraries and church halls across three counties. Last year 212 adults read their first full book with us, and most of them came back the next year to tutor the newcomers who followed them in.";

const follows = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** a short-story org with a banner that loads offline, unless told otherwise */
function mount(o: Partial<IOrgLayout> = {}, n: Partial<INpoPublic> = {}) {
  const props = org_layout({ ...o, npo: npo({ image: BANNER, ...n }) });
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Poster {...props} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("Poster", () => {
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

  test("no middle dot anywhere in the rendered page", async () => {
    await page.viewport(1440, 900);
    const screen = await mount({
      give: [give(1)],
      messages: [message(1), message(2)],
    });
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain("·");
    // the registration is the meta row's last item
    const row = screen.getByText(EIN, { exact: true }).element().closest("ul");
    expect(row?.lastElementChild).toHaveTextContent(`EIN ${EIN}`);
  });

  test.each([
    [1440, 900],
    [375, 812],
  ])(
    "Donate and the registration are in view on first load at %i",
    async (w, h) => {
      await page.viewport(w, h);
      // a story at the short ceiling
      const screen = await mount({}, { overview_pt: story(STORY_AT_MAX) });
      const main = screen.container.querySelector("main") as HTMLElement;
      const [hero_donate] = donates(main);
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
        {},
        {
          name: LONG_NAME,
          tagline: TAGLINE_MAX,
          overview_pt: story(STORY_AT_MAX),
        }
      );
      const [hero_donate] = donates(
        screen.container.querySelector("main") as HTMLElement
      );
      await expect.poll(() => above_fold(hero_donate)).toBe(true);
      await expect
        .poll(() => in_view(screen.getByText(EIN, { exact: true }).element()))
        .toBe(true);
    }
  );

  test("the tagline is the deck under the name, and the short story follows as the lead", async () => {
    const screen = await mount(
      {},
      { tagline: "Every adult a reader.", overview_pt: story(STORY_AT_MAX) }
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    const deck = screen.getByText("Every adult a reader.", { exact: true });
    const lead = screen.getByText(STORY_AT_MAX, { exact: true });
    await expect.element(deck).toBeVisible();
    await expect.element(lead).toBeVisible();
    expect(follows(h1.element(), deck.element())).toBe(true);
    expect(follows(deck.element(), lead.element())).toBe(true);
  });

  test.each([
    [375, 812],
    [1440, 900],
  ])(
    "the give card: the banner on top at 4:1, then Donate across it, at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount();
      const panel = give_panel(screen.container);
      const [donate] = donates(panel);
      await expect.poll(() => in_view(donate)).toBe(true);
      await expect
        .poll(() => panel_banner(panel)?.ratio ?? 0)
        .toBeCloseTo(4, 1);
      expect(panel_banner(panel)?.flush).toBe(true);
      expect(panel_parts(panel)).toEqual(["banner", "donate"]);
      const body = donate.parentElement as HTMLElement;
      const inset = Number.parseFloat(getComputedStyle(body).paddingLeft);
      expect(donate.getBoundingClientRect().width).toBeCloseTo(
        body.getBoundingClientRect().width - 2 * inset,
        0
      );
    }
  );

  test("on the deep band the card is a light surface and Donate is the primary button", async () => {
    const screen = await mount();
    const panel = give_panel(screen.container);
    const [donate] = donates(panel);
    await expect.poll(() => donate.checkVisibility()).toBe(true);
    expect(panel.closest(".bg-primary-deep")).not.toBeNull();
    expect(donate).toHaveClass("btn-primary");
  });

  test("the card's Donate takes the page's focus ring, not the deep band's white one", async () => {
    await page.viewport(1440, 900);
    const screen = await mount();
    const panel = give_panel(screen.container);
    const [donate] = donates(panel);
    await expect.poll(() => donate.checkVisibility()).toBe(true);
    const band = panel.closest(".bg-primary-deep") as HTMLElement;
    const ring = (el: Element) => getComputedStyle(el).outlineColor;
    // the base layer draws every outline in --ring, so the colour a keyboard
    // focus would show is readable at rest
    expect(ring(donate)).toBe(ring(document.body));
    expect(ring(donate)).not.toBe(ring(band));

    await userEvent.keyboard("{Tab}");
    donate.focus();
    await expect.poll(() => donate.matches(":focus-visible")).toBe(true);
    const s = getComputedStyle(donate);
    expect(s.outlineStyle).toBe("solid");
    expect(s.outlineColor).toBe(ring(document.body));
  });

  test.each([
    [375, 812],
    [1440, 900],
  ])(
    "the mark and facts, the name, the tagline, the card and the story read in that order, and the card sits beside them from md, at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount({}, { overview_pt: story(STORY_AT_MAX) });
      const facts = screen
        .getByText(EIN, { exact: true })
        .element()
        .closest("ul") as HTMLElement;
      const h1 = screen.getByRole("heading", { level: 1 }).element();
      const deck = screen
        .getByText("Every adult a reader.", { exact: true })
        .element();
      const panel = give_panel(screen.container);
      const lead = screen.getByText(STORY_AT_MAX, { exact: true }).element();
      await expect.poll(() => lead.checkVisibility()).toBe(true);
      const order = [facts, h1, deck, panel, lead];
      for (const [i, el] of order.entries()) {
        if (i > 0) expect(follows(order[i - 1], el)).toBe(true);
      }
      const top = (el: Element) => el.getBoundingClientRect().top;
      const p = panel.getBoundingClientRect();
      if (w < 768) {
        expect(top(panel)).toBeGreaterThan(deck.getBoundingClientRect().bottom);
        expect(top(lead)).toBeGreaterThan(p.bottom);
      } else {
        for (const el of [facts, h1, deck, lead]) {
          expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(p.left);
        }
        expect(top(lead)).toBeGreaterThan(deck.getBoundingClientRect().bottom);
      }
    }
  );

  test("no registration, no line", async () => {
    const screen = await mount({ credential: null });
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(screen.getByText(EIN).query()).toBeNull();
  });

  test("no items leaves Ways to help out; one is a lone feature card with no navigation", async () => {
    await page.viewport(1440, 900);
    const none = await mount();
    await expect.element(none.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      none.getByRole("heading", { name: "Ways to help" }).query()
    ).toBeNull();
    await cleanup();

    const one = await mount({ give: [give(1)] });
    const section = one.getByRole("region", { name: "Ways to help" });
    await expect.element(section).toBeVisible();
    const lists = section.element().querySelectorAll("ul");
    expect(lists).toHaveLength(1);
    expect((lists[0] as HTMLElement).dataset.count).toBe("1");
    expect(section.element().querySelector("button")).toBeNull();
    await expect
      .element(one.getByRole("heading", { level: 3, name: "Clean water 1" }))
      .toBeVisible();
  });

  test("with no banner there is no img, the deep band leads the page, and the card is Donate alone", async () => {
    const screen = await mount({}, { image: null });
    const h1 = screen.getByRole("heading", { level: 1 });
    await expect.element(h1).toBeVisible();
    expect(screen.container.querySelector("img")).toBeNull();
    const panel = give_panel(screen.container);
    expect(panel_parts(panel)).toEqual(["donate"]);
    const main = screen.container.querySelector("main") as HTMLElement;
    expect(main.firstElementChild).toHaveClass("bg-primary-deep");
    expect(main.firstElementChild).toContainElement(
      h1.element() as HTMLElement
    );
  });

  test("the banner is the give card's top, never a strip across the page", async () => {
    const screen = await mount();
    const panel = give_panel(screen.container);
    await expect.poll(() => panel_banner(panel)?.ratio ?? 0).toBeCloseTo(4, 1);
    expect(imgs_outside_panel(screen.container)).toEqual([]);
    expect(panel.closest(".bg-primary-deep")).not.toBeNull();
  });

  test("a failed list shows what did load with its line under it, and the others still render", async () => {
    const screen = await mount({
      give: [give(1)],
      programs: [program(1)],
      failed: { give: false, programs: true, videos: false },
    });
    await expect
      .element(
        screen.getByText(
          "We couldn't load this nonprofit's programs right now. Please try again later."
        )
      )
      .toBeVisible();
    await expect.element(screen.getByText("Clean water 1")).toBeVisible();
    await expect.element(screen.getByText("School meals 1")).toBeVisible();
  });

  test("messages bring the quote strip, and none leave it out", async () => {
    const screen = await mount({ messages: [message(1), message(2)] });
    const strip = screen.getByRole("region", { name: "Donor messages" });
    await expect.element(strip).toBeVisible();
    await expect
      .element(strip.getByText("Donor 1", { exact: true }))
      .toBeVisible();
    await cleanup();

    const none = await mount();
    await expect.element(none.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      none.getByRole("region", { name: "Donor messages" }).query()
    ).toBeNull();
  });

  test.each([
    [1440, 900],
    [375, 812],
  ])(
    "an org with nothing past the hero: the band meets the footer and centres the hero at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount(
        {},
        { image: null, tagline: null, overview_pt: undefined }
      );
      await expect
        .element(screen.getByRole("heading", { level: 1 }))
        .toBeVisible();
      const main = screen.container.querySelector("main") as HTMLElement;
      const band = main.querySelector(".bg-primary-deep") as HTMLElement;
      const footer = screen.container.querySelector("footer") as HTMLElement;
      const b = band.getBoundingClientRect();
      expect(
        Math.abs(footer.getBoundingClientRect().top - b.bottom)
      ).toBeLessThanOrEqual(1);
      const c = (band.firstElementChild as HTMLElement).getBoundingClientRect();
      expect(
        Math.abs((c.top + c.bottom) / 2 - (b.top + b.bottom) / 2)
      ).toBeLessThanOrEqual(2);
    }
  );

  test.each([
    [1440, 900],
    [375, 812],
  ])(
    "with items past the hero, the band keeps its own height at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount({ give: [give(1)] }, { image: null });
      await expect
        .element(screen.getByRole("region", { name: "Ways to help" }))
        .toBeVisible();
      const band = screen.container.querySelector(
        "main .bg-primary-deep"
      ) as HTMLElement;
      const style = getComputedStyle(band);
      const content = (
        band.firstElementChild as HTMLElement
      ).getBoundingClientRect().height;
      const own =
        content +
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      expect(
        Math.abs(band.getBoundingClientRect().height - own)
      ).toBeLessThanOrEqual(1);
    }
  );

  test("on a phone the header's Donate waits until the card's has scrolled away", async () => {
    await page.viewport(375, 812);
    const screen = await mount({ give: many(give, 3), messages: [message(1)] });
    const root = screen.container;
    const main = root.querySelector("main") as HTMLElement;
    await expect
      .poll(() => donates(main).some((d) => d.checkVisibility() && in_view(d)))
      .toBe(true);
    expect(header_donate(root)).toBeUndefined();
    scroll_past_hero_donate(root);
    await expect.poll(() => header_donate(root)).toBeDefined();
    await expect.poll(() => header_donate_in_view(root)).toBe(true);
  });

  test.each([
    [375, 812],
    [1440, 900],
  ])("nothing is pinned to the screen's bottom edge at %i", async (w, h) => {
    await page.viewport(w, h);
    const screen = await mount({ give: many(give, 3), messages: [message(1)] });
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(pinned_to_bottom(screen.container)).toEqual([]);
  });
});
