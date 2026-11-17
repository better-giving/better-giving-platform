import { createRoutesStub, useNavigate, useParams } from "react-router";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Chips } from "./chips";

const chips = [
  "Givebutter",
  "Donorbox",
  "Zeffy",
  "Classy",
  "GoFundMe Pro",
  "Bloomerang",
  "Kindful",
  "Network for Good",
  "Fundraise Up",
  "Every.org",
].map((competitor) => ({
  slug: competitor.toLowerCase().replace(/[^a-z]+/g, "-"),
  competitor,
}));

// navigates from outside the row: a click on a chip would scroll it into view
// itself and hide whether the row recentres
function Page() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  return (
    <>
      <Chips chips={chips} current={slug} />
      <button
        type="button"
        onClick={() => navigate("/compare/network-for-good")}
      >
        Next page
      </button>
    </>
  );
}

async function render_at(slug: string) {
  await page.viewport(375, 800);
  const Stub = createRoutesStub([{ path: "/compare/:slug", Component: Page }]);
  const screen = await render(<Stub initialEntries={[`/compare/${slug}`]} />);
  await expect
    .element(screen.getByRole("link", { name: "Givebutter" }))
    .toBeVisible();
  const row = screen.getByRole("list").element() as HTMLUListElement;
  return { screen, row };
}

const next_frames = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("Chips below sm", () => {
  test("a swipe to the end of the row stays there", async () => {
    const { row } = await render_at("givebutter");
    const end = row.scrollWidth - row.clientWidth;
    expect(end).toBeGreaterThan(0);

    row.scrollLeft = end;
    await next_frames();
    await new Promise((r) => setTimeout(r, 300));
    expect(row.scrollLeft).toBeGreaterThan(end / 2);
  });

  test("a navigation that keeps the route mounted recentres the row", async () => {
    const { screen, row } = await render_at("givebutter");
    expect(row.scrollLeft).toBe(0);

    await screen.getByRole("button", { name: "Next page" }).click();
    await expect
      .element(screen.getByRole("link", { name: "Network for Good" }))
      .toHaveAttribute("aria-current", "page");
    await expect.poll(() => row.scrollLeft).toBeGreaterThan(0);

    const chip = screen.getByRole("listitem").nth(7).element() as HTMLElement;
    const centre = chip.offsetLeft + chip.clientWidth / 2;
    expect(
      Math.abs(row.scrollLeft + row.clientWidth / 2 - centre)
    ).toBeLessThan(2);
  });
});
