import { HttpResponse, http } from "msw";
import { SWRConfig } from "swr";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { mswWorker } from "#/setup-tests-browser";
import { DonorMsgs, type IDonorHighlight } from "./donor-msgs";

const HOUR = 3_600_000;

function hours_ago(hours: number) {
  return new Date(Date.now() - hours * HOUR - 60_000).toISOString();
}

function same_local_day(iso: string) {
  const then = new Date(iso);
  const now = new Date();
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  );
}

function days_ago(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(15, 0, 0, 0);
  return d.toISOString();
}

function row(
  name: string,
  extra: { amount?: number; message?: string | null; date?: string } = {}
) {
  return {
    id: name,
    donor_name: name,
    donor_message: extra.message ?? null,
    amount: extra.amount,
    date: extra.date,
  };
}

function donors(
  id: string,
  pages: Record<
    string,
    { items: ReturnType<typeof row>[]; next: string | null }
  >
) {
  mswWorker.use(
    http.get(`/api/npo/${id}/donors`, ({ request }) => {
      const key = new URL(request.url).searchParams.get("next") ?? "";
      const body = pages[key] ?? { items: [], next: null };
      return HttpResponse.json(body);
    })
  );
}

function mount(
  id: string,
  props: {
    layout?: "wall" | "feed";
    highlight?: IDonorHighlight;
    campaign_id?: string;
  } = {}
) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <DonorMsgs id={id} {...props} />
    </SWRConfig>
  );
}

function hold_open() {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold, release: () => release() };
}

type Screen = Awaited<ReturnType<typeof mount>>;

async function expect_loading_donors(screen: Screen) {
  const loading = screen.getByRole("button", {
    name: "Loading donors",
    exact: true,
  });
  await expect.element(loading).toHaveAttribute("aria-busy", "true");
  await expect.element(loading).toHaveAttribute("aria-disabled", "true");
  await expect.element(loading).not.toHaveAttribute("disabled");
  await expect.element(loading).toHaveFocus();
  return loading;
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

function fail_donors(id: string) {
  mswWorker.use(
    http.get(`/api/npo/${id}/donors`, () =>
      HttpResponse.json({ message: "unavailable" }, { status: 500 })
    )
  );
}

describe("donor messages", () => {
  test("the wall keeps the card, the heading, and View more", async () => {
    donors("wall-1", {
      "": {
        items: [
          row("Ada Lovelace", {
            amount: 40,
            message: "For the Tuesday stew.",
            date: hours_ago(2),
          }),
        ],
        next: "page-2",
      },
      "page-2": { items: [row("Grace Hopper", { amount: 15 })], next: null },
    });
    const screen = await mount("wall-1");
    await expect
      .element(screen.getByRole("heading", { name: "Donors" }))
      .toBeVisible();
    expect(
      screen
        .getByRole("heading", { name: "Recent supporters", exact: true })
        .query()
    ).toBeNull();
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await expect
      .element(screen.getByText("For the Tuesday stew."))
      .toBeVisible();
    expect(screen.getByText("$40").query()).toBeNull();
    expect(screen.getByText("2 hours ago").query()).toBeNull();
    expect(document.querySelector("article")).toBeNull();
    expect(document.querySelector(".card")).not.toBeNull();
    await screen.getByRole("button", { name: "View more" }).click();
    await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "See all donors" }).query()
    ).toBeNull();
  });

  test("a feed card shows the amount, the message, and a relative time", async () => {
    const ada_date = hours_ago(2);
    // calendar day wins: two hours ago reads Yesterday once local midnight has passed
    const ada_time = same_local_day(ada_date) ? "2 hours ago" : "Yesterday";
    donors("feed-1", {
      "": {
        items: [
          row("Ada Lovelace", {
            amount: 40,
            message: "For the Tuesday stew.",
            date: ada_date,
          }),
          row("Grace Hopper", { amount: 15, date: days_ago(1) }),
          row("Katherine Johnson", {
            amount: 1250,
            message: "Still cooking.",
            date: days_ago(3),
          }),
          row("Quiet Donor", { amount: 8 }),
        ],
        next: null,
      },
    });
    const screen = await mount("feed-1", { layout: "feed" });
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    const gift = screen.getByText("$40");
    await expect.element(gift).toBeVisible();
    expect(gift.element().className).toContain("font-bold");
    expect(gift.element().className).toContain("text-success-subtle-fg");
    await expect
      .element(screen.getByText("For the Tuesday stew."))
      .toBeVisible();
    const ada = screen.getByText("Ada Lovelace").element().closest("article");
    if (!ada) throw new Error("ada card missing");
    await expect
      .element(page.elementLocator(ada).getByText(ada_time))
      .toBeVisible();
    const grace = screen.getByText("Grace Hopper").element().closest("article");
    if (!grace) throw new Error("grace card missing");
    await expect
      .element(page.elementLocator(grace).getByText("Yesterday"))
      .toBeVisible();
    await expect.element(screen.getByText("3 days ago")).toBeVisible();
    await expect.element(screen.getByText("$1,250")).toBeVisible();
    const quiet = screen.getByText("Quiet Donor").element().closest("article");
    expect(quiet?.textContent).toBe("Quiet Donor$8");
    const card = screen.getByText("Ada Lovelace").element().closest("article");
    // a supporter sits on the ground, so it is a white card with no edge
    expect(card?.classList.contains("card")).toBe(true);
    expect(card?.classList.contains("border")).toBe(false);
    expect(card?.classList.contains("bg-gray-2")).toBe(false);
    const heading = screen.getByRole("heading", {
      name: "Recent supporters",
      exact: true,
    });
    await expect.element(heading).toBeVisible();
    if (!card) throw new Error("ada card missing");
    expect(
      heading.element().compareDocumentPosition(card) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Donors" }).query()).toBeNull();
  });

  test("the highlight card puts the amount on the name row", async () => {
    donors("feed-you", { "": { items: [], next: null } });
    const screen = await mount("feed-you", {
      layout: "feed",
      highlight: { name: "You", amount: "$25" },
    });
    await expect.element(screen.getByText("You")).toBeVisible();
    const heading = screen.getByRole("heading", {
      name: "Recent supporters",
      exact: true,
    });
    await expect.element(heading).toBeVisible();
    const gift = screen.getByText("$25");
    await expect.element(gift).toBeVisible();
    expect(gift.element().className).toContain("font-bold");
    expect(gift.element().className).toContain("text-success-subtle-fg");
    await expect.element(screen.getByText("Just now")).toBeVisible();
    const card = screen.getByText("You").element().closest("article");
    if (!card) throw new Error("highlight card missing");
    expect(
      heading.element().compareDocumentPosition(card) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(card?.classList.contains("bg-green-3")).toBe(true);
    expect(card?.classList.contains("border-green-6")).toBe(true);
    expect(card?.textContent).toBe("You$25Just now");
    await vi.waitFor(() => {
      expect(document.querySelector("[data-feed-pending]")).toBeNull();
    });
    expect(screen.getByText("Couldn't load donors.").query()).toBeNull();
  });

  test("under 1440px six cards show, and See all reveals the rest", async () => {
    await page.viewport(390, 800);
    const names = ["Mira", "Noor", "Owen", "Pia", "Quinn", "Rhea", "Soren"];
    donors("feed-cap", {
      "": {
        items: names.map((name) =>
          row(name, { amount: 10, date: hours_ago(5) })
        ),
        next: null,
      },
    });
    const screen = await mount("feed-cap", {
      layout: "feed",
      highlight: { name: "You", amount: "$25" },
    });
    await expect.element(screen.getByText("You")).toBeVisible();
    await expect.element(screen.getByText("Quinn")).toBeVisible();
    const hidden = screen.getByText("Rhea").element().closest("article");
    expect(hidden?.className).toContain("hidden");
    expect(hidden?.className).toContain("min-[1440px]:flex");
    await expect.element(screen.getByText("Rhea")).not.toBeVisible();
    await expect.element(screen.getByText("Soren")).not.toBeVisible();
    const see_all = screen.getByRole("button", { name: "See all donors" });
    await expect.element(see_all).toBeVisible();
    await page.viewport(1440, 900);
    await expect.element(screen.getByText("Soren")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "See all donors" }).query()
    ).toBeNull();
    await page.viewport(390, 800);
    await screen.getByRole("button", { name: "See all donors" }).click();
    await expect.element(screen.getByText("Soren")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "See all donors" }).query()
    ).toBeNull();
  });

  test("at 1440px every loaded card shows, and See all pages while next is set", async () => {
    await page.viewport(1440, 900);
    const names = ["Mira", "Noor", "Owen", "Pia", "Quinn", "Rhea", "Soren"];
    donors("feed-wide", {
      "": {
        items: names.map((name) => row(name, { amount: 10 })),
        next: "page-2",
      },
      "page-2": { items: [row("Tove", { amount: 12 })], next: null },
    });
    const screen = await mount("feed-wide", { layout: "feed" });
    await expect.element(screen.getByText("Soren")).toBeVisible();
    const see_all = screen.getByRole("button", { name: "See all donors" });
    await expect.element(see_all).toBeVisible();
    await see_all.click();
    await expect.element(screen.getByText("Tove")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "See all donors" }).query()
    ).toBeNull();
  });

  test("a failed first load offers Retry and then shows the donors", async () => {
    fail_donors("wall-fail");
    const screen = await mount("wall-fail");
    await expect
      .element(screen.getByText("Couldn't load donors."))
      .toBeVisible();
    const retry = screen.getByRole("button", { name: "Retry", exact: true });
    await expect.element(retry).toBeVisible();
    donors("wall-fail", {
      "": { items: [row("Ada Lovelace", { amount: 40 })], next: null },
    });
    await retry.click();
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await expect
      .element(screen.getByText("Couldn't load donors."))
      .not.toBeInTheDocument();
  });

  test("a failed feed keeps the highlight and drops the pending marker", async () => {
    fail_donors("feed-fail-you");
    const screen = await mount("feed-fail-you", {
      layout: "feed",
      highlight: { name: "You", amount: "$25" },
    });
    const heading = screen.getByRole("heading", {
      name: "Recent supporters",
      exact: true,
    });
    await expect.element(heading).toBeVisible();
    await expect.element(screen.getByText("You")).toBeVisible();
    const message = screen.getByText("Couldn't load donors.");
    await expect.element(message).toBeVisible();
    const card = screen.getByText("You").element().closest("article");
    if (!card) throw new Error("highlight card missing");
    expect(
      heading.element().compareDocumentPosition(card) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      card.compareDocumentPosition(message.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry", exact: true });
    expect(
      heading.element().compareDocumentPosition(retry.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(document.querySelector("[data-feed-pending]")).toBeNull();
    await expect
      .element(screen.getByRole("button", { name: "Retry", exact: true }))
      .toBeVisible();
  });

  test("a failed feed without a highlight shows the error instead of the pending marker", async () => {
    fail_donors("feed-fail");
    const screen = await mount("feed-fail", { layout: "feed" });
    const heading = screen.getByRole("heading", {
      name: "Recent supporters",
      exact: true,
    });
    await expect.element(heading).toBeVisible();
    const message = screen.getByText("Couldn't load donors.");
    await expect.element(message).toBeVisible();
    const retry = screen.getByRole("button", { name: "Retry", exact: true });
    await expect.element(retry).toBeVisible();
    expect(
      heading.element().compareDocumentPosition(message.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      heading.element().compareDocumentPosition(retry.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(document.querySelector("[data-feed-pending]")).toBeNull();
    expect(screen.getByRole("heading", { name: "Donors" }).query()).toBeNull();
  });

  test("a feed without a highlight stays pending until donors arrive", async () => {
    const pending = hold_open();
    mswWorker.use(
      http.get("/api/npo/feed-pending/donors", async () => {
        await pending.hold;
        return HttpResponse.json({
          items: [row("Ada Lovelace", { amount: 40 })],
          next: null,
        });
      })
    );
    try {
      const screen = await mount("feed-pending", { layout: "feed" });
      const marker = document.querySelector("[data-feed-pending]");
      expect(marker).not.toBeNull();
      expect((marker as HTMLElement).hidden).toBe(true);
      expect(marker?.textContent ?? "").not.toContain("Recent supporters");
      expect(
        screen
          .getByRole("heading", { name: "Recent supporters", exact: true })
          .query()
      ).toBeNull();
      expect(screen.getByText("Couldn't load donors.").query()).toBeNull();
      pending.release();
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      const heading = screen.getByRole("heading", {
        name: "Recent supporters",
        exact: true,
      });
      await expect.element(heading).toBeVisible();
      expect(document.querySelector("[data-feed-pending]")).toBeNull();
    } finally {
      pending.release();
    }
  });

  test("a pending feed with a highlight shows Recent supporters above the card", async () => {
    const pending = hold_open();
    mswWorker.use(
      http.get("/api/npo/feed-pending-you/donors", async () => {
        await pending.hold;
        return HttpResponse.json({ items: [], next: null });
      })
    );
    try {
      const screen = await mount("feed-pending-you", {
        layout: "feed",
        highlight: { name: "You", amount: "$25" },
      });
      const heading = screen.getByRole("heading", {
        name: "Recent supporters",
        exact: true,
      });
      await expect.element(heading).toBeVisible();
      const card = screen.getByText("You").element().closest("article");
      if (!card) throw new Error("highlight card missing");
      expect(
        heading.element().compareDocumentPosition(card) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      const marker = document.querySelector("[data-feed-pending]");
      expect(marker).not.toBeNull();
      expect((marker as HTMLElement).hidden).toBe(false);
      expect(
        screen.getByRole("heading", { name: "Donors" }).query()
      ).toBeNull();
      expect(document.activeElement).not.toBe(heading.element());
    } finally {
      pending.release();
    }
  });

  test("View more says Loading donors until the next page arrives", async () => {
    const held = hold_open();
    let next_hits = 0;
    mswWorker.use(
      http.get("/api/npo/wall-more/donors", async ({ request }) => {
        const key = new URL(request.url).searchParams.get("next") ?? "";
        if (key === "") {
          return HttpResponse.json({
            items: [row("Ada Lovelace", { amount: 40 })],
            next: "page-2",
          });
        }
        next_hits += 1;
        await held.hold;
        return HttpResponse.json({
          items: [row("Grace Hopper", { amount: 15 })],
          next: "page-3",
        });
      })
    );
    try {
      const screen = await mount("wall-more");
      await screen
        .getByRole("button", { name: "View more", exact: true })
        .click();
      const loading = await expect_loading_donors(screen);
      expect(
        loading.element().querySelector(".animate-spin.icon-md")
      ).not.toBeNull();
      await vi.waitFor(() => expect(next_hits).toBe(1));
      (loading.element() as HTMLElement).click();
      await tick();
      expect(next_hits).toBe(1);
      held.release();
      await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
      const again = screen.getByRole("button", {
        name: "View more",
        exact: true,
      });
      await expect.element(again).toBeEnabled();
      await expect
        .element(
          screen.getByRole("button", { name: "Loading donors", exact: true })
        )
        .not.toBeInTheDocument();
    } finally {
      held.release();
    }
  });

  test("See all donors says Loading donors until the next page arrives", async () => {
    await page.viewport(1440, 900);
    const next = hold_open();
    let next_hits = 0;
    mswWorker.use(
      http.get("/api/npo/feed-more/donors", async ({ request }) => {
        const key = new URL(request.url).searchParams.get("next") ?? "";
        if (key === "") {
          return HttpResponse.json({
            items: [row("Ada Lovelace", { amount: 40 })],
            next: "page-2",
          });
        }
        next_hits += 1;
        await next.hold;
        return HttpResponse.json({
          items: [row("Grace Hopper", { amount: 15 })],
          next: "page-3",
        });
      })
    );
    try {
      const screen = await mount("feed-more", { layout: "feed" });
      await screen
        .getByRole("button", { name: "See all donors", exact: true })
        .click();
      const loading = await expect_loading_donors(screen);
      const heading = screen.getByRole("heading", {
        name: "Recent supporters",
        exact: true,
      });
      await expect.element(heading).toBeVisible();
      expect(
        heading.element().compareDocumentPosition(loading.element()) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(document.activeElement).toBe(loading.element());
      expect(
        loading.element().querySelector(".animate-spin.icon-md")
      ).not.toBeNull();
      await vi.waitFor(() => expect(next_hits).toBe(1));
      (loading.element() as HTMLElement).click();
      await tick();
      expect(next_hits).toBe(1);
      next.release();
      await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
      const again = screen.getByRole("button", {
        name: "See all donors",
        exact: true,
      });
      await expect.element(again).toBeEnabled();
    } finally {
      next.release();
    }
  });

  test("a failed next page keeps the donors and Retry loads that same page", async () => {
    let page_hits = 0;
    mswWorker.use(
      http.get("/api/npo/wall-page/donors", ({ request }) => {
        const key = new URL(request.url).searchParams.get("next") ?? "";
        if (key === "") {
          return HttpResponse.json({
            items: [
              row("Ada Lovelace", {
                amount: 40,
                message: "For the Tuesday stew.",
              }),
            ],
            next: "cursor-9",
          });
        }
        page_hits += 1;
        if (page_hits === 1) {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        return HttpResponse.json({
          items: [row("Grace Hopper", { amount: 15 })],
          next: null,
        });
      })
    );
    const screen = await mount("wall-page");
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await screen
      .getByRole("button", { name: "View more", exact: true })
      .click();
    await expect
      .element(screen.getByText("Couldn't load donors."))
      .toBeVisible();
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await expect
      .element(screen.getByText("For the Tuesday stew."))
      .toBeVisible();
    const retry = screen.getByRole("button", { name: "Retry", exact: true });
    await expect.element(retry).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "View more", exact: true }))
      .toBeEnabled();
    await retry.click();
    await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await expect
      .element(screen.getByText("Couldn't load donors."))
      .not.toBeInTheDocument();
    expect(page_hits).toBe(2);
  });

  test("a failed next page does not follow the wall to another organization", async () => {
    const next_for = { a: [] as string[], b: [] as string[] };
    let b_page_hits = 0;
    mswWorker.use(
      http.get("/api/npo/wall-stale-a/donors", ({ request }) => {
        const key = new URL(request.url).searchParams.get("next") ?? "";
        if (key === "") {
          return HttpResponse.json({
            items: [row("Ada Lovelace", { amount: 40 })],
            next: "cursor-a",
          });
        }
        next_for.a.push(key);
        return HttpResponse.json({ message: "unavailable" }, { status: 500 });
      }),
      http.get("/api/npo/wall-stale-b/donors", ({ request }) => {
        const key = new URL(request.url).searchParams.get("next") ?? "";
        if (key === "") {
          return HttpResponse.json({
            items: [row("Grace Hopper", { amount: 15 })],
            next: "cursor-b",
          });
        }
        b_page_hits += 1;
        next_for.b.push(key);
        if (b_page_hits === 1) {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        return HttpResponse.json({
          items: [row("Katherine Johnson", { amount: 12 })],
          next: null,
        });
      })
    );
    const screen = await mount("wall-stale-a");
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await screen
      .getByRole("button", { name: "View more", exact: true })
      .click();
    await expect
      .element(screen.getByText("Couldn't load donors."))
      .toBeVisible();
    expect(next_for.a).toEqual(["cursor-a"]);

    await screen.rerender(
      <SWRConfig
        value={{ provider: () => new Map(), shouldRetryOnError: false }}
      >
        <DonorMsgs id="wall-stale-b" />
      </SWRConfig>
    );

    await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
    await expect
      .element(screen.getByText("Ada Lovelace"))
      .not.toBeInTheDocument();
    expect(screen.getByText("Couldn't load donors.").query()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Retry", exact: true }).query()
    ).toBeNull();
    expect(next_for.b).toEqual([]);

    await screen
      .getByRole("button", { name: "View more", exact: true })
      .click();
    await expect
      .element(screen.getByText("Couldn't load donors."))
      .toBeVisible();
    await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
    await screen.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.element(screen.getByText("Katherine Johnson")).toBeVisible();
    expect(next_for.b).toEqual(["cursor-b", "cursor-b"]);
  });

  test("a failed See all donors keeps the donors and Retry loads that same page", async () => {
    await page.viewport(1440, 900);
    let page_hits = 0;
    mswWorker.use(
      http.get("/api/npo/feed-page/donors", ({ request }) => {
        const key = new URL(request.url).searchParams.get("next") ?? "";
        if (key === "") {
          return HttpResponse.json({
            items: [row("Ada Lovelace", { amount: 40 })],
            next: "cursor-9",
          });
        }
        page_hits += 1;
        if (page_hits === 1) {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        return HttpResponse.json({
          items: [row("Grace Hopper", { amount: 15 })],
          next: null,
        });
      })
    );
    const screen = await mount("feed-page", { layout: "feed" });
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await screen
      .getByRole("button", { name: "See all donors", exact: true })
      .click();
    await expect
      .element(screen.getByText("Couldn't load donors."))
      .toBeVisible();
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await screen.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
    await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
    await expect
      .element(screen.getByText("Couldn't load donors."))
      .not.toBeInTheDocument();
    expect(page_hits).toBe(2);
  });

  test("a failed first load's Retry says Loading donors until the donors arrive", async () => {
    const held = hold_open();
    let hits = 0;
    mswWorker.use(
      http.get("/api/npo/wall-retry-hold/donors", async () => {
        hits += 1;
        if (hits === 1) {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        await held.hold;
        return HttpResponse.json({
          items: [row("Ada Lovelace", { amount: 40 })],
          next: null,
        });
      })
    );
    try {
      const screen = await mount("wall-retry-hold");
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      await screen.getByRole("button", { name: "Retry", exact: true }).click();
      const loading = await expect_loading_donors(screen);
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      await vi.waitFor(() => expect(hits).toBe(2));
      (loading.element() as HTMLElement).click();
      await tick();
      expect(hits).toBe(2);
      await expect.element(loading).toHaveFocus();
      held.release();
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .not.toBeInTheDocument();
    } finally {
      held.release();
    }
  });

  test("a failed first load's Retry returns to Retry when the request fails again", async () => {
    const held = hold_open();
    let hits = 0;
    mswWorker.use(
      http.get("/api/npo/wall-retry-again/donors", async () => {
        hits += 1;
        if (hits === 1) {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        await held.hold;
        return HttpResponse.json({ message: "unavailable" }, { status: 500 });
      })
    );
    try {
      const screen = await mount("wall-retry-again");
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      await screen.getByRole("button", { name: "Retry", exact: true }).click();
      await expect_loading_donors(screen);
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      held.release();
      const retry = screen.getByRole("button", { name: "Retry", exact: true });
      await expect.element(retry).toBeVisible();
      await expect.element(retry).toHaveFocus();
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      await expect
        .element(
          screen.getByRole("button", { name: "Loading donors", exact: true })
        )
        .not.toBeInTheDocument();
    } finally {
      held.release();
    }
  });

  test("a failed next page's Retry stays put and says Loading donors", async () => {
    let page_hits = 0;
    let outcome: "fail" | "ok" = "fail";
    const gate = { current: hold_open() };
    mswWorker.use(
      http.get("/api/npo/wall-page-hold/donors", async ({ request }) => {
        const key = new URL(request.url).searchParams.get("next") ?? "";
        if (key === "") {
          return HttpResponse.json({
            items: [
              row("Ada Lovelace", {
                amount: 40,
                message: "For the Tuesday stew.",
              }),
            ],
            next: "cursor-9",
          });
        }
        page_hits += 1;
        if (page_hits === 1) {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        await gate.current.hold;
        if (outcome === "fail") {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        return HttpResponse.json({
          items: [row("Grace Hopper", { amount: 15 })],
          next: null,
        });
      })
    );
    try {
      const screen = await mount("wall-page-hold");
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      await screen
        .getByRole("button", { name: "View more", exact: true })
        .click();
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      await expect
        .element(screen.getByText("For the Tuesday stew."))
        .toBeVisible();
      await screen.getByRole("button", { name: "Retry", exact: true }).click();
      await vi.waitFor(() => expect(page_hits).toBe(2));
      const loading = await expect_loading_donors(screen);
      expect(loading.elements().length).toBe(1);
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      const more = screen.getByRole("button", {
        name: "View more",
        exact: true,
      });
      await expect.element(more).toBeEnabled();
      await expect.element(more).not.toHaveAttribute("disabled");
      (loading.element() as HTMLElement).click();
      await tick();
      expect(page_hits).toBe(2);
      await expect.element(loading).toHaveFocus();
      gate.current.release();
      const retry = screen.getByRole("button", { name: "Retry", exact: true });
      await expect.element(retry).toHaveFocus();
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      await expect
        .element(
          screen.getByRole("button", { name: "Loading donors", exact: true })
        )
        .not.toBeInTheDocument();
      outcome = "ok";
      gate.current = hold_open();
      await retry.click();
      await vi.waitFor(() => expect(page_hits).toBe(3));
      await expect_loading_donors(screen);
      expect(
        screen
          .getByRole("button", { name: "Loading donors", exact: true })
          .elements().length
      ).toBe(1);
      const again = screen.getByRole("button", {
        name: "View more",
        exact: true,
      });
      await expect.element(again).toBeEnabled();
      await again.click();
      await tick();
      expect(page_hits).toBe(3);
      expect(
        screen
          .getByRole("button", { name: "Loading donors", exact: true })
          .elements().length
      ).toBe(1);
      gate.current.release();
      await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Retry", exact: true }).query()
      ).toBeNull();
      expect(screen.getByText("Grace Hopper").elements().length).toBe(1);
    } finally {
      gate.current.release();
    }
  });

  test("a failed See all donors Retry stays put and says Loading donors", async () => {
    await page.viewport(1440, 900);
    let page_hits = 0;
    let outcome: "fail" | "ok" = "fail";
    const gate = { current: hold_open() };
    mswWorker.use(
      http.get("/api/npo/feed-page-hold/donors", async ({ request }) => {
        const key = new URL(request.url).searchParams.get("next") ?? "";
        if (key === "") {
          return HttpResponse.json({
            items: [row("Ada Lovelace", { amount: 40 })],
            next: "cursor-9",
          });
        }
        page_hits += 1;
        if (page_hits === 1) {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        await gate.current.hold;
        if (outcome === "fail") {
          return HttpResponse.json({ message: "unavailable" }, { status: 500 });
        }
        return HttpResponse.json({
          items: [row("Grace Hopper", { amount: 15 })],
          next: null,
        });
      })
    );
    try {
      const screen = await mount("feed-page-hold", { layout: "feed" });
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      await screen
        .getByRole("button", { name: "See all donors", exact: true })
        .click();
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      await screen.getByRole("button", { name: "Retry", exact: true }).click();
      await vi.waitFor(() => expect(page_hits).toBe(2));
      const loading = await expect_loading_donors(screen);
      expect(loading.elements().length).toBe(1);
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      const more = screen.getByRole("button", {
        name: "See all donors",
        exact: true,
      });
      await expect.element(more).toBeEnabled();
      await expect.element(more).not.toHaveAttribute("disabled");
      (loading.element() as HTMLElement).click();
      await tick();
      expect(page_hits).toBe(2);
      await expect.element(loading).toHaveFocus();
      gate.current.release();
      const retry = screen.getByRole("button", { name: "Retry", exact: true });
      await expect.element(retry).toHaveFocus();
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .toBeVisible();
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      await expect
        .element(
          screen.getByRole("button", { name: "Loading donors", exact: true })
        )
        .not.toBeInTheDocument();
      outcome = "ok";
      gate.current = hold_open();
      await retry.click();
      await vi.waitFor(() => expect(page_hits).toBe(3));
      await expect_loading_donors(screen);
      expect(
        screen
          .getByRole("button", { name: "Loading donors", exact: true })
          .elements().length
      ).toBe(1);
      const again = screen.getByRole("button", {
        name: "See all donors",
        exact: true,
      });
      await expect.element(again).toBeEnabled();
      await again.click();
      await tick();
      expect(page_hits).toBe(3);
      expect(
        screen
          .getByRole("button", { name: "Loading donors", exact: true })
          .elements().length
      ).toBe(1);
      gate.current.release();
      await expect.element(screen.getByText("Grace Hopper")).toBeVisible();
      await expect.element(screen.getByText("Ada Lovelace")).toBeVisible();
      await expect
        .element(screen.getByText("Couldn't load donors."))
        .not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Retry", exact: true }).query()
      ).toBeNull();
      expect(screen.getByText("Grace Hopper").elements().length).toBe(1);
    } finally {
      gate.current.release();
    }
  });
});
