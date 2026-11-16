import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { page as browser } from "vitest/browser";
import { render } from "vitest-browser-react";
import { compare_chips, compare_page } from "#/content/compare/data";
import Page, { meta } from "./route";

const GB = compare_page("givebutter")!;

function render_slug(slug = "givebutter") {
  const page = compare_page(slug)!;
  const Stub = createRoutesStub([
    {
      path: "/compare/:slug",
      loader: () => ({ page, chips: compare_chips() }),
      Component: Page as never,
      HydrateFallback: () => null,
    },
    { path: "/register", Component: () => null },
    { path: "/pricing", Component: () => null },
  ]);
  return render(<Stub initialEntries={[`/compare/${slug}`]} />);
}

describe("compare page", () => {
  test("the feature table shows every core row, then the More on divider, then the rest", async () => {
    const screen = await render_slug();
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent(GB.h1);

    const rows = [...screen.container.querySelectorAll("table tbody tr")];
    const core = GB.rows.filter((r) => r.core);
    const more = GB.rows.filter((r) => !r.core);
    expect(rows).toHaveLength(core.length + 1 + more.length);
    expect(
      rows.slice(0, core.length).map((r) => r.querySelector("th")?.textContent)
    ).toEqual(core.map((r) => r.feature));
    expect(rows[core.length]?.textContent).toBe("More on Givebutter");
    expect(
      rows.slice(core.length + 1).map((r) => r.querySelector("th")?.textContent)
    ).toEqual(more.map((r) => r.feature));
  });

  test("a value carries its numbered source links, and the list they target is collapsed", async () => {
    const screen = await render_slug();
    const first = screen.container.querySelector("table tbody tr")!;
    const links = [...first.querySelectorAll("sup a")].map((a) =>
      a.getAttribute("href")
    );
    expect(links).toEqual(["#s1", "#s2", "#s3"]);

    const details = screen.container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelectorAll("li[id^='s']")).toHaveLength(
      GB.sources.length
    );
  });

  test("exactly one chip is current, and it is this page's", async () => {
    const screen = await render_slug();
    const current = screen.container.querySelectorAll(
      "nav[aria-labelledby='all-comparisons'] [aria-current='page']"
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Givebutter");
    expect(
      screen.container.querySelectorAll(
        "nav[aria-labelledby='all-comparisons'] a"
      )
    ).toHaveLength(18);
  });

  test("the visible FAQ questions are the json-ld questions", async () => {
    const screen = await render_slug();
    const visible = [
      ...screen.container.querySelectorAll("section h3 button"),
    ].map((b) => b.textContent);
    expect(visible).toEqual(GB.faq.map((f) => f.q));

    const ld = (
      meta({ loaderData: { page: GB, chips: compare_chips() } } as never) as {
        "script:ld+json"?: { mainEntity: { name: string }[] };
      }[]
    ).find((d) => d["script:ld+json"])?.["script:ld+json"];
    expect(ld?.mainEntity.map((m) => m.name)).toEqual(visible);
  });

  test("the first answer is open on a desktop viewport", async () => {
    await browser.viewport(1280, 800);
    const screen = await render_slug();
    await expect
      .element(screen.getByRole("button", { name: GB.faq[0].q }))
      .toHaveAttribute("aria-expanded", "true");
    await expect
      .element(screen.getByRole("button", { name: GB.faq[1].q }))
      .toHaveAttribute("aria-expanded", "false");
  });

  test("every row is closed on a phone viewport", async () => {
    await browser.viewport(375, 800);
    const screen = await render_slug();
    await expect
      .element(screen.getByRole("button", { name: GB.faq[0].q }))
      .toHaveAttribute("aria-expanded", "false");
  });

  test("the footer note reads the date in words and Tell us mails support", async () => {
    const screen = await render_slug();
    await expect
      .element(screen.getByText(/Last verified November 16, 2026\./))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Tell us" }))
      .toHaveAttribute("href", "mailto:support@better.giving");
  });

  test("the call to action asks once: no Book a demo", async () => {
    const screen = await render_slug();
    expect(screen.container.textContent).not.toContain("Book a demo");
    await expect
      .element(screen.getByRole("heading", { name: GB.h2.cta }))
      .toBeInTheDocument();
  });
});
