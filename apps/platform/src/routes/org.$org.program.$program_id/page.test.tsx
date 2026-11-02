import type { ComponentType } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: ComponentType) => Component,
  createClientLoaderCache: () => () => null,
}));
vi.mock("./api", () => ({ loader: () => null, headers: () => ({}) }));

// the viewer a favorite button would read; null is signed out
const user_mock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("#/hooks/use-user", () => ({
  use_user: () => ({ user: user_mock.current, toggle_bookmark: vi.fn() }),
}));

import ProgramPage, { meta } from "./route";

interface IData {
  prog?: object;
  donors?: number | null;
  campaigns?: object[];
}

const data = ({ prog = {}, donors = null, campaigns = [] }: IData = {}) => ({
  npo: {
    id: 7,
    slug: "acme",
    name: "Acme Relief",
    logo: null,
    social_media_urls: { facebook: "https://facebook.com/acme" },
  },
  url: "https://x/org/acme/program/p1",
  prog: {
    id: "p1",
    title: "Wells",
    description_pt: "[]",
    milestones: [],
    ...prog,
  },
  donors,
  campaigns,
});

function mount(d: IData = {}) {
  const Stub = createRoutesStub([
    {
      path: "/org/:org/program/:program_id",
      Component: ProgramPage as never,
      loader: () => data(d),
    },
  ]);
  return render(<Stub initialEntries={["/org/acme/program/p1"]} />);
}

const DONATE_TO = "/donate/7?programId=p1";

/** an image that loads with no network */
const BANNER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="16" height="9" fill="red"/></svg>'
)}`;

const block = (key: string, text: string) => ({
  _type: "block",
  _key: key,
  children: [{ _type: "span", _key: `${key}s`, text }],
});

/** the card that opens the page, the one holding the title */
const head_of = (screen: Awaited<ReturnType<typeof mount>>) =>
  screen.getByRole("heading", { level: 1 }).element().closest("section")!;

describe("program page", () => {
  afterEach(async () => {
    await cleanup();
    user_mock.current = null;
    await reset_viewport();
  });

  it("donates to the program from the header and the aside, and leads back to the org", async () => {
    user_mock.current = { bookmarks: [] };
    const screen = await mount();
    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Wells" }))
      .toBeVisible();

    const header = screen.getByRole("banner");
    await expect
      .element(header.getByRole("link", { name: "Donate", exact: true }))
      .toHaveAttribute("href", DONATE_TO);
    // no Share, no Favorite, even for a signed-in viewer: the header's only
    // controls are links
    expect(header.getByRole("button").query()).toBeNull();
    await expect
      .element(screen.getByRole("link", { name: "Donate to this program" }))
      .toHaveAttribute("href", DONATE_TO);

    // the masthead's mark is the way back; the page carries no second one
    await expect
      .element(header.getByRole("link", { name: "Acme Relief" }))
      .toHaveAttribute("href", "/org/acme");
    expect(screen.getByRole("link", { name: /back to/i }).query()).toBeNull();
  });

  it("tags the page Program, and shows a banner only when the program has one", async () => {
    const banner = await mount({ prog: { banner: BANNER } });
    await expect
      .element(banner.getByRole("heading", { level: 1, name: "Wells" }))
      .toBeVisible();
    const head = page.elementLocator(head_of(banner));
    await expect
      .element(head.getByText("Program", { exact: true }))
      .toBeVisible();
    expect(head.element().querySelector("img")?.getAttribute("src")).toBe(
      BANNER
    );
    await cleanup();

    const bare = await mount();
    await expect
      .element(bare.getByRole("heading", { level: 1, name: "Wells" }))
      .toBeVisible();
    const bare_head = page.elementLocator(head_of(bare));
    await expect
      .element(bare_head.getByText("Program", { exact: true }))
      .toBeVisible();
    expect(bare_head.element().querySelector("img")).toBeNull();
  });

  it("gives the program's About under its heading", async () => {
    const screen = await mount({
      prog: {
        description_pt: JSON.stringify([block("a", "Wells for six villages.")]),
      },
    });
    const about = page.elementLocator(
      screen
        .getByRole("heading", { name: "About this program" })
        .element()
        .closest("section")!
    );
    await expect
      .element(about.getByText("Wells for six villages."))
      .toBeVisible();
  });

  it("reads the raised card before About on a phone, and sets it beside About from lg", async () => {
    const rects = (screen: Awaited<ReturnType<typeof mount>>) => {
      const about = screen
        .getByRole("heading", { name: "About this program" })
        .element()
        .closest("section")!;
      return {
        aside: screen
          .getByRole("complementary")
          .element()
          .getBoundingClientRect(),
        about: about.getBoundingClientRect(),
      };
    };
    const story = JSON.stringify([block("a", "Wells for six villages.")]);

    await page.viewport(375, 667);
    const phone = await mount({ prog: { description_pt: story } });
    await expect
      .element(phone.getByText("Wells for six villages."))
      .toBeVisible();
    const one = rects(phone);
    expect(one.aside.bottom).toBeLessThanOrEqual(one.about.top);
    await cleanup();

    await page.viewport(1280, 900);
    const wide = await mount({ prog: { description_pt: story } });
    await expect
      .element(wide.getByText("Wells for six villages."))
      .toBeVisible();
    const two = rects(wide);
    expect(two.aside.left).toBeGreaterThanOrEqual(two.about.right);
    expect(Math.abs(two.aside.top - two.about.top)).toBeLessThan(1);
  });

  it("counts donors and draws the goal when it has them, and neither when it doesn't", async () => {
    const counted = await mount({
      prog: { target_raise: 500, total_donations: 100 },
      donors: 12,
    });
    await expect
      .element(counted.getByText("raised from 12 donors"))
      .toBeVisible();
    await expect
      .element(counted.getByRole("progressbar", { name: "Amount raised" }))
      .toBeVisible();
    await expect
      .element(counted.getByText("20% of $500 goal", { exact: true }))
      .toBeVisible();
    await cleanup();

    const bare = await mount({ prog: { total_donations: 100 }, donors: null });
    const aside = bare.getByRole("complementary");
    await expect
      .element(aside.getByText("$100 raised", { exact: true }))
      .toBeVisible();
    expect(aside.getByText("donor").query()).toBeNull();
    expect(bare.getByRole("progressbar").query()).toBeNull();
    expect(bare.getByText("goal").query()).toBeNull();
  });

  it("lists the program's campaigns, each opening its page, and hides the section without any", async () => {
    const screen = await mount({
      campaigns: [
        {
          id: "c1",
          name: "Spring well drive",
          to: "/org/acme/spring-well-drive",
          image: null,
          raised: 400,
          target: "1000",
        },
        {
          id: "c2",
          name: "Pump repairs",
          to: "/org/acme/pump-repairs",
          image: null,
          raised: 40,
          target: undefined,
        },
      ],
    });
    await expect
      .element(
        screen.getByRole("heading", { name: "Campaigns in this program" })
      )
      .toBeVisible();
    // the page's one list, with no milestones
    const section = screen.getByRole("list");
    await expect
      .element(section.getByRole("link", { name: "Spring well drive" }))
      .toHaveAttribute("href", "/org/acme/spring-well-drive");
    await expect
      .element(section.getByRole("link", { name: "Pump repairs" }))
      .toHaveAttribute("href", "/org/acme/pump-repairs");
    await expect
      .element(section.getByText("of $1,000", { exact: true }))
      .toBeVisible();
    // only the campaign with a goal draws a bar
    expect(section.getByRole("progressbar").elements()).toHaveLength(1);
    await expect
      .element(section.getByText("$40 raised", { exact: true }))
      .toBeVisible();
    await cleanup();

    const none = await mount({ campaigns: [] });
    await expect
      .element(none.getByRole("heading", { level: 1, name: "Wells" }))
      .toBeVisible();
    expect(
      none.getByRole("heading", { name: "Campaigns in this program" }).query()
    ).toBeNull();
  });

  it("clips a campaign's photo to the 160px media cell under its name, and keeps a lone card a column wide", async () => {
    await page.viewport(1280, 900);
    const tall = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1200"><rect width="400" height="1200"/></svg>'
    )}`;
    const screen = await mount({
      campaigns: [
        {
          id: "c1",
          name: "Spring well drive",
          to: "/org/acme/spring-well-drive",
          image: tall,
          raised: 400,
          target: "1000",
        },
      ],
    });
    const list = screen.getByRole("list");
    const name = list.getByRole("link", { name: "Spring well drive" });
    await expect.element(name).toBeVisible();
    const img = list.element().querySelector("img") as HTMLImageElement;
    await vi.waitFor(() => expect(img.complete).toBe(true));

    const media = img.getBoundingClientRect();
    expect(media.height).toBe(160);
    const label = name.element().getBoundingClientRect();
    expect(label.top).toBeGreaterThanOrEqual(media.top);
    expect(label.bottom).toBeLessThanOrEqual(media.bottom);
    // the amounts sit below the photo, not over it
    const amount = list.getByText("of $1,000", { exact: true }).element();
    expect(amount.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      media.bottom
    );
    const card = list.getByRole("listitem").element().getBoundingClientRect();
    expect(card.width).toBeLessThan(
      list.element().getBoundingClientRect().width / 2
    );
  });

  it("sets at most three campaigns across on a wide screen", async () => {
    await page.viewport(1440, 900);
    const screen = await mount({
      campaigns: ["One", "Two", "Three", "Four"].map((name, i) => ({
        id: `c${i}`,
        name,
        to: `/org/acme/c${i}`,
        image: null,
        raised: 10,
      })),
    });
    const list = screen.getByRole("list");
    await expect
      .element(list.getByRole("link", { name: "Four" }))
      .toBeVisible();
    const tops = list
      .getByRole("listitem")
      .elements()
      .map((li) => li.getBoundingClientRect().top);
    expect(tops.filter((t) => t === tops[0])).toHaveLength(3);
    expect(tops[3]).toBeGreaterThan(tops[0]);
  });

  it("sets the program's paragraphs apart", async () => {
    await page.viewport(1280, 900);
    const screen = await mount({
      prog: {
        description_pt: JSON.stringify([
          block("a", "Wells dug by the village."),
          block("b", "Pumps kept running by the same crew."),
        ]),
      },
    });
    const first = screen.getByText("Wells dug by the village.");
    await expect.element(first).toBeVisible();
    const second = screen.getByText("Pumps kept running by the same crew.");
    const gap =
      second.element().getBoundingClientRect().top -
      first.element().getBoundingClientRect().bottom;
    expect(gap).toBeGreaterThanOrEqual(12);
  });

  it("shows a milestone timeline, and none without milestones", async () => {
    const screen = await mount({
      prog: {
        milestones: [
          {
            title: "Drill first well",
            description_pt: "[]",
            date: "2020-01-02T00:00:00.000Z",
          },
        ],
      },
    });
    await expect
      .element(screen.getByRole("heading", { name: "Milestones" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("heading", { name: "Drill first well" }))
      .toBeVisible();
    await expect.element(screen.getByText("Jan 2, 2020")).toBeVisible();
    // under About, in its column
    const about = screen
      .getByRole("heading", { name: "About this program" })
      .element()
      .closest("section")!;
    const milestones = screen
      .getByRole("heading", { name: "Milestones" })
      .element();
    expect(milestones.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      about.getBoundingClientRect().bottom
    );
    await cleanup();

    const none = await mount();
    await expect
      .element(none.getByRole("heading", { level: 1, name: "Wells" }))
      .toBeVisible();
    expect(
      none.getByRole("heading", { name: "Milestones" }).query()
    ).toBeNull();
  });

  it("on a phone, pins nothing to the bottom and ends on the platform credit alone", async () => {
    await page.viewport(375, 667);
    const screen = await mount();
    await expect
      .element(screen.getByRole("link", { name: "Donate to this program" }))
      .toBeVisible();

    const fixed = [...document.body.querySelectorAll("*")].filter(
      (el) => getComputedStyle(el).position === "fixed"
    );
    expect(fixed).toEqual([]);

    const footer = screen.getByRole("contentinfo");
    await expect
      .element(footer.getByRole("link", { name: "Powered by Better Giving" }))
      .toHaveAttribute("href", "/");
    expect(footer.getByRole("link").elements()).toHaveLength(1);
    expect(footer.getByText("Acme Relief").query()).toBeNull();
  });

  it("shares its banner, or the default image without one", () => {
    const og_image = (prog: object) =>
      (meta as any)({ loaderData: data({ prog }) }).find(
        (m: { property?: string }) => m.property === "og:image"
      )?.content;

    expect(og_image({ banner: "https://x/banner.png" })).toBe(
      "https://x/banner.png"
    );
    expect(og_image({ banner: null })).toMatch(/\/og-default\.png$/);
  });
});
