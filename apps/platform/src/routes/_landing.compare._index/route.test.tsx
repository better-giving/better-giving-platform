import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import {
  compare_generated,
  compare_index,
  compare_pages,
} from "#/content/compare/data";
import Page, { meta } from "./route";

function render_index() {
  const Stub = createRoutesStub([
    {
      path: "/compare",
      loader: () => ({ index: compare_index, verified: compare_generated }),
      Component: Page as never,
      HydrateFallback: () => null,
    },
    { path: "/compare/:slug", Component: () => null },
  ]);
  return render(<Stub initialEntries={["/compare"]} />);
}

describe("compare index", () => {
  test("hero and the four section headings read as written", async () => {
    const screen = await render_index();
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent(
        "Better Giving compared with 18 fundraising platforms"
      );
    const h2s = [...screen.container.querySelectorAll("h2")].map(
      (h) => h.textContent
    );
    expect(h2s).toEqual([
      "Better Giving vs other fundraising platforms",
      "What Better Giving includes for nonprofits",
      "Switching to Better Giving in three steps",
      "Fundraising platform comparison FAQs",
      "Getting started with Better Giving",
    ]);
  });

  test("eighteen cards link to the eighteen comparisons and carry no description", async () => {
    const screen = await render_index();
    const cards = [
      ...screen.container.querySelectorAll("a[href^='/compare/']"),
    ];
    expect(cards.map((a) => a.getAttribute("href"))).toEqual(
      compare_pages.map((p) => `/compare/${p.slug}`)
    );
    expect(cards.map((a) => a.textContent)).toEqual(
      compare_pages.map((p) => p.competitor)
    );
  });

  test("the sources list is numbered by first appearance and collapsed", async () => {
    const screen = await render_index();
    const details = screen.container.querySelector("details")!;
    expect(details.open).toBe(false);
    const titles = [...details.querySelectorAll("li")].map(
      (li) => li.textContent
    );
    expect(titles[0]).toBe("Better Giving pricing");
    expect(titles).toHaveLength(new Set(titles).size);
    // every superscript points at an entry that exists
    for (const a of screen.container.querySelectorAll("sup a")) {
      const id = a.getAttribute("href")!.slice(1);
      expect(details.querySelector(`#${id}`), id).not.toBeNull();
    }
  });

  test("the visible FAQ questions are the json-ld questions", async () => {
    const screen = await render_index();
    const visible = [
      ...screen.container.querySelectorAll("section h3 button"),
    ].map((b) => b.textContent);
    expect(visible).toEqual(compare_index.faq.map((f) => f.q));
    const ld = (
      meta({
        loaderData: { index: compare_index, verified: compare_generated },
      } as never) as { "script:ld+json"?: { mainEntity: { name: string }[] } }[]
    ).find((d) => d["script:ld+json"])?.["script:ld+json"];
    expect(ld?.mainEntity.map((m) => m.name)).toEqual(visible);
  });

  test("the footer note reads the date in words", async () => {
    const screen = await render_index();
    await expect
      .element(screen.getByText(/Last verified November 16, 2026\./))
      .toBeInTheDocument();
  });
});
