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

function mount() {
  const Stub = createRoutesStub([
    {
      path: "/",
      // the route's container, which steps the card up from @xl
      Component: () => (
        <div className="@container/org-card">
          <OrgCard
            id={7}
            name="Riverside Literacy"
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
  ])(
    "is the org's identity and links to its page, with no goal, at %i",
    async (w, h) => {
      await page.viewport(w, h);
      const screen = await mount();
      const name = screen.getByRole("link", { name: "Riverside Literacy" });
      await expect.element(name).toBeVisible();
      await expect.element(name).toHaveAttribute("href", "/org/7");
      await expect
        .element(screen.getByText("Every adult a reader.", { exact: true }))
        .toBeVisible();
      expect(screen.getByRole("progressbar").query()).toBeNull();
      expect(screen.container).not.toMatchTextContent(/goal|raised|\$/i);
    }
  );
});
