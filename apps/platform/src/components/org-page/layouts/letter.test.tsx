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
  give,
  header_donate_in_view,
  in_view,
  LONG_NAME,
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
import { Letter } from "./letter";
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

const LEAD =
  "When Grace Atuhaire started tutoring at the Kasese library in 2014, nine of the thirty adults in her room could read a full sentence. By June, twenty-six could.";
const BODY = [
  "That year became our method. A trained tutor sits beside each learner twice a week, for a whole year, with books in the languages the learners speak at home.",
  "We now work in eleven libraries. Our tutors are hired from the communities they serve, and most of them were once the learners we taught.",
  "Every gift buys tutor hours, books, and the training that keeps both coming. None of it is spent on anything a learner will not touch.",
];

/** a long-story org with a banner that loads offline, unless told otherwise */
function mount(o: Partial<IOrgLayout> = {}, n: Partial<INpoPublic> = {}) {
  const props = org_layout({
    ...o,
    npo: npo({ image: BANNER, overview_pt: story(LEAD, ...BODY), ...n }),
  });
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Letter {...props} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

const root_of = (container: HTMLElement) =>
  container.querySelector("main")?.parentElement as HTMLElement;

describe("Letter", () => {
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
    const screen = await mount({ give: [give(1)], messages: [message(1)] });
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
      const screen = await mount();
      const root = root_of(screen.container);
      await expect.poll(() => donates(root).some(above_fold)).toBe(true);
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
      const screen = await mount({}, { name: LONG_NAME, tagline: TAGLINE_MAX });
      const root = root_of(screen.container);
      await expect.poll(() => donates(root).some(above_fold)).toBe(true);
      await expect
        .poll(() => in_view(screen.getByText(EIN, { exact: true }).element()))
        .toBe(true);
    }
  );

  test.each([
    [375, 812],
    [1440, 900],
  ])(
    "Donate is under the deck at %i, and the header's waits for it to leave",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount();
      const [hero] = donates(
        screen.container.querySelector("article") as HTMLElement
      );
      await expect.poll(() => in_view(hero)).toBe(true);
      expect(header_donate(screen.container)).toBeUndefined();
    }
  );

  test("no registration, no line", async () => {
    const screen = await mount({ credential: null });
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(screen.getByText(EIN).query()).toBeNull();
  });

  test("the deck is the tagline, or the story's first sentence without one", async () => {
    const tagged = await mount({}, { tagline: "Every adult a reader" });
    await expect
      .element(tagged.getByText("Every adult a reader", { exact: true }))
      .toBeVisible();
    await cleanup();

    const untagged = await mount({}, { tagline: null });
    const first =
      "When Grace Atuhaire started tutoring at the Kasese library in 2014, nine of the thirty adults in her room could read a full sentence.";
    await expect
      .element(untagged.getByText(first, { exact: true }))
      .toBeVisible();
  });

  test("a long opening sentence and no tagline: the deck stops at three lines and Donate stays in the first screen at 375", async () => {
    await page.viewport(375, 812);
    const opening =
      "When Grace Atuhaire started tutoring adults at the Kasese public library in the spring of 2014, nine of the thirty grown men and women who came to her evening room twice a week could read a full sentence aloud, and fewer still could write one, so she began with the bus timetable and the medicine label.";
    const screen = await mount(
      {},
      {
        name: LONG_NAME,
        tagline: null,
        overview_pt: story(`${opening} By June, twenty-six could.`, ...BODY),
      }
    );
    const deck = screen.getByText(opening, { exact: true });
    await expect.element(deck).toBeInTheDocument();
    const el = deck.element() as HTMLElement;
    const s = getComputedStyle(el);
    expect(s.webkitLineClamp).toBe("3");
    expect(el.clientHeight / Number.parseFloat(s.lineHeight)).toBeLessThan(3.5);
    const root = root_of(screen.container);
    await expect.poll(() => donates(root).some(above_fold)).toBe(true);
  });

  test("a deck from the story is not read twice, and the story opens without a lead", async () => {
    const screen = await mount({}, { tagline: null });
    const first =
      "When Grace Atuhaire started tutoring at the Kasese library in 2014, nine of the thirty adults in her room could read a full sentence.";
    const deck = screen.getByText(first, { exact: true });
    await expect.element(deck).toBeVisible();
    expect(deck.element()).toHaveAttribute("aria-hidden", "true");
    const lead = screen.getByText(LEAD, { exact: true }).element();
    const next = screen.getByText(BODY[0], { exact: true }).element();
    const look = (el: Element) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, weight: s.fontWeight };
    };
    expect(look(lead)).toEqual(look(next));
  });

  test("the story's first paragraph is the lead, set larger than the rest", async () => {
    const screen = await mount();
    const lead = screen.getByText(LEAD, { exact: true }).element();
    const next = screen.getByText(BODY[0], { exact: true }).element();
    const size = (el: Element) =>
      Number.parseFloat(getComputedStyle(el).fontSize);
    expect(size(lead)).toBeGreaterThan(size(next));
  });

  test("a story that opens on a heading has no lead: the heading and the paragraphs keep their own setting", async () => {
    const heading = {
      _type: "block",
      _key: "h",
      style: "h2",
      markDefs: [],
      children: [{ _type: "span", _key: "hs", text: "Our method", marks: [] }],
    };
    const overview_pt = JSON.stringify([
      heading,
      ...JSON.parse(story(LEAD, ...BODY)),
    ]);
    const screen = await mount({}, { overview_pt });
    const h = screen.getByRole("heading", { level: 2, name: "Our method" });
    await expect.element(h).toBeVisible();
    const first_para = screen.getByText(LEAD, { exact: true }).element();
    const next = screen.getByText(BODY[0], { exact: true }).element();
    const look = (el: Element) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, weight: s.fontWeight };
    };
    // a heading is bold in its own right; only its size would show a lead
    expect(look(h.element()).size).toBe(look(next).size);
    expect(look(first_para)).toEqual(look(next));
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

  test("a banner is a figure in the column; with none there is no img and no figure", async () => {
    const banner = await mount();
    const figure = banner.container.querySelector("article figure");
    await expect.poll(() => figure?.querySelector("img")).not.toBeNull();
    await cleanup();

    const bare = await mount({}, { image: null });
    await expect.element(bare.getByRole("heading", { level: 1 })).toBeVisible();
    expect(bare.container.querySelector("img")).toBeNull();
    expect(bare.container.querySelector("figure")).toBeNull();
  });

  test("a failed list shows what did load with its line under it, or the line alone, and the others still render", async () => {
    const line =
      "We couldn't load this nonprofit's campaigns right now. Please try again later.";
    const partial = await mount({
      give: [give(1)],
      programs: [program(1)],
      failed: { give: true, programs: false, videos: false },
    });
    await expect.element(partial.getByText(line)).toBeVisible();
    await expect.element(partial.getByText("Clean water 1")).toBeVisible();
    await expect.element(partial.getByText("School meals 1")).toBeVisible();
    await cleanup();

    const empty = await mount({
      programs: [program(1)],
      failed: { give: true, programs: false, videos: false },
    });
    await expect.element(empty.getByText(line)).toBeVisible();
    await expect.element(empty.getByText("School meals 1")).toBeVisible();
    expect(empty.getByText("Clean water 1").query()).toBeNull();
  });

  test("messages bring the quote strip after the story, and none leave it out", async () => {
    const screen = await mount({ messages: [message(1)] });
    const strip = screen.getByRole("region", { name: "Donor messages" });
    await expect.element(strip).toBeVisible();
    const last_paragraph = screen.getByText(BODY[2], { exact: true }).element();
    expect(
      last_paragraph.compareDocumentPosition(strip.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await cleanup();

    const none = await mount();
    await expect.element(none.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      none.getByRole("region", { name: "Donor messages" }).query()
    ).toBeNull();
  });

  test("on a phone the header's Donate waits until the hero's has scrolled away", async () => {
    await page.viewport(375, 812);
    const screen = await mount();
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
    const screen = await mount();
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(pinned_to_bottom(screen.container)).toEqual([]);
  });
});
