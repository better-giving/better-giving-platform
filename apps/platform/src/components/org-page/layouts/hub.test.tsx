import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import {
  BANNER,
  donate_on_banner,
  donates,
  give_panel,
  header_donate,
  imgs_outside_panel,
  keyboard_ring,
  panel_banner,
  panel_parts,
  pinned_to_bottom,
  scroll_past_hero_donate,
  token_color,
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
  message,
  npo,
  org_figures,
  org_layout,
  program,
  prose,
  story,
  TAGLINE_MAX,
  video,
} from "#/__tests__/fixtures/org-layout";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import { STORY_SHORT_MAX } from "@/org-shape";
import { Hub } from "./hub";
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

function mount(props: IOrgLayout) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <Hub {...props} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/** a one-paragraph story whose words "how we teach" link out */
const linked_story = () =>
  JSON.stringify([
    {
      _type: "block",
      _key: "b0",
      style: "normal",
      markDefs: [
        {
          _type: "link",
          _key: "l0",
          href: "https://riverside.example.org/method",
        },
      ],
      children: [
        { _type: "span", _key: "s0", text: "Read ", marks: [] },
        { _type: "span", _key: "s1", text: "how we teach", marks: ["l0"] },
        { _type: "span", _key: "s2", text: ".", marks: [] },
      ],
    },
  ]);

const follows = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const tab_names = () =>
  [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent);

describe("Hub", () => {
  test.each([3322, 0])(
    "shows none of the org's figures, with %i raised and a goal stored",
    async (raised) => {
      const org = npo({ contributions_total: raised, target: "8000" });
      const screen = await mount(org_layout({ npo: org }));
      await expect
        .element(screen.getByRole("heading", { level: 1 }))
        .toBeVisible();
      expect(org_figures(screen.container, org)).toEqual([]);
    }
  );

  test("no middle dot anywhere in the rendered page", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      org_layout({ give: many(give, 4), messages: [message(1)] })
    );
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
      const screen = await mount(
        org_layout({ give: many(give, 4), programs: many(program, 2) })
      );
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
      const screen = await mount(
        org_layout({
          give: many(give, 4),
          programs: many(program, 2),
          npo: npo({
            name: LONG_NAME,
            tagline: TAGLINE_MAX,
            image: BANNER,
            overview_pt: story(prose(STORY_SHORT_MAX)),
          }),
        })
      );
      const donates = screen.getByRole("link", { name: "Donate", exact: true });
      await expect.element(donates.first()).toBeInTheDocument();
      await expect.poll(() => donates.elements().some(above_fold)).toBe(true);
      await expect
        .poll(() => in_view(screen.getByText(EIN, { exact: true }).element()))
        .toBe(true);
    }
  );

  test("a lone featured video plays at the reading measure, on the heading's edge", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      org_layout({ give: many(give, 4), videos: [video(1)] })
    );
    const featured = screen.getByRole("region", { name: "Featured" });
    const frame = featured.getByTitle("Field visit 1");
    await expect.element(frame).toBeInTheDocument();
    // max-w-3xl, 48rem
    const measure =
      48 *
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const width = frame.element().getBoundingClientRect().width;
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(measure);
    const region = (featured.element() as HTMLElement).getBoundingClientRect();
    expect(width).toBeLessThan(region.width);
    const box = frame.element().getBoundingClientRect();
    const heading = featured
      .getByRole("heading", { name: "Featured" })
      .element()
      .getBoundingClientRect();
    expect(box.left).toBeCloseTo(heading.left, 0);
  });

  test("a lone campaign beside a lone video is a mixed Featured, so the card names its kind", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      org_layout({
        give: [give(1)],
        programs: many(program, 4),
        videos: [video(1)],
      })
    );
    const featured = screen.getByRole("region", { name: "Featured" });
    await expect
      .element(featured.getByTitle("Field visit 1"))
      .toBeInTheDocument();
    await expect
      .element(featured.getByText("Campaign", { exact: true }))
      .toBeVisible();
  });

  test("a reveal and a message step play once: shown again, a tab does not replay them", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      org_layout({
        give: many(give, 2),
        programs: many(program, 8),
        messages: many(message, 3),
        on_more_messages: vi.fn(),
      })
    );
    const entering = (els: Element[]) =>
      els.filter((el) => /\bstarting:/.test(el.className));
    const panel = () => screen.getByRole("tabpanel").element() as HTMLElement;

    await screen.getByRole("button", { name: "Show 2 more" }).click();
    await expect
      .element(screen.getByRole("link", { name: "School meals 8" }))
      .toBeVisible();
    const items = () => [...panel().querySelectorAll("[data-count] > li")];
    // it rises, then settles
    await expect.poll(() => entering(items())).toEqual([]);

    await screen.getByRole("tab", { name: /^Messages/ }).click();
    await screen.getByRole("button", { name: "Next message" }).click();
    await expect
      .element(screen.getByText("Keep up the good work, from donor 2."))
      .toBeVisible();
    const step = () => [...panel().querySelectorAll("blockquote, figcaption")];
    await expect.poll(() => entering(step())).toEqual([]);

    await screen.getByRole("tab", { name: "Campaigns 2" }).click();
    await screen.getByRole("tab", { name: "Programs 8" }).click();
    await expect
      .element(screen.getByRole("link", { name: "School meals 8" }))
      .toBeVisible();
    expect(entering(items())).toEqual([]);

    await screen.getByRole("tab", { name: /^Messages/ }).click();
    await expect
      .element(screen.getByText("Keep up the good work, from donor 2."))
      .toBeVisible();
    expect(entering(step())).toEqual([]);
  });

  test("the band is the tint with no banner across the page and no mark over it; the banner is the give card's top at 4:1", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(
      org_layout({ give: many(give, 4), npo: npo({ image: BANNER }) })
    );
    const h1 = screen.getByRole("heading", { level: 1 }).element();
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    const main = screen.container.querySelector("main") as HTMLElement;
    const band = main.firstElementChild as HTMLElement;
    expect(band).toHaveClass("bg-band");
    expect(band).toContainElement(h1 as HTMLElement);
    const panel = give_panel(screen.container);
    await expect.poll(() => panel_banner(panel)?.ratio ?? 0).toBeCloseTo(4, 1);
    expect(panel_banner(panel)?.flush).toBe(true);
    expect(panel_parts(panel)).toEqual(["banner", "donate"]);
    const at = donate_on_banner(panel);
    expect(at?.inside).toBe(true);
    expect(at?.right).toBeCloseTo(12, 0);
    expect(at?.bottom).toBeCloseTo(12, 0);
    expect(imgs_outside_panel(screen.container)).toEqual([]);
    // the mark sits inside the band
    const mark = band.querySelector("[data-monogram]") as HTMLElement;
    expect(mark.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      band.getBoundingClientRect().top
    );
  });

  test("Donate on the banner draws its focus ring inside the fill, in the fill's own ink", async () => {
    await page.viewport(1440, 900);
    const screen = await mount(org_layout({ npo: npo({ image: BANNER }) }));
    const [donate] = donates(give_panel(screen.container));
    await expect.poll(() => donate.checkVisibility()).toBe(true);
    const focused = await keyboard_ring(donate);
    expect(focused.style).toBe("solid");
    expect(focused.color).toBe(token_color("--primary-fg"));
    expect(focused.offset).toBeLessThan(0);
  });

  test("with no banner the band stays the tint and the give card is Donate alone", async () => {
    const screen = await mount(
      org_layout({ give: many(give, 4), npo: npo({ image: null }) })
    );
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    const main = screen.container.querySelector("main") as HTMLElement;
    expect(main.firstElementChild).toHaveClass("bg-band");
    expect(main.querySelector("img")).toBeNull();
    const panel = give_panel(screen.container);
    expect(panel_parts(panel)).toEqual(["donate"]);
    const [donate] = donates(panel);
    expect(donate).toHaveClass("btn-primary");
  });

  test.each([
    [375, 812],
    [1440, 900],
  ])(
    "the facts row comes before the name, in the dom and on screen, at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount(org_layout({ give: many(give, 4) }));
      const h1 = screen.getByRole("heading", { level: 1 });
      await expect.element(h1).toBeVisible();
      const facts = screen
        .getByText(EIN, { exact: true })
        .element()
        .closest("ul") as HTMLElement;
      expect(follows(facts, h1.element())).toBe(true);
      expect(facts.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        h1.element().getBoundingClientRect().top
      );
      // and never between the tagline and the story
      const tagline = screen
        .getByText("Every adult a reader.", { exact: true })
        .element();
      expect(follows(facts, tagline)).toBe(true);
    }
  );

  test("no registration, no line", async () => {
    const screen = await mount(
      org_layout({ give: many(give, 4), credential: null })
    );
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(screen.getByText(EIN).query()).toBeNull();
  });

  test("a tab per kind with items, most first, a lone item as Featured, and Messages last", async () => {
    await page.viewport(375, 812);
    const screen = await mount(
      org_layout({
        give: many(give, 2),
        programs: many(program, 5),
        videos: [video(1)],
        messages: many(message, 3),
        on_more_messages: vi.fn(),
      })
    );
    await expect.element(screen.getByRole("tablist")).toBeVisible();
    // the lone video gets no tab; messages never lead, however many, and
    // carry no count: they load a page at a time
    expect(tab_names()).toEqual(["Programs 5", "Campaigns 2", "Messages"]);
    const featured = screen.getByRole("region", { name: "Featured" });
    await expect
      .element(featured.getByTitle("Field visit 1"))
      .toBeInTheDocument();

    // the count is in muted ink beside the label
    const count = screen
      .getByRole("tab", { name: "Programs 5" })
      .element()
      .querySelector("span") as HTMLElement;
    expect(count).toHaveTextContent("5");
    expect(count).toHaveClass("text-gray-11");

    // the most-stocked kind is open first
    await expect
      .element(screen.getByRole("tab", { name: "Programs 5" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByRole("link", { name: "School meals 1" }))
      .toBeVisible();

    await screen.getByRole("tab", { name: "Campaigns 2" }).click();
    await expect
      .element(screen.getByRole("link", { name: "Clean water 2" }))
      .toBeVisible();
    await screen.getByRole("tab", { name: /^Messages/ }).click();
    await expect
      .element(screen.getByText("Keep up the good work, from donor 1."))
      .toBeVisible();

    // the tab row scrolls inside itself; the page never scrolls sideways
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth
    );
  });

  test("the give tab is named by what it holds", async () => {
    const cases = [
      [many(give, 3), "Campaigns 3"],
      [many(fundraiser, 3), "Supporter campaigns 3"],
      [[give(1), ...many(fundraiser, 2)], "Campaigns 3"],
    ] as const;
    for (const [list, name] of cases) {
      const screen = await mount(
        org_layout({ give: [...list], programs: many(program, 2) })
      );
      await expect.element(screen.getByRole("tablist")).toBeVisible();
      expect(tab_names()).toEqual([name, "Programs 2"]);
      await cleanup();
    }

    // a lone kind's heading takes the same name
    const lone = await mount(org_layout({ give: many(fundraiser, 4) }));
    await expect
      .element(
        lone.getByRole("heading", { name: "Supporter campaigns", level: 2 })
      )
      .toBeVisible();
  });

  test("the tagline sits under the name with the short story after it, links kept; without one, the story alone, whole", async () => {
    await page.viewport(375, 812);
    const before =
      "Riverside Literacy puts a trained reading tutor beside every adult learner who asks, in libraries across three counties. Read ";
    const story_pt = JSON.stringify([
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        markDefs: [
          {
            _type: "link",
            _key: "l0",
            href: "https://riverside.example.org/method",
          },
        ],
        children: [
          { _type: "span", _key: "s0", text: before, marks: [] },
          { _type: "span", _key: "s1", text: "how we teach", marks: ["l0"] },
          { _type: "span", _key: "s2", text: ".", marks: [] },
        ],
      },
    ]);
    const with_story = (tagline: string | null) =>
      mount(
        org_layout({
          give: many(give, 4),
          npo: npo({ tagline, overview_pt: story_pt }),
        })
      );
    const tagged = await with_story("Every adult a reader.");
    const h1 = tagged.getByRole("heading", { level: 1 }).element();
    const tagline = tagged
      .getByText("Every adult a reader.", { exact: true })
      .element();
    const link = tagged.getByRole("link", { name: "how we teach" });
    await expect.element(link).toBeVisible();
    await expect
      .element(link)
      .toHaveAttribute("href", "https://riverside.example.org/method");
    expect(follows(h1, tagline)).toBe(true);
    expect(follows(tagline, link.element())).toBe(true);
    await cleanup();

    const untagged = await with_story(null);
    const story_link = untagged.getByRole("link", { name: "how we teach" });
    await expect.element(story_link).toBeVisible();
    // whole: the paragraph shows past two lines and hides nothing
    const para = (story_link.element() as HTMLElement).closest(
      "p"
    ) as HTMLElement;
    const s = getComputedStyle(para);
    expect(s.webkitLineClamp).toBe("none");
    expect(para.clientHeight / Number.parseFloat(s.lineHeight)).toBeGreaterThan(
      2
    );
    expect(para.scrollHeight - para.clientHeight).toBeLessThanOrEqual(1);
  });

  test.each([
    [375, 812],
    [1440, 900],
  ])(
    "the give card comes before the story in reading order; a phone shows it above, wider it is the story's right-hand column, at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount(
        org_layout({
          give: many(give, 4),
          npo: npo({ overview_pt: linked_story() }),
        })
      );
      const link = screen.getByRole("link", { name: "how we teach" });
      await expect.element(link).toBeVisible();
      const main = screen.container.querySelector("main") as HTMLElement;
      const [donate] = donates(main);
      expect(follows(donate, link.element())).toBe(true);
      const d = donate.getBoundingClientRect();
      const l = link.element().getBoundingClientRect();
      if (w < 768) expect(d.bottom).toBeLessThanOrEqual(l.top);
      else expect(l.right).toBeLessThanOrEqual(d.left);
      // the website link is in the meta row, read before Donate too
      const site = screen
        .getByText(EIN, { exact: true })
        .element()
        .closest("ul") as HTMLElement;
      expect(follows(site, donate)).toBe(true);
    }
  );

  test("a failed list that loaded some keeps them, with its line under them", async () => {
    const screen = await mount(
      org_layout({
        give: many(give, 5),
        programs: many(program, 2),
        failed: { give: true, programs: false, videos: false },
      })
    );
    await expect
      .element(screen.getByRole("tab", { name: "Campaigns" }))
      .toBeVisible();
    await screen.getByRole("tab", { name: "Campaigns" }).click();
    const line = screen.getByText(
      "We couldn't load this nonprofit's campaigns right now. Please try again later."
    );
    await expect.element(line).toBeVisible();
    const card = screen.getByRole("link", { name: "Clean water 1" });
    await expect.element(card).toBeVisible();
    expect(follows(card.element(), line.element())).toBe(true);
  });

  test("one kind left has no tablist, just its grid under its heading", async () => {
    const screen = await mount(org_layout({ give: many(give, 6) }));
    await expect
      .element(screen.getByRole("heading", { name: "Campaigns", level: 2 }))
      .toBeVisible();
    expect(screen.getByRole("tablist").query()).toBeNull();
    await expect
      .element(screen.getByRole("link", { name: "Clean water 1" }))
      .toBeVisible();
  });

  test("a list that failed keeps its tab, which shows the failure line", async () => {
    const screen = await mount(
      org_layout({
        give: many(give, 5),
        failed: { give: false, programs: true, videos: false },
      })
    );
    expect(tab_names()).toEqual(["Campaigns 5", "Programs"]);
    await screen.getByRole("tab", { name: "Programs" }).click();
    await expect
      .element(
        screen.getByText(
          "We couldn't load this nonprofit's programs right now. Please try again later."
        )
      )
      .toBeVisible();
  });

  test("on a phone the header's Donate waits until the card's has scrolled away", async () => {
    await page.viewport(375, 812);
    const screen = await mount(org_layout({ give: many(give, 4) }));
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
    const screen = await mount(org_layout({ give: many(give, 4) }));
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    expect(pinned_to_bottom(screen.container)).toEqual([]);
  });
});
