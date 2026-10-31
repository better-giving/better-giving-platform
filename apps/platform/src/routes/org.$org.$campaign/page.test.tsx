import { HttpResponse, http } from "msw";
import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { page as browser, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { mswWorker } from "#/setup-tests-browser";
import { CampaignPage, type ICampaignPage } from "./page";

function mount(props: ICampaignPage) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <CampaignPage {...props} />,
      HydrateFallback: () => null,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

/** enough story to scroll the inline Donate away at any width */
const long_story = {
  value: JSON.stringify(
    Array.from({ length: 60 }, (_, i) => ({
      _type: "block",
      _key: `p${i}`,
      style: "normal",
      markDefs: [],
      children: [
        {
          _type: "span",
          _key: `s${i}`,
          marks: [],
          text: "Every winter the clinic runs its boilers through the coldest weeks, and every winter the fuel bill lands before the grants do. This fund bridges that gap so the waiting room stays warm for the families who come in.",
        },
      ],
    }))
  ),
};

/** a box's right content edge: its rect less its right padding */
function content_right(el: Element) {
  return (
    el.getBoundingClientRect().right -
    Number.parseFloat(getComputedStyle(el).paddingRight)
  );
}

async function at_viewport(w: number, h: number, run: () => Promise<void>) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  await browser.viewport(w, h);
  try {
    await run();
  } finally {
    window.scrollTo(0, 0);
    await browser.viewport(width, height);
  }
}

function page(over: Partial<ICampaignPage> = {}): ICampaignPage {
  return {
    title: "Winter fuel for Harbor Clinic",
    org_name: "Harbor Clinic",
    org_href: "/org/harbor",
    logo: null,
    tag: "Year-end",
    program_name: "Warmth fund",
    hero: null,
    hero_alt: "",
    story: { value: "" },
    videos: [],
    raised_line: "$1,200 raised of $8,000 goal",
    bar: { raised: 1200, goal: 8000 },
    donor_line: "18 donors · 12 days left",
    no_gifts: false,
    open: true,
    ended_body: null,
    donors: { id: "npo-1", campaign_id: "camp-1" },
    form: <p>Form body</p>,
    share: {
      recipientName: "Winter fuel for Harbor Clinic",
      url: "https://better.giving/org/harbor/winter",
    },
    ...over,
  };
}

describe("campaign page", () => {
  test("an open page shows Donate and Share and drops the old chrome", async () => {
    const screen = await mount(page());
    await expect
      .element(screen.getByRole("button", { name: "Donate", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Share", exact: true }))
      .toBeVisible();
    expect(screen.getByText("About this campaign").query()).toBeNull();
    expect(screen.getByText("Spread the word!").query()).toBeNull();
    expect(screen.getByText(/Visit/).query()).toBeNull();
    expect(screen.getByText("Program:").query()).toBeNull();
    expect(screen.getByText(/%/).query()).toBeNull();
    expect(screen.getByText("Continue with Card").query()).toBeNull();
    expect(document.querySelector("[data-sticky]")).toBeNull();
  });

  test("the owner's header leads and the platform credit closes the page", async () => {
    const screen = await mount(page());
    const home = screen
      .getByRole("banner")
      .getByRole("link", { name: "Harbor Clinic" });
    await expect.element(home).toBeVisible();
    expect(home.element().getAttribute("href")).toBe("/org/harbor");
    const credit = screen
      .getByRole("contentinfo")
      .getByRole("link", { name: "Powered by Better Giving", exact: true });
    await expect.element(credit).toBeVisible();
    expect(credit.element().getAttribute("href")).toBe("/");
    expect(screen.getByRole("contentinfo").elements()).toHaveLength(1);
  });

  test.each([375, 768, 1024, 1280, 1536, 1920])(
    "at %ipx the header and the content share both edges, centered",
    async (width) => {
      await at_viewport(width, 900, async () => {
        const screen = await mount(page());
        const bar = screen.getByRole("banner").element()
          .firstElementChild as HTMLElement;
        const mark = screen
          .getByRole("banner")
          .getByRole("link", { name: "Harbor Clinic" })
          .element();
        const title = screen
          .getByRole("heading", { name: "Winter fuel for Harbor Clinic" })
          .element();
        const donate = screen
          .getByRole("main")
          .getByRole("button", { name: "Donate", exact: true })
          .element();
        const main = screen.getByRole("main").element().getBoundingClientRect();
        const viewport = document.documentElement.clientWidth;
        expect(main.left).toBeCloseTo(viewport - main.right, 0);
        // past the widest rung the page stops widening and both boxes center
        if (width > 1536) expect(main.left).toBeGreaterThan(0);
        expect(bar.getBoundingClientRect().left).toBeCloseTo(main.left, 0);
        await vi.waitFor(() => {
          expect(title.getBoundingClientRect().left).toBeCloseTo(
            mark.getBoundingClientRect().left,
            0
          );
          expect(donate.getBoundingClientRect().right).toBeCloseTo(
            content_right(bar),
            0
          );
        });
      });
    }
  );

  // the story track the page had before it took `page`: a 1224px content box
  // less the 392px give column and the 32px lg:gap-8
  const story_track = 1224 - 392 - 32;

  // 768 is the single column; 1280 is under the cap; 1536 is the first width
  // past it (1920 lays out the same box, only centered)
  test.each([768, 1280, 1536])(
    "at %ipx the story's media and text share one right edge, within the old track",
    async (width) => {
      await at_viewport(width, 900, async () => {
        const screen = await mount(
          page({
            story: long_story,
            hero: "/hero.jpg",
            hero_alt: "The clinic's waiting room",
            videos: [{ url: "https://vimeo.com/1" }],
          })
        );
        await expect
          .element(screen.getByRole("region", { name: "Story" }))
          .toBeVisible();
        const column = document.querySelector(
          "[data-col='story']"
        ) as HTMLElement;
        const items = [...column.children].map((x) =>
          x.getBoundingClientRect()
        );
        expect(items).toHaveLength(4);
        const right = items[0]?.right ?? 0;
        for (const item of items) {
          expect(item.right).toBeCloseTo(right, 0);
          expect(item.width).toBeLessThanOrEqual(story_track);
        }
        // where the track has room it keeps its old width, not a narrower one
        if (width >= 1536) expect(items[0]?.width).toBeCloseTo(story_track, 0);
      });
    }
  );

  test("from lg, the header's Donate waits for the inline one to leave, then opens the same dialog", async () => {
    // short enough that the give column does not stick, so its Donate leaves
    await at_viewport(1440, 400, async () => {
      const screen = await mount(page({ story: long_story }));
      const in_header = screen
        .getByRole("banner")
        .getByRole("button", { name: "Donate", exact: true });
      await expect
        .element(
          screen.getByRole("main").getByRole("button", {
            name: "Donate",
            exact: true,
          })
        )
        .toBeVisible();
      await expect.element(in_header).not.toBeInTheDocument();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await expect.element(in_header).toBeVisible();
      window.scrollTo(0, 0);
      await expect.element(in_header).not.toBeInTheDocument();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await expect.element(in_header).toBeVisible();
      await in_header.click();
      await expect
        .element(screen.getByRole("dialog", { name: "Donate" }))
        .toBeVisible();
    });
  });

  test("on a phone, the bottom bar carries Donate and the header does not", async () => {
    await at_viewport(375, 800, async () => {
      const screen = await mount(page({ story: long_story }));
      await expect
        .element(screen.getByRole("button", { name: "Donate", exact: true }))
        .toBeVisible();
      window.scrollTo(0, document.documentElement.scrollHeight);
      const bar = () => document.querySelector("[data-sticky='bar']");
      await vi.waitFor(() => expect(bar()).not.toBeNull());
      const in_bar = browser
        .elementLocator(bar() as HTMLElement)
        .getByRole("button", { name: "Donate", exact: true });
      await expect.element(in_bar).toBeVisible();
      await expect.element(in_bar).toHaveAttribute("aria-haspopup", "dialog");
      const in_header = screen
        .getByRole("banner")
        .getByRole("button", { name: "Donate", includeHidden: true });
      // below lg the header keeps its Donate unpainted, risen or not
      await expect.element(in_header).toBeInTheDocument();
      await expect.element(in_header).not.toBeVisible();
    });
  });

  test("on a phone, the bar is up while the inline Donate sits under the pinned header", async () => {
    await at_viewport(375, 800, async () => {
      const screen = await mount(page({ story: long_story }));
      const inline = screen
        .getByRole("main")
        .getByRole("button", { name: "Donate", exact: true });
      await expect.element(inline).toBeVisible();
      await expect.element(inline).toHaveAttribute("aria-haspopup", "dialog");
      const banner = screen.getByRole("banner").element();
      const bar = () => document.querySelector("[data-sticky='bar']");
      // scroll until the inline Donate's bottom edge lands within 1px of the
      // pinned header's: still showing, so no bar
      await vi.waitFor(() => {
        const header_bottom = banner.getBoundingClientRect().bottom;
        const donate = inline.element().getBoundingClientRect();
        window.scrollBy(0, donate.bottom - header_bottom);
        const now = inline.element().getBoundingClientRect().bottom;
        const edge = banner.getBoundingClientRect().bottom;
        expect(now).toBeGreaterThanOrEqual(edge);
        expect(now).toBeLessThan(edge + 1);
      });
      // two frames for the observer to report and the page to re-render
      for (let i = 0; i < 2; i++)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(bar()).toBeNull();
      // one more pixel puts it under the header
      window.scrollBy(0, 1);
      await vi.waitFor(() => expect(bar()).not.toBeNull());
    });
  });

  test.each([16, 20])(
    "at a %ipx root font, a stuck give column clears the header and the viewport bottom",
    async (root_px) => {
      const root = document.documentElement;
      root.style.fontSize = `${root_px}px`;
      try {
        await at_viewport(1440, 900, async () => {
          const screen = await mount(page({ story: long_story }));
          const action = () =>
            document.querySelector("[data-col='action']") as HTMLElement;
          const banner = screen.getByRole("banner").element();
          await vi.waitFor(() => {
            expect(getComputedStyle(action()).position).toBe("sticky");
          });
          window.scrollTo(0, 1200);
          await vi.waitFor(() => {
            const header_bottom = banner.getBoundingClientRect().bottom;
            const column = action().getBoundingClientRect();
            expect(header_bottom).toBeGreaterThan(0);
            // stuck, not merely scrolled past
            expect(column.bottom).toBeGreaterThan(header_bottom);
            // 2rem clear of the header's painted bottom edge, inside a 1px window
            expect(column.top - header_bottom).toBeGreaterThanOrEqual(
              2 * root_px
            );
            expect(column.top - header_bottom).toBeLessThan(2 * root_px + 1);
            expect(window.innerHeight - column.bottom).toBeGreaterThanOrEqual(
              2 * root_px - 1
            );
          });
        });
      } finally {
        root.style.fontSize = "";
      }
    }
  );

  test.each([16, 20])(
    "at a %ipx root font, a give column too tall for the room under the header stays unstuck",
    async (root_px) => {
      const root = document.documentElement;
      root.style.fontSize = `${root_px}px`;
      try {
        await at_viewport(1440, 900, async () => {
          const screen = await mount(page());
          const action = () =>
            document.querySelector("[data-col='action']") as HTMLElement;
          await vi.waitFor(() => {
            expect(getComputedStyle(action()).position).toBe("sticky");
          });
          const column = action().getBoundingClientRect().height;
          const pinned_bottom =
            screen.getByRole("banner").element().getBoundingClientRect()
              .height - 1;
          // the least whole viewport height the column fits in: the header's
          // painted bottom, 2rem clear, the column, 2rem clear of the bottom
          const fits = Math.ceil(column + pinned_bottom + 4 * root_px);
          await browser.viewport(1440, fits - 1);
          await vi.waitFor(() => {
            expect(getComputedStyle(action()).position).not.toBe("sticky");
          });
          await browser.viewport(1440, fits);
          await vi.waitFor(() => {
            expect(getComputedStyle(action()).position).toBe("sticky");
          });
        });
      } finally {
        root.style.fontSize = "";
      }
    }
  );

  test("a page mounted with no layout box renders", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <div hidden>
            <CampaignPage {...page()} />
          </div>
        ),
        ErrorBoundary: () => <p>route error</p>,
        HydrateFallback: () => null,
      },
    ]);
    const screen = await render(<Stub initialEntries={["/"]} />);
    await expect
      .element(
        screen.getByRole("heading", {
          name: "Winter fuel for Harbor Clinic",
          includeHidden: true,
        })
      )
      .toBeInTheDocument();
    // the observer's effect runs after the first paint; give it a frame to throw
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(screen.getByText("route error").query()).toBeNull();
  });

  test("Donate opens the dialog and Close returns focus", async () => {
    const screen = await mount(page());
    const donate = screen.getByRole("button", { name: "Donate", exact: true });
    await donate.click();
    const close = screen.getByRole("button", { name: "Close", exact: true });
    await expect.element(close).toBeVisible();
    expect(close.element().querySelector("svg")).not.toBeNull();
    expect(close.element().textContent).not.toContain("×");
    await expect
      .element(screen.getByRole("dialog", { name: "Donate" }))
      .toBeVisible();
    expect(document.activeElement).toBe(close.element());
    await close.click();
    await expect
      .element(screen.getByRole("dialog", { name: "Donate" }))
      .not.toBeInTheDocument();
    expect(document.activeElement).toBe(donate.element());
  });

  test("Escape closes the dialog", async () => {
    const screen = await mount(page());
    await screen.getByRole("button", { name: "Donate", exact: true }).click();
    await expect
      .element(screen.getByRole("dialog", { name: "Donate" }))
      .toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("dialog", { name: "Donate" }))
      .not.toBeInTheDocument();
  });

  test("an ended page keeps Share and drops Donate, the header's included, and the sticky bar", async () => {
    // from lg, where the header carries a Donate when the page is open
    await at_viewport(1440, 900, async () => {
      const screen = await mount(
        page({
          open: false,
          ended_body:
            "It no longer takes donations. Thank you to everyone who gave.",
          donor_line: "18 donors · Ended",
          story: long_story,
        })
      );
      expect(
        screen.getByRole("button", { name: "Donate", exact: true }).query()
      ).toBeNull();
      expect(document.querySelector("[data-sticky]")).toBeNull();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await expect
        .element(screen.getByRole("button", { name: "Share", exact: true }))
        .toBeVisible();
      expect(
        screen
          .getByRole("banner")
          .getByRole("button", { name: "Donate", includeHidden: true })
          .query()
      ).toBeNull();
      await expect
        .element(screen.getByRole("heading", { name: "Giving has ended" }))
        .toBeVisible();
      await expect
        .element(
          screen.getByText(
            "It no longer takes donations. Thank you to everyone who gave."
          )
        )
        .toBeVisible();
      const visit = screen.getByRole("link", { name: "Visit Harbor Clinic" });
      await expect.element(visit).toBeVisible();
      expect(visit.element().getAttribute("href")).toBe("/org/harbor");
    });
  });

  test("on a phone, an ended page has no Donate", async () => {
    await at_viewport(375, 800, async () => {
      const screen = await mount(
        page({
          open: false,
          ended_body:
            "It no longer takes donations. Thank you to everyone who gave.",
          donor_line: "18 donors · Ended",
          story: long_story,
        })
      );
      await expect
        .element(screen.getByRole("heading", { name: "Giving has ended" }))
        .toBeVisible();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await expect
        .element(screen.getByRole("button", { name: "Share", exact: true }))
        .toBeVisible();
      expect(
        screen
          .getByRole("button", { name: "Donate", includeHidden: true })
          .query()
      ).toBeNull();
    });
  });

  test("the sticky bar stays unmounted while Donate is in view", async () => {
    const screen = await mount(page());
    await expect
      .element(screen.getByRole("button", { name: "Donate", exact: true }))
      .toBeVisible();
    expect(document.querySelector("[data-sticky='bar']")).toBeNull();
  });

  test("a short column mounts the bar once Donate leaves", async () => {
    const seen: IntersectionObserverCallback[] = [];
    const Real = globalThis.IntersectionObserver;
    class StubIO implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [0];
      constructor(cb: IntersectionObserverCallback) {
        seen.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", StubIO);
    const width = window.innerWidth;
    const height = window.innerHeight;
    // the iframe defaults below lg, where the column is display:contents (height 0)
    await browser.viewport(1440, 900);
    try {
      const screen = await mount(page());
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
      expect(document.querySelector("[data-sticky]")).toBeNull();
      for (const cb of seen) {
        cb(
          [
            {
              isIntersecting: false,
              intersectionRatio: 0,
              target: document.createElement("div"),
            } as unknown as IntersectionObserverEntry,
          ],
          seen as unknown as IntersectionObserver
        );
      }
      await vi.waitFor(() => {
        expect(document.querySelector("[data-sticky='bar']")).not.toBeNull();
      });
      await expect
        .element(
          screen.getByRole("heading", { name: "Winter fuel for Harbor Clinic" })
        )
        .toBeVisible();
    } finally {
      vi.stubGlobal("IntersectionObserver", Real);
      await browser.viewport(width, height);
    }
  });

  test("initial_dialog_open paints the dialog open", async () => {
    const screen = await mount(page({ initial_dialog_open: true }));
    await expect
      .element(screen.getByRole("dialog", { name: "Donate" }))
      .toBeVisible();
    await expect.element(screen.getByText("Form body")).toBeVisible();
    const close = screen.getByRole("button", { name: "Close", exact: true });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(close.element());
    });
    expect(close.element().matches(":focus-visible")).toBe(false);
  });

  test("a website renders on the legal line without a legal string", async () => {
    const screen = await mount(
      page({
        website: { href: "https://harbor.example", label: "harbor.example" },
      })
    );
    const link = screen.getByRole("link", { name: "harbor.example" });
    await expect.element(link).toBeVisible();
    expect(link.element().getAttribute("href")).toBe("https://harbor.example");
    expect(link.element().className).toContain("underline");
    expect(link.element().className).toContain("font-semibold");
    expect(link.element().parentElement?.textContent).toBe("harbor.example");
  });

  test("legal text renders without a website", async () => {
    const screen = await mount(page({ legal: "501(c)(3) · EIN 12-3456789" }));
    await expect
      .element(screen.getByText("501(c)(3) · EIN 12-3456789"))
      .toBeVisible();
    expect(
      screen.getByRole("link", { name: "harbor.example" }).query()
    ).toBeNull();
  });

  test("legal text and a website share one line", async () => {
    const screen = await mount(
      page({
        legal: "501(c)(3) · EIN 12-3456789",
        website: { href: "https://harbor.example", label: "harbor.example" },
      })
    );
    const link = screen.getByRole("link", { name: "harbor.example" });
    await expect.element(link).toBeVisible();
    expect(link.element().parentElement?.textContent).toBe(
      "501(c)(3) · EIN 12-3456789 · harbor.example"
    );
  });

  test("a thank-you names the gift that landed", async () => {
    const screen = await mount(
      page({ thanks: { amount: "$100", receipt: "/donations/gift-1" } })
    );
    await expect
      .element(screen.getByText("Your $100 gift is in."))
      .toBeVisible();
    const receipt = screen.getByRole("link", { name: "View your receipt" });
    await expect.element(receipt).toBeVisible();
    expect(receipt.element().getAttribute("href")).toBe("/donations/gift-1");
  });

  test("a failed return says the gift did not go through", async () => {
    const screen = await mount(page({ gift_failed: true }));
    await expect
      .element(screen.getByText("This gift didn't go through"))
      .toBeVisible();
    await expect
      .element(screen.getByText("You can try again from this page."))
      .toBeVisible();
    expect(screen.getByText("Your $100 gift is in.").query()).toBeNull();
  });

  test("a thank-you stays up when the gift also failed", async () => {
    const screen = await mount(
      page({ gift_failed: true, thanks: { amount: "$100" } })
    );
    await expect
      .element(screen.getByText("Your $100 gift is in."))
      .toBeVisible();
    expect(screen.getByText("This gift didn't go through").query()).toBeNull();
  });

  test("a thank-you stays up after giving has ended", async () => {
    const screen = await mount(
      page({
        open: false,
        ended_body:
          "It no longer takes donations. Thank you to everyone who gave.",
        thanks: { amount: "$40", receipt: "/donations/gift-2" },
      })
    );
    await expect
      .element(screen.getByText("Your $40 gift is in."))
      .toBeVisible();
    const receipt = screen.getByRole("link", { name: "View your receipt" });
    expect(receipt.element().getAttribute("href")).toBe("/donations/gift-2");
    expect(
      screen.getByRole("heading", { name: "Giving has ended" }).query()
    ).toBeNull();
  });

  test("a failed gift stays up after giving has ended", async () => {
    const screen = await mount(
      page({
        open: false,
        ended_body:
          "It no longer takes donations. Thank you to everyone who gave.",
        gift_failed: true,
      })
    );
    await expect
      .element(screen.getByText("This gift didn't go through"))
      .toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Giving has ended" }).query()
    ).toBeNull();
    expect(
      screen.getByText("You can try again from this page.").query()
    ).toBeNull();
    await expect
      .element(
        screen.getByText(
          "It no longer takes donations. Thank you to everyone who gave."
        )
      )
      .toBeVisible();
    const visit = screen.getByRole("link", { name: "Visit Harbor Clinic" });
    await expect.element(visit).toBeVisible();
    expect(visit.element().getAttribute("href")).toBe("/org/harbor");
  });

  test("a payment in flight keeps the dialog from closing", async () => {
    const screen = await mount(
      page({ initial_dialog_open: true, pay_busy: true })
    );
    const close = screen.getByRole("button", { name: "Close", exact: true });
    await expect.element(close).toBeDisabled();
    await close.click({ force: true });
    await expect
      .element(screen.getByRole("dialog", { name: "Donate" }))
      .toBeVisible();
  });

  test("a short feed sticks once it has resolved", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    mswWorker.use(
      http.get("/api/npo/fit-npo/donors", async () => {
        await hold;
        return HttpResponse.json({
          items: [
            {
              id: "ada",
              donor_name: "Ada Lovelace",
              donor_message: "For the Tuesday stew.",
              amount: 40,
              date: new Date().toISOString(),
            },
          ],
          next: null,
        });
      })
    );
    const width = window.innerWidth;
    const height = window.innerHeight;
    await browser.viewport(1440, 900);
    try {
      const screen = await mount(
        page({ donors: { id: "fit-npo", campaign_id: "camp-fit" } })
      );
      const action = () => document.querySelector("[data-col='action']");
      await vi.waitFor(() => {
        expect(action()?.querySelector("[data-feed-pending]")).not.toBeNull();
      });
      expect(action()?.className ?? "").not.toContain("lg:sticky");
      release();
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      await vi.waitFor(() => {
        const column = action();
        expect(column?.querySelector("[data-feed-pending]")).toBeNull();
        expect(column?.className ?? "").toContain("lg:sticky");
      });
    } finally {
      release();
      await browser.viewport(width, height);
    }
  });

  test("a tall feed stays unstuck, and the header's Donate appears once Donate scrolls away", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const names = [
      "Mira",
      "Noor",
      "Owen",
      "Pia",
      "Quinn",
      "Rhea",
      "Soren",
      "Tove",
      "Uma",
      "Vera",
      "Willa",
      "Xena",
      "Yael",
      "Zora",
      "Alden",
      "Bram",
      "Cleo",
      "Dina",
    ];
    mswWorker.use(
      http.get("/api/npo/tall-npo/donors", async () => {
        await hold;
        return HttpResponse.json({
          items: names.map((name) => ({
            id: name,
            donor_name: name,
            donor_message: "For the clinic's winter fuel fund.",
            amount: 40,
            date: new Date().toISOString(),
          })),
          next: null,
        });
      })
    );
    const width = window.innerWidth;
    const height = window.innerHeight;
    // 1440 so every card is in the column; short enough that eighteen cards exceed innerHeight - 64
    await browser.viewport(1440, 720);
    try {
      const screen = await mount(
        page({
          donors: { id: "tall-npo", campaign_id: "camp-tall" },
          highlight: { name: "You", amount: "$25" },
        })
      );
      const action = () => document.querySelector("[data-col='action']");
      await vi.waitFor(() => {
        expect(action()?.querySelector("[data-feed-pending]")).not.toBeNull();
      });
      await expect.element(screen.getByText("You")).toBeVisible();
      expect(action()?.className ?? "").not.toContain("lg:sticky");
      release();
      await expect.element(screen.getByText("Dina")).toBeInTheDocument();
      await vi.waitFor(() => {
        const column = action();
        expect(column?.querySelector("[data-feed-pending]")).toBeNull();
        expect(column?.className ?? "").not.toContain("lg:sticky");
      });
      window.scrollTo(0, document.documentElement.scrollHeight);
      await expect
        .element(
          screen.getByRole("banner").getByRole("button", { name: "Donate" })
        )
        .toBeVisible();
    } finally {
      release();
      window.scrollTo(0, 0);
      await browser.viewport(width, height);
    }
  });
});
