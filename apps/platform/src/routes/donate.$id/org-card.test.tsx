import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import { OrgCard } from "./org-card";

afterEach(async () => {
  await cleanup();
  await reset_viewport();
});

const LONG_NAME =
  "Riverside Adult Literacy and Family Learning Coalition of the Three Counties";

function mount(name = "Riverside Literacy") {
  const Stub = createRoutesStub([
    {
      path: "/",
      // the route's container, which steps the card up from @xl
      Component: () => (
        <div className="@container/org-card">
          <OrgCard
            id={7}
            name={name}
            logo="data:image/gif;base64,R0lGODlhAQABAAAAACw="
            tagline="Every adult a reader."
            program={undefined}
          />
        </div>
      ),
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("donate page org card", () => {
  test.each([
    [390, 844],
    [1440, 900],
  ])("is the org's identity and links to its page at %i", async (w, h) => {
    await page.viewport(w, h);
    const screen = await mount();
    const name = screen.getByRole("link", { name: "Riverside Literacy" });
    await expect.element(name).toBeVisible();
    await expect.element(name).toHaveAttribute("href", "/org/7");
    await expect
      .element(screen.getByText("Every adult a reader.", { exact: true }))
      .toBeVisible();
  });

  test("the logo spans both rows of the first column, and a long name truncates in the second", async () => {
    await page.viewport(390, 844);
    const screen = await mount(LONG_NAME);
    const name = screen.getByRole("link", { name: LONG_NAME });
    const tagline = screen.getByText("Every adult a reader.", { exact: true });
    await expect.element(name).toBeVisible();
    const link = name.element() as HTMLElement;
    const card = link.parentElement as HTMLElement;
    const logo = card.querySelector("img") as HTMLElement;
    expect(getComputedStyle(card).gridTemplateColumns.split(" ")).toHaveLength(
      2
    );

    const l = logo.getBoundingClientRect();
    const n = link.getBoundingClientRect();
    const t = tagline.element().getBoundingClientRect();
    expect(n.left).toBeGreaterThanOrEqual(l.right);
    expect(t.left).toBe(n.left);
    expect(t.top).toBeGreaterThanOrEqual(n.bottom);
    expect(l.top).toBeLessThanOrEqual(n.top);

    // one line, clipped inside the card
    expect(link.scrollWidth).toBeGreaterThan(link.clientWidth);
    expect(n.right).toBeLessThanOrEqual(card.getBoundingClientRect().right);
  });
});
