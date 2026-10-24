import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
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
  fundraiser,
  give,
  header_donate_in_view,
  in_view,
  LONG_NAME,
  many,
  npo,
  org_figures,
  org_layout,
  program,
  story,
  TAGLINE_MAX,
  video,
} from "#/__tests__/fixtures/org-layout";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import { STORY_CLAMP } from "@/org-shape";
import { Feature } from "./feature";
import type { IOrgLayout } from "./types";

// the viewer the header's favorite button reads; null is signed out
vi.mock("#/hooks/use-user", () => ({
  use_user: () => ({ user: null, toggle_bookmark: vi.fn() }),
}));

afterEach(async () => {
  await cleanup();
  window.scrollTo(0, 0);
  await reset_viewport();
});

const PARA =
  "We run evening classes in libraries and church halls across the county, where volunteer tutors meet adult learners one to one, week after week, until they can read a bus timetable, a medicine label or a bedtime story. ";

/** paragraphs enough to pass `chars` characters */
const story_of = (chars: number) =>
  story(...many(() => PARA, Math.ceil(chars / PARA.length)));

/** a paragraph whose words `link` are a link to `href` */
const linked = (key: string, link: string, href: string) => ({
  _type: "block",
  _key: key,
  style: "normal",
  markDefs: [{ _type: "link", _key: `${key}-l`, href }],
  children: [
    { _type: "span", _key: `${key}-a`, text: "Read ", marks: [] },
    { _type: "span", _key: `${key}-b`, text: link, marks: [`${key}-l`] },
    { _type: "span", _key: `${key}-c`, text: `. ${PARA}`, marks: [] },
  ],
});

/** a story past the clamp with a link in its first and in its last paragraph */
const linked_story = () =>
  JSON.stringify([
    linked("first", "our first report", "https://example.org/first"),
    ...JSON.parse(story_of(STORY_CLAMP + 400)),
    linked("last", "the annual report", "https://example.org/annual"),
  ]);

function mount(o: Partial<IOrgLayout> = {}) {
  const props = org_layout({
    npo: npo({ overview_pt: story_of(STORY_CLAMP + 400) }),
    give: many(give, 4),
    programs: many(program, 2),
    ...o,
  });
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Feature {...props} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("Feature", () => {
  test.each([3322, 0])(
    "shows none of the org's figures, with %i raised and a goal stored",
    async (raised) => {
      const org = npo({
        overview_pt: story_of(STORY_CLAMP + 400),
        contributions_total: raised,
        target: "8000",
      });
      const screen = await mount({ npo: org, give: [], programs: [] });
      await expect
        .element(screen.getByRole("heading", { level: 1 }))
        .toBeVisible();
      expect(org_figures(screen.container, org)).toEqual([]);
    }
  );

  test("no middle dot anywhere in the rendered page", async () => {
    await page.viewport(1440, 900);
    const screen = await mount();
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
    "Donate and the registration are in view on first load at %i wide",
    async (width, height) => {
      await page.viewport(width, height);
      const screen = await mount();
      const donates = screen.getByRole("link", { name: "Donate", exact: true });
      await expect.element(donates.first()).toBeInTheDocument();
      await expect.poll(() => donates.elements().some(above_fold)).toBe(true);
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
      const screen = await mount({
        npo: npo({
          name: LONG_NAME,
          tagline: TAGLINE_MAX,
          image: BANNER,
          overview_pt: story_of(STORY_CLAMP + 400),
        }),
      });
      const donates = screen.getByRole("link", { name: "Donate", exact: true });
      await expect.element(donates.first()).toBeInTheDocument();
      await expect.poll(() => donates.elements().some(above_fold)).toBe(true);
      await expect
        .poll(() => in_view(screen.getByText(EIN, { exact: true }).element()))
        .toBe(true);
    }
  );

  test("no registration, no line", async () => {
    const screen = await mount({ credential: null });
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(screen.getByText(EIN).query()).toBeNull();
  });

  test.each([
    [1440, 900],
    [375, 812],
  ])(
    "a story past the clamp fades out, its hidden links out of reach, and opens in place at %i wide",
    async (width, height) => {
      await page.viewport(width, height);
      const screen = await mount({ npo: npo({ overview_pt: linked_story() }) });
      const more = screen.getByRole("button", { name: "Read the full story" });
      await expect.element(more).toHaveAttribute("aria-expanded", "false");
      const body = document.getElementById(
        more.element().getAttribute("aria-controls") as string
      ) as HTMLElement;
      const box = body.getBoundingClientRect();
      expect(body.scrollHeight).toBeGreaterThan(box.height);

      // the cut fades into the ground, and the button follows it with no gap
      const fade = body.querySelector<HTMLElement>(":scope > [aria-hidden]");
      expect(fade).not.toBeNull();
      const faded = (fade as HTMLElement).getBoundingClientRect();
      expect(faded.bottom).toBeCloseTo(box.bottom, 0);
      expect(faded.height).toBeGreaterThan(0);
      expect(getComputedStyle(fade as HTMLElement).backgroundImage).toMatch(
        /gradient/
      );
      expect(more.element().getBoundingClientRect().top).toBeCloseTo(
        box.bottom,
        0
      );
      // the cut lands on a whole line of the paragraph it falls in
      const paras = Array.from(body.querySelectorAll("p")).filter((p) => {
        const r = p.getBoundingClientRect();
        return r.height > 0 && r.top < box.bottom;
      });
      const cut_in = paras[paras.length - 1];
      const line = Number.parseFloat(getComputedStyle(cut_in).lineHeight);
      const lines = (box.bottom - cut_in.getBoundingClientRect().top) / line;
      expect(lines).toBeGreaterThanOrEqual(1);
      expect(Math.abs(lines - Math.round(lines))).toBeLessThan(0.05);

      // the link in view takes focus; the one cut off does not until opened
      const first = screen
        .getByRole("link", { name: "our first report" })
        .element() as HTMLElement;
      const last = body.querySelector<HTMLElement>(
        'a[href="https://example.org/annual"]'
      ) as HTMLElement;
      await vi.waitFor(() => expect(last.inert).toBe(true));
      first.focus();
      expect(document.activeElement).toBe(first);
      last.focus();
      expect(document.activeElement).not.toBe(last);

      await more.click();
      await expect
        .element(screen.getByRole("button", { name: "Show less" }))
        .toHaveAttribute("aria-expanded", "true");
      // it grows open and the fade dissolves, both over a transition
      await vi.waitFor(() => {
        expect(body.getBoundingClientRect().height).toBeGreaterThan(box.height);
        expect(getComputedStyle(fade as HTMLElement).opacity).toBe("0");
      });
      await expect
        .element(screen.getByRole("link", { name: "the annual report" }))
        .toBeVisible();
      last.focus();
      expect(document.activeElement).toBe(last);
    }
  );

  test("the hero is the tint with the facts, the name and the lead line: no mark, no Donate, no banner across the page", async () => {
    await page.viewport(1440, 900);
    const screen = await mount();
    const name = screen.getByRole("heading", { level: 1 });
    await expect.element(name).toBeVisible();
    const band = (name.element() as HTMLElement).closest(
      ".bg-band"
    ) as HTMLElement;
    expect(band).not.toBeNull();
    expect(band.querySelector("[data-monogram], img")).toBeNull();
    expect(donates(band)).toEqual([]);
    expect(imgs_outside_panel(screen.container)).toEqual([]);
    const panel = give_panel(screen.container);
    await expect.poll(() => panel_banner(panel)?.ratio ?? 0).toBeCloseTo(4, 1);
    expect(panel_banner(panel)?.flush).toBe(true);
    expect(panel_parts(panel)).toEqual(["banner", "donate"]);
    // one Donate in main: the card's
    expect(
      donates(screen.container.querySelector("main") as HTMLElement)
    ).toHaveLength(1);
  });

  test("with no banner the give card is Donate alone", async () => {
    const screen = await mount({
      npo: npo({ image: null, overview_pt: story_of(STORY_CLAMP + 400) }),
    });
    const panel = give_panel(screen.container);
    await expect.poll(() => panel.checkVisibility()).toBe(true);
    expect(panel_parts(panel)).toEqual(["donate"]);
  });

  test("the give card rises into the hero from its top, beside the story, and sticks while the story scrolls", async () => {
    await page.viewport(1440, 900);
    const screen = await mount();
    const panel = give_panel(screen.container);
    await expect.poll(() => panel.checkVisibility()).toBe(true);
    const rem = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize
    );
    expect(getComputedStyle(panel).position).toBe("sticky");
    const p = panel.getBoundingClientRect();
    expect(p.width).toBeGreaterThanOrEqual(19 * rem);
    // over the band's bottom edge, its top level with the facts row's
    const band = screen.container.querySelector("main .bg-band") as HTMLElement;
    const b = band.getBoundingClientRect();
    expect(p.top).toBeLessThan(b.bottom);
    expect(p.bottom).toBeGreaterThan(b.bottom);
    const facts = screen
      .getByText(EIN, { exact: true })
      .element()
      .closest("ul") as HTMLElement;
    expect(Math.abs(p.top - facts.getBoundingClientRect().top)).toBeLessThan(4);
    const story = screen
      .getByRole("heading", { name: "Our story" })
      .element()
      .closest("section") as HTMLElement;
    expect(story.getBoundingClientRect().right).toBeLessThanOrEqual(p.left);

    // halfway down the story the card is still on screen
    const s = story.getBoundingClientRect();
    window.scrollTo(0, s.top + window.scrollY + s.height / 2 - 200);
    await expect.poll(() => in_view(panel)).toBe(true);
  });

  test("on a phone the card sits in the flow, after the lead line and before the section links and the story", async () => {
    await page.viewport(375, 812);
    const screen = await mount();
    const panel = give_panel(screen.container);
    await expect.poll(() => panel.checkVisibility()).toBe(true);
    expect(getComputedStyle(panel).position).toBe("static");
    const band = screen.container.querySelector("main .bg-band") as HTMLElement;
    const lead = band.querySelector("p") as HTMLElement;
    const strip = screen
      .getByRole("navigation", { name: "Sections" })
      .element();
    const story = screen.getByRole("heading", { name: "Our story" }).element();
    const order = [lead, panel, strip, story];
    for (const [i, el] of order.entries()) {
      if (i === 0) continue;
      const prev = order[i - 1];
      expect(
        prev.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(el.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        prev.getBoundingClientRect().bottom
      );
    }
  });

  test("a story under the clamp shows whole, with no button", async () => {
    const screen = await mount({
      npo: npo({ overview_pt: story_of(STORY_CLAMP - PARA.length) }),
    });
    await expect
      .element(screen.getByRole("heading", { name: "Our story" }))
      .toBeVisible();
    expect(
      screen.getByRole("button", { name: "Read the full story" }).query()
    ).toBeNull();
  });

  test("4+ campaigns swipe in a row; two sit side by side as halves", async () => {
    await page.viewport(1440, 900);
    const four = await mount();
    // the row is its own keyboard-reachable scroller
    const row = four.getByRole("region", { name: "Campaigns" }).element();
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(getComputedStyle(row).overflowX).toBe("auto");
    await expect
      .element(four.getByRole("button", { name: "See all 4" }))
      .toBeVisible();
    await cleanup();

    const two = await mount({ give: many(give, 2) });
    const cards = [1, 2].map(
      (n) =>
        two
          .getByRole("link", { name: `Clean water ${n}` })
          .element()
          .closest("article") as HTMLElement
    );
    await expect.element(two.getByText("Clean water 2")).toBeVisible();
    const [a, b] = cards.map((c) => c.getBoundingClientRect());
    expect(a.top).toBe(b.top);
    expect(b.left).toBeGreaterThan(a.right);
    expect(two.getByRole("button", { name: /^See all/ }).query()).toBeNull();
  });

  test("programs stay full-width rows at any count", async () => {
    await page.viewport(1440, 900);
    const screen = await mount({ programs: many(program, 5) });
    await expect
      .element(screen.getByRole("link", { name: "School meals 5" }))
      .toBeVisible();
    const rows = many(
      (n) =>
        screen
          .getByRole("link", { name: `School meals ${n}` })
          .element()
          .closest("article") as HTMLElement,
      5
    ).map((r) => r.getBoundingClientRect());
    const list = (
      screen
        .getByRole("heading", { name: "Programs", level: 2 })
        .element()
        .closest("section") as HTMLElement
    ).getBoundingClientRect();
    for (const [i, r] of rows.entries()) {
      expect(r.width).toBe(list.width);
      if (i > 0) expect(r.top).toBeGreaterThan(rows[i - 1].bottom);
    }
  });

  test("the header links only the sections the page has", async () => {
    await page.viewport(1440, 900);
    const screen = await mount({ videos: [video(1)], programs: [] });
    const nav = screen.getByRole("navigation", { name: "Sections" });
    await expect.element(nav).toBeVisible();
    const links = nav
      .getByRole("link")
      .elements()
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Story", "#story"],
      ["Campaigns", "#campaigns"],
      ["Videos", "#videos"],
    ]);
    for (const [, href] of links) {
      expect(document.querySelector(href as string)).not.toBeNull();
    }
  });

  test("the give section and its header link are named by what the list holds", async () => {
    await page.viewport(1440, 900);
    const cases = [
      [many(fundraiser, 2), "Supporter campaigns"],
      [[give(1), fundraiser(1)], "Campaigns"],
    ] as const;
    for (const [list, name] of cases) {
      const screen = await mount({ give: [...list] });
      await expect
        .element(screen.getByRole("heading", { name, level: 2, exact: true }))
        .toBeVisible();
      const link = screen
        .getByRole("navigation", { name: "Sections" })
        .getByRole("link", { name, exact: true });
      await expect.element(link).toHaveAttribute("href", "#campaigns");
      await cleanup();
    }
  });

  test("a list that failed keeps its section and link, with the failure line", async () => {
    await page.viewport(1440, 900);
    const screen = await mount({
      failed: { give: false, programs: false, videos: true },
    });
    await expect
      .element(
        screen
          .getByRole("navigation", { name: "Sections" })
          .getByRole("link", { name: "Videos" })
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "We couldn't load this nonprofit's videos right now. Please try again later."
        )
      )
      .toBeInTheDocument();
  });

  test.each([
    [4, "the swipe row"],
    [2, "the grid"],
  ])(
    "a failed give list that loaded %i keeps them in %s, with its line under them",
    async (n) => {
      await page.viewport(1440, 900);
      const screen = await mount({
        give: many(give, n),
        failed: { give: true, programs: false, videos: false },
      });
      const line = screen.getByText(
        "We couldn't load this nonprofit's campaigns right now. Please try again later."
      );
      await expect.element(line).toBeVisible();
      const card = screen.getByRole("link", { name: "Clean water 1" });
      await expect.element(card).toBeVisible();
      expect(
        card.element().compareDocumentPosition(line.element()) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      // the line sits in the campaigns' anchored section
      expect(line.element().closest("#campaigns")).not.toBeNull();
    }
  );

  test("on a phone the header's Donate waits until the card's has scrolled away", async () => {
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

  test("wider, the header's Donate waits while the sticky card's is on screen, and comes in once it has gone", async () => {
    await page.viewport(1440, 900);
    const screen = await mount({ programs: many(program, 10) });
    const root = screen.container;
    const panel = give_panel(root);
    await expect.poll(() => in_view(panel)).toBe(true);
    expect(header_donate(root)).toBeUndefined();
    // into the story: the card sticks, so the header still waits
    window.scrollTo(0, 600);
    await expect.poll(() => in_view(donates(panel)[0])).toBe(true);
    expect(header_donate(root)).toBeUndefined();
    // past the story the card scrolls away with it
    const rail = panel.parentElement as HTMLElement;
    window.scrollTo(0, rail.getBoundingClientRect().bottom + window.scrollY);
    await expect.poll(() => header_donate(root)).toBeDefined();
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
