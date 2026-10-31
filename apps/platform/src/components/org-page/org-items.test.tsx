import type { ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { BANNER } from "#/__tests__/fixtures/layout-dom";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import { GiveCard } from "./give-card";
import type { IGiveItem, IProgramItem, IVideoItem } from "./items";
import { ItemsByCount, ShowMoreGrid } from "./items-by-count";
import { SwipeRow } from "./swipe-row";

/** a square picture, so a slot that isn't 4:1 would show it uncropped */
const SQUARE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="teal"/></svg>'
)}`;

const NOW = Date.parse("2026-10-01T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

afterEach(async () => {
  await cleanup();
  await reset_viewport();
});

function mount(ui: ReactNode) {
  const Stub = createRoutesStub([{ path: "/", Component: () => ui }]);
  return render(<Stub initialEntries={["/"]} />);
}

const give = (n: number, o: Partial<IGiveItem> = {}): IGiveItem => ({
  kind: "campaign",
  id: `give-${n}`,
  title: `Clean water ${n}`,
  to: `/campaigns/${n}`,
  image: null,
  raised: 2400,
  goal: 7900,
  ends_at: null,
  byline: null,
  excerpt:
    "Wells for three villages in the Kasese district before the dry season.",
  ...o,
});

const gives = (n: number) => Array.from({ length: n }, (_, i) => give(i + 1));

const program = (n: number): IProgramItem => ({
  kind: "program",
  id: `program-${n}`,
  title: `School meals ${n}`,
  to: `/programs/${n}`,
  image: null,
  summary: "A hot lunch for every pupil, every school day.",
  goal: null,
  raised: 0,
});

const video = (n: number): IVideoItem => ({
  kind: "video",
  id: `video-${n}`,
  url: `https://www.youtube.com/watch?v=dQw4w9WgXc${n}`,
  title: null,
});

/** the column tracks a list lays out in, from its computed style */
function tracks(el: Element): number {
  return getComputedStyle(el).gridTemplateColumns.split(" ").length;
}

function list_of(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>("[data-count]");
  if (!el) throw new Error("no list rendered");
  return el;
}

describe("GiveCard", () => {
  test("says how long is left and how far it is from its goal", async () => {
    const screen = await mount(
      <div>
        <GiveCard
          show_kind
          now={NOW}
          item={give(1, {
            ends_at: new Date(NOW + 5 * DAY + HOUR).toISOString(),
          })}
        />
        <GiveCard
          show_kind
          now={NOW}
          item={give(2, { ends_at: new Date(NOW + 3 * HOUR).toISOString() })}
        />
        <GiveCard
          show_kind
          now={NOW}
          item={give(3, {
            ends_at: new Date(NOW - HOUR).toISOString(),
            goal: null,
            raised: 540,
            kind: "supporter",
            byline: "by Jane",
          })}
        />
        <GiveCard show_kind now={NOW} item={give(4)} />
        <GiveCard
          show_kind
          now={NOW}
          item={give(5, { raised: 9500, goal: 7900 })}
        />
      </div>
    );
    const card = (n: number) =>
      screen.getByRole("article").filter({ hasText: `Clean water ${n}` });

    await expect.element(card(1)).toMatchTextContent("Ends in 5 days");
    await expect.element(card(2)).toMatchTextContent("Ends today");
    await expect.element(card(3)).not.toMatchTextContent("Ends");
    await expect.element(card(4)).not.toMatchTextContent("Ends");

    // a goal draws the bar and "of"; none says what came in
    await expect
      .element(
        card(1).getByRole("progressbar", {
          name: "Clean water 1: amount raised",
        })
      )
      .toBeVisible();
    await expect.element(card(1)).toMatchTextContent("$2,400 of $7,900");
    const bar = card(1).getByRole("progressbar").element();
    expect(bar.getAttribute("aria-valuenow")).toBe("2400");
    expect(bar.getAttribute("aria-valuemax")).toBe("7900");
    // the line states the sum, never a percent
    await expect.element(card(1)).not.toMatchTextContent("%");
    // past its goal the bar reads full, not over
    const over = card(5).getByRole("progressbar").element();
    expect(over.getAttribute("aria-valuenow")).toBe("7900");
    await expect.element(card(5)).toMatchTextContent("$9,500 of $7,900");
    expect(card(3).getByRole("progressbar").query()).toBeNull();
    await expect.element(card(3)).toMatchTextContent("$540 raised");
    await expect.element(card(3)).toMatchTextContent("Supporter campaign");
    await expect.element(card(3)).toMatchTextContent("by Jane");

    // the title is the card's only link
    expect(card(1).getByRole("link").elements()).toHaveLength(1);
  });
});

describe("card image", () => {
  test.each([
    [1440, 900],
    [375, 812],
  ])(
    "every card's image slot is 4:1 and the image fills it, at %i wide",
    async (width, height) => {
      await page.viewport(width, height);
      const pictured = <T extends { image: string | null }>(x: T) => ({
        ...x,
        image: SQUARE,
      });
      // one is the feature card, two are halves, three are thirds; then a
      // lone program, three programs and a swipe row of four campaigns
      const lists = [1, 2, 3].map((n) => gives(n).map(pictured));
      const screen = await mount(
        <div>
          {lists.map((items) => (
            <ItemsByCount key={items.length} items={items} now={NOW} />
          ))}
          <ItemsByCount items={[pictured(program(1))]} now={NOW} />
          <ItemsByCount
            items={[4, 5, 6].map((n) => pictured(program(n)))}
            now={NOW}
          />
          <SwipeRow
            heading="Campaigns"
            items={gives(4).map(pictured)}
            now={NOW}
          />
        </div>
      );
      await expect
        .element(screen.getByRole("link", { name: "School meals 1" }))
        .toBeVisible();

      const cards = Array.from(
        screen.container.querySelectorAll<HTMLElement>("article")
      );
      expect(cards).toHaveLength(14);
      for (const card of cards) {
        const slot = (
          card.firstElementChild as HTMLElement
        ).getBoundingClientRect();
        const box = card.getBoundingClientRect();
        expect(Math.abs(slot.width / slot.height - 4) / 4).toBeLessThan(0.01);
        // across the top of the card, edge to edge, at every count: the
        // feature card, the halves, the thirds and the program alike
        expect(slot.top).toBeCloseTo(box.top, 0);
        expect(slot.width).toBeCloseTo(card.clientWidth, 0);
        const img = card.querySelector("img") as HTMLImageElement;
        await expect.poll(() => img.complete).toBe(true);
        const shown = img.getBoundingClientRect();
        expect(shown.width).toBeCloseTo(slot.width, 0);
        expect(shown.height).toBeCloseTo(slot.height, 0);
        // a square picture in a 4:1 slot fills it by cropping, not squeezing
        expect(getComputedStyle(img).objectFit).toBe("cover");
      }
    }
  );

  test("neighbouring cards end on one line, with or without an end date, and the bar spans the text column", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      <ItemsByCount
        items={[
          give(1, { ends_at: new Date(NOW + 5 * DAY).toISOString() }),
          give(2),
        ]}
        now={NOW}
      />
    );
    const bars = screen.getByRole("progressbar").elements();
    expect(bars).toHaveLength(2);
    const [a, b] = bars.map((x) => x.getBoundingClientRect());
    expect(a.top).toBeCloseTo(b.top, 0);
    // track → GoalBar root → the figures block → the text column
    const column = bars[0].parentElement?.parentElement
      ?.parentElement as HTMLElement;
    const inner = column.getBoundingClientRect().width - 32; // p-4 either side
    expect(a.width).toBeCloseTo(inner, 0);
  });

  test("a card with no goal has no bar and no band where one would be, beside cards that have one", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      <ItemsByCount
        items={[
          give(1, { ends_at: new Date(NOW + 5 * DAY).toISOString() }),
          give(2),
          give(3, { goal: null }),
        ]}
        now={NOW}
      />
    );
    const card = screen
      .getByRole("article")
      .filter({ hasText: "Clean water 3" });
    await expect.element(card).toMatchTextContent("$2,400 raised");
    expect(card.getByRole("progressbar").query()).toBeNull();
    // the raised line follows the title at the column's gap
    const title = card.getByRole("heading").element();
    const raised = card.getByText("$2,400 raised").element();
    const gap = Number.parseFloat(
      getComputedStyle(title.parentElement as HTMLElement).rowGap
    );
    expect(
      raised.getBoundingClientRect().top - title.getBoundingClientRect().bottom
    ).toBeCloseTo(gap, 0);
    // the cards in the row still share a bottom edge
    const boxes = screen
      .getByRole("article")
      .elements()
      .map((a) => a.getBoundingClientRect().bottom);
    expect(new Set(boxes).size).toBe(1);
  });

  test("a program card on a phone has its image across the top and the title on at most two lines", async () => {
    await page.viewport(375, 812);
    const screen = await mount(
      <ItemsByCount
        items={[
          {
            ...program(1),
            image: BANNER,
            title: "After-school reading clubs for every primary pupil",
          },
        ]}
        now={NOW}
      />
    );
    const link = screen.getByRole("link", { name: /After-school reading/ });
    await expect.element(link).toBeVisible();
    const card = link.element().closest("article") as HTMLElement;
    const slot = (
      card.firstElementChild as HTMLElement
    ).getBoundingClientRect();
    const title = card.querySelector("h3") as HTMLElement;
    const text = (title.parentElement as HTMLElement).getBoundingClientRect();
    expect(slot.width).toBeCloseTo(card.clientWidth, 0);
    expect(Math.abs(slot.width / slot.height - 4) / 4).toBeLessThan(0.01);
    expect(text.top).toBeGreaterThanOrEqual(slot.bottom - 0.5);
    const lines =
      title.getBoundingClientRect().height /
      Number.parseFloat(getComputedStyle(title).lineHeight);
    expect(Math.round(lines)).toBeLessThanOrEqual(2);
  });

  test("the feature card's excerpt shows on a phone too", async () => {
    await page.viewport(375, 812);
    const screen = await mount(<ItemsByCount items={gives(1)} now={NOW} />);
    await expect
      .element(screen.getByText("Wells for three villages"))
      .toBeVisible();
  });

  test("rows: one card per line, campaigns and programs alike", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      <div style={{ width: 768 }}>
        <ItemsByCount
          items={[
            ...gives(2),
            { ...program(1), goal: 900 },
            program(2),
            program(3),
          ]}
          now={NOW}
          rows
        />
      </div>
    );
    const lists = screen.container.querySelectorAll("[data-count]");
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(tracks(list)).toBe(1);
    const titles = Array.from(screen.container.querySelectorAll("h3"));
    expect(titles).toHaveLength(5);
    const sizes = titles.map((h) => getComputedStyle(h).fontSize);
    expect(new Set(sizes).size).toBe(1);
    const insets = titles.map(
      (h) => getComputedStyle(h.parentElement as HTMLElement).padding
    );
    expect(new Set(insets).size).toBe(1);
    // a lone program or campaign in a row keeps the normal title size: only a
    // lone item in the count grid is a feature card
    await cleanup();
    const lone = await mount(
      <div style={{ width: 768 }}>
        <ItemsByCount items={[give(1), program(1)]} now={NOW} rows />
      </div>
    );
    const lone_lists = lone.container.querySelectorAll("[data-count]");
    expect(lone_lists).toHaveLength(2);
    for (const list of lone_lists)
      expect(list.getAttribute("data-count")).toBe("1");
    const lone_sizes = Array.from(lone.container.querySelectorAll("h3")).map(
      (h) => getComputedStyle(h).fontSize
    );
    expect(lone_sizes).toEqual([sizes[0], sizes[0]]);
  });
});

describe("ItemsByCount", () => {
  test("1, 2 and 3 items take a feature card, halves and thirds; none renders nothing", async () => {
    await page.viewport(1440, 900);

    const none = await mount(<ItemsByCount items={[]} now={NOW} />);
    expect(none.container.querySelector("[data-count]")).toBeNull();
    expect(none.container.querySelector("article")).toBeNull();
    await cleanup();

    const one = await mount(<ItemsByCount items={gives(1)} now={NOW} />);
    const feature = list_of(one.container);
    expect(feature.dataset.count).toBe("1");
    expect(tracks(feature)).toBe(1);
    await expect
      .element(one.getByText("Wells for three villages"))
      .toBeVisible();
    await cleanup();

    const two = await mount(<ItemsByCount items={gives(2)} now={NOW} />);
    expect(tracks(list_of(two.container))).toBe(2);
    // the excerpt is the feature card's alone
    expect(two.getByText("Wells for three villages").query()).toBeNull();
    await cleanup();

    const three = await mount(<ItemsByCount items={gives(3)} now={NOW} />);
    expect(tracks(list_of(three.container))).toBe(3);
  });

  test("a phone stacks every count", async () => {
    await page.viewport(375, 812);
    const screen = await mount(<ItemsByCount items={gives(3)} now={NOW} />);
    expect(tracks(list_of(screen.container))).toBe(1);
  });

  test("programs take the count grid: one across the row, then halves, then thirds", async () => {
    await page.viewport(1440, 900);
    const one = await mount(<ItemsByCount items={[program(1)]} now={NOW} />);
    const list = list_of(one.container);
    expect(tracks(list)).toBe(1);
    const card = list.querySelector("article") as HTMLElement;
    expect(card.getBoundingClientRect().width).toBeCloseTo(
      list.getBoundingClientRect().width,
      0
    );
    await expect
      .element(one.getByRole("link", { name: "School meals 1" }))
      .toBeVisible();
    await cleanup();

    const two = await mount(
      <ItemsByCount items={[program(1), program(2)]} now={NOW} />
    );
    expect(tracks(list_of(two.container))).toBe(2);
    const halves = two
      .getByRole("article")
      .elements()
      .map((a) => a.getBoundingClientRect());
    expect(halves[0].top).toBeCloseTo(halves[1].top, 0);
    expect(halves[1].left).toBeGreaterThan(halves[0].right - 1);
    await cleanup();

    const four = await mount(
      <ItemsByCount items={[1, 2, 3, 4].map((n) => program(n))} now={NOW} />
    );
    expect(tracks(list_of(four.container))).toBe(3);
    // every program shows; there is no reveal
    await expect
      .element(four.getByRole("link", { name: "School meals 4" }))
      .toBeVisible();
    expect(four.getByRole("button").query()).toBeNull();
  });

  test("programs in halves anchor their progress to the card's bottom, whatever the summary", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      <ItemsByCount
        items={[
          { ...program(1), goal: 5000, raised: 1200, summary: "" },
          {
            ...program(2),
            goal: 900,
            raised: 300,
            summary:
              "Breakfast and a hot lunch for every pupil in four district schools, every school day of the year, cooked by parents on site from local produce bought at the weekly market.",
          },
        ]}
        now={NOW}
      />
    );
    const bars = screen.getByRole("progressbar").elements();
    expect(bars).toHaveLength(2);
    const [a, b] = bars.map((x) => x.getBoundingClientRect());
    expect(a.top).toBeCloseTo(b.top, 0);
    // the figures' line sits on the column's bottom padding (a card has no
    // edge);
    // the articles' own bottoms match whatever happens, the grid stretches them
    const edge = 16; // p-4 below the column
    const articles = screen.getByRole("article").elements();
    expect(articles).toHaveLength(2);
    for (const [i, figures] of ["$1,200 of $5,000", "$300 of $900"].entries()) {
      const line = screen.getByText(figures).element();
      expect(articles[i].getBoundingClientRect().bottom).toBeCloseTo(
        line.getBoundingClientRect().bottom + edge,
        0
      );
    }
  });

  test("a lone program is a feature card: its title is larger than a program's in a pair", async () => {
    await page.viewport(1440, 900);
    const size = (container: HTMLElement) =>
      Number.parseFloat(
        getComputedStyle(container.querySelector("h3") as HTMLElement).fontSize
      );
    const one = await mount(<ItemsByCount items={[program(1)]} now={NOW} />);
    const lone = size(one.container);
    await cleanup();
    const two = await mount(
      <ItemsByCount items={[program(1), program(2)]} now={NOW} />
    );
    expect(lone).toBeGreaterThan(size(two.container));
  });

  test("a program's chevron sits in the card's bottom-right corner, clear of its figures", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      <ItemsByCount
        items={[
          { ...program(1), goal: 5000, raised: 1200 },
          { ...program(2), goal: 900, raised: 300 },
        ]}
        now={NOW}
      />
    );
    const card = screen
      .getByRole("article")
      .filter({ hasText: "School meals 1" })
      .element();
    card.scrollIntoView({ block: "center" });
    const box = card.getBoundingClientRect();
    const chevron = (
      card.querySelector("svg.lucide-chevron-right") as Element
    ).getBoundingClientRect();
    expect(chevron.right).toBeLessThanOrEqual(box.right);
    expect(chevron.bottom).toBeLessThanOrEqual(box.bottom);
    expect(chevron.left).toBeGreaterThan(box.left + box.width / 2);
    expect(chevron.top).toBeGreaterThan(box.top + box.height / 2);
    // the figures' own text, not their block, which spans the column
    const figures = page
      .elementLocator(card)
      .getByText("$1,200 of $5,000")
      .element();
    const range = document.createRange();
    range.selectNodeContents(figures);
    const text = range.getBoundingClientRect();
    const overlaps =
      text.left < chevron.right &&
      chevron.left < text.right &&
      text.top < chevron.bottom &&
      chevron.top < text.bottom;
    expect(overlaps).toBe(false);
    // the text column spans the card, as a campaign's does
    const bar = card.querySelector('[role="progressbar"]') as Element;
    expect(bar.getBoundingClientRect().width).toBeCloseTo(
      card.clientWidth - 32,
      0
    ); // p-4 either side, inside the border
    // the title's stretched link covers the card, chevron included
    const hit = document.elementFromPoint(
      (chevron.left + chevron.right) / 2,
      (chevron.top + chevron.bottom) / 2
    );
    expect(hit).not.toBeNull();
    expect(hit?.closest("a")?.textContent).toBe("School meals 1");
  });

  test.each([
    { layout: "a lone feature card at 1440", width: 1440, n: 1 },
    { layout: "halves at 1440", width: 1440, n: 2 },
    { layout: "thirds at 1440", width: 1440, n: 3 },
    { layout: "a phone's stack at 375", width: 375, n: 2 },
  ])(
    "without a goal, a program's title and clamped summary stay clear of its chevron: $layout",
    async ({ width, n }) => {
      await page.viewport(width, 900);
      const goalless = (i: number): IProgramItem => ({
        ...program(i),
        title: `School meals and a weekly take-home ration for every pupil in the district ${i}`,
        summary:
          "Breakfast and a hot lunch for every pupil in four district schools, every school day of the year, cooked by parents on site from local produce bought at the weekly market, with a take-home ration on Fridays for the pupils whose families need it most. In the holidays the kitchens stay open three mornings a week, and the parents who cook are paid a stipend that the programme reviews each term with the school boards and the district health office. Every kitchen keeps a log of what it served and to how many pupils, and the logs are published at the end of each term so that donors, parents and teachers can see where each shilling went.",
      });
      const screen = await mount(
        <ItemsByCount
          items={Array.from({ length: n }, (_, i) => goalless(i + 1))}
          now={NOW}
        />
      );
      for (const card of screen.getByRole("article").elements()) {
        const chevron = (
          card.querySelector("svg.lucide-chevron-right") as Element
        ).getBoundingClientRect();
        const summary = card.querySelector("h3 + p") as HTMLElement;
        // it clamps: the summary's text runs past the lines it shows
        expect(summary.scrollHeight).toBeGreaterThan(summary.clientHeight);
        const title = card.querySelector("h3 a") as Element;
        // the text's own ranges, not their blocks, which span the column
        for (const el of [title, summary]) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const text = range.getBoundingClientRect();
          const overlaps =
            text.left < chevron.right &&
            chevron.left < text.right &&
            text.top < chevron.bottom &&
            chevron.top < text.bottom;
          expect(overlaps, el.textContent ?? "").toBe(false);
        }
      }
    }
  );

  test("videos: one full, two halves, three as one large over two", async () => {
    await page.viewport(1440, 900);

    const one = await mount(<ItemsByCount items={[video(1)]} now={NOW} />);
    expect(tracks(list_of(one.container))).toBe(1);
    await cleanup();

    const two = await mount(
      <ItemsByCount items={[video(1), video(2)]} now={NOW} />
    );
    expect(tracks(list_of(two.container))).toBe(2);
    await cleanup();

    const three = await mount(
      <ItemsByCount items={[video(1), video(2), video(3)]} now={NOW} />
    );
    const set = list_of(three.container);
    expect(set.dataset.count).toBe("3");
    expect(tracks(set)).toBe(1);
    const small = set.lastElementChild as HTMLElement;
    expect(tracks(small)).toBe(2);
    // untitled frames are still told apart
    expect(
      three.container.querySelector('iframe[title="Video 3 of 3"]')
    ).not.toBeNull();
  });

  test('4+ shows the first 3 and "See all N" brings in the rest', async () => {
    await page.viewport(1440, 900);
    const screen = await mount(<ItemsByCount items={gives(5)} now={NOW} />);
    const link = (n: number) =>
      screen.getByRole("link", { name: `Clean water ${n}`, exact: true });

    await expect.element(link(3)).toBeVisible();
    expect(link(4).query()).toBeNull();
    await screen.getByRole("button", { name: "See all 5" }).click();

    await expect.element(link(5)).toBeVisible();
    await expect.element(link(4)).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "See all 5" }).query()
    ).toBeNull();
  });
});

describe("ShowMoreGrid", () => {
  test('shows 6 in three columns, then the rest on "Show N more"', async () => {
    await page.viewport(1440, 900);
    const screen = await mount(<ShowMoreGrid items={gives(8)} now={NOW} />);
    const link = (n: number) =>
      screen.getByRole("link", { name: `Clean water ${n}`, exact: true });

    expect(tracks(list_of(screen.container))).toBe(3);
    await expect.element(link(6)).toBeVisible();
    expect(link(7).query()).toBeNull();

    await screen.getByRole("button", { name: "Show 2 more" }).click();
    await expect.element(link(8)).toBeVisible();
    await expect.element(link(7)).toHaveFocus();
    expect(screen.getByRole("button", { name: /more/ }).query()).toBeNull();
  });

  test('programs take the same grid: 8 in thirds, 6 shown, the rest on "Show 2 more"', async () => {
    await page.viewport(1440, 900);
    const programs = Array.from({ length: 8 }, (_, i) => program(i + 1));
    const screen = await mount(<ShowMoreGrid items={programs} now={NOW} />);
    const link = (n: number) =>
      screen.getByRole("link", { name: `School meals ${n}`, exact: true });

    expect(tracks(list_of(screen.container))).toBe(3);
    await expect.element(link(6)).toBeVisible();
    expect(link(7).query()).toBeNull();

    await screen.getByRole("button", { name: "Show 2 more" }).click();
    await expect.element(link(8)).toBeVisible();
    await expect.element(link(7)).toHaveFocus();
    expect(screen.getByRole("button", { name: /more/ }).query()).toBeNull();
  });

  test("a reveal rises in only what it brought, the first at no delay", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(<ShowMoreGrid items={gives(8)} now={NOW} />);
    await screen.getByRole("button", { name: "Show 2 more" }).click();
    await expect
      .element(screen.getByRole("link", { name: "Clean water 8", exact: true }))
      .toBeVisible();

    const items = [...list_of(screen.container).children] as HTMLElement[];
    const rises = items.map((li) => /\bstarting:/.test(li.className));
    expect(rises).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    // what was there before the press carries no delay either
    expect(items.slice(0, 6).map((li) => li.style.transitionDelay)).toEqual(
      Array(6).fill("")
    );
    expect(items[6].style.transitionDelay).toContain("* 0 /");
    expect(items[7].style.transitionDelay).toContain("* 1 /");
  });

  test("a phone shows 3 first", async () => {
    await page.viewport(375, 812);
    const screen = await mount(<ShowMoreGrid items={gives(8)} now={NOW} />);
    const link = (n: number) =>
      screen.getByRole("link", { name: `Clean water ${n}`, exact: true });

    await expect.element(link(3)).toBeVisible();
    expect(link(4).query()).toBeNull();
    await screen.getByRole("button", { name: "Show 5 more" }).click();
    await expect.element(link(8)).toBeVisible();
    await expect.element(link(4)).toHaveFocus();
  });
});

describe("kind line", () => {
  const KIND_LINE = /^(Campaign|Supporter campaign|Program)$/;
  const kind_lines = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("article p")).filter((p) =>
      KIND_LINE.test(p.textContent ?? "")
    );

  test("a grid names each card's kind only when it mixes kinds", async () => {
    await page.viewport(1440, 900);
    const mixed = await mount(
      <ItemsByCount
        items={[give(1), give(2, { kind: "supporter" }), program(1)]}
        now={NOW}
      />
    );
    await expect
      .element(mixed.getByText("Supporter campaign", { exact: true }))
      .toBeVisible();
    await expect
      .element(mixed.getByText("Program", { exact: true }))
      .toBeVisible();
    expect(kind_lines(mixed.container)).toHaveLength(3);
    await cleanup();

    // a tab of campaigns, under a heading that already says so
    const single = await mount(<ShowMoreGrid items={gives(4)} now={NOW} />);
    await expect
      .element(single.getByRole("link", { name: "Clean water 4" }))
      .toBeVisible();
    expect(kind_lines(single.container)).toHaveLength(0);
    await cleanup();

    // programs beside a video: a mixed list, so each program is named
    const programs = await mount(
      <ItemsByCount items={[program(1), program(2), video(1)]} now={NOW} />
    );
    await expect
      .element(programs.getByRole("link", { name: "School meals 2" }))
      .toBeVisible();
    expect(kind_lines(programs.container)).toHaveLength(2);
  });

  test("a swipe row names each card's kind only when it mixes kinds", async () => {
    await page.viewport(1440, 900);
    const single = await mount(
      <SwipeRow heading="Campaigns" items={gives(4)} now={NOW} />
    );
    await expect
      .element(single.getByRole("link", { name: "Clean water 4" }))
      .toBeInTheDocument();
    expect(kind_lines(single.container)).toHaveLength(0);
    await cleanup();

    const mixed = await mount(
      <SwipeRow
        heading="Campaigns"
        items={[...gives(3), give(4, { kind: "supporter" })]}
        now={NOW}
      />
    );
    await expect
      .element(mixed.getByText("Supporter campaign", { exact: true }))
      .toBeInTheDocument();
    expect(kind_lines(mixed.container)).toHaveLength(4);
  });
});

describe("SwipeRow", () => {
  test('scrolls by keyboard, cuts off its last card, and "See all N" opens it into a grid', async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      <SwipeRow heading="Campaigns" items={gives(5)} now={NOW} />
    );
    const region = screen.getByRole("region", {
      name: "Campaigns",
    });
    const toggle = screen.getByRole("button", { name: "See all 5" });

    await expect.element(region).toHaveAttribute("tabindex", "0");
    const row = region.element() as HTMLElement;
    expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    const shown = screen.getByRole("button", { name: "Show fewer" });
    await expect.element(shown).toHaveAttribute("aria-expanded", "true");
    expect(region.query()).toBeNull();
    const grid = list_of(screen.container);
    expect(grid.id).toBe(shown.element().getAttribute("aria-controls"));
    expect(tracks(grid)).toBe(3);
    await expect
      .element(screen.getByRole("link", { name: "Clean water 5" }))
      .toBeVisible();

    await shown.click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    await expect.element(region).toBeVisible();
  });

  test('"See all" rises in only the cards that were not already in view', async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      <SwipeRow heading="Campaigns" items={gives(5)} now={NOW} />
    );
    const row = screen.getByRole("region", { name: "Campaigns" });
    await expect.element(row).toBeVisible();
    await screen.getByRole("button", { name: "See all 5" }).click();
    await expect
      .element(screen.getByRole("link", { name: "Clean water 5" }))
      .toBeVisible();

    const items = [...list_of(screen.container).children] as HTMLElement[];
    const rises = items.map((li) => /\bstarting:/.test(li.className));
    // three whole cards show in the row at this width; the fourth is cut off
    expect(rises).toEqual([false, false, false, true, true]);
    // the stagger counts from the first card that rises
    expect(items[3].style.transitionDelay).toContain("* 0 /");
    expect(items[4].style.transitionDelay).toContain("* 1 /");
  });
});
