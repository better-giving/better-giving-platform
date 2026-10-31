import { createRoutesStub, Meta, Outlet } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { meta } from "./route";

// the route module reaches the db through its loader, which this test never runs
vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("remix-client-cache", () => ({
  CacheRoute: (C: unknown) => C,
  createClientLoaderCache: () => undefined,
}));

const NAME = `Flood </script><script>alert(1)</script> & relief  `;

describe("fund page json-ld in the document", () => {
  test("a name that closes the script tag stays inside one json-ld script", async () => {
    const fund = {
      id: "f-1",
      name: NAME,
      description_pt: "[]",
      banner: "https://img.co/banner.png",
      published: true,
      active: true,
      donation_total_usd: 0,
      members: [
        {
          id: 4,
          slug: undefined,
          name: NAME,
          logo: undefined,
          banner: undefined,
        },
      ],
    };
    const Stub = createRoutesStub([
      {
        id: "root",
        Component: () => (
          <>
            <Meta />
            <Outlet />
          </>
        ),
        children: [
          {
            id: "fund",
            path: "/campaigns/:fund_id",
            loader: () => fund,
            meta: meta as never,
            Component: () => <p>fund page</p>,
          },
        ],
      },
    ]);

    const screen = await render(<Stub initialEntries={["/campaigns/f-1"]} />);
    await expect.element(screen.getByText("fund page")).toBeVisible();

    // the markup as a server would send it: a client render sets the script's
    // text directly, so only a reparse shows whether the name breaks out
    const sent = new DOMParser().parseFromString(
      screen.container.innerHTML,
      "text/html"
    );
    const scripts = sent.querySelectorAll("script");
    const ld = [...scripts].filter((s) => s.type === "application/ld+json");
    expect(scripts).toHaveLength(ld.length);
    expect(ld).toHaveLength(1);
    const parsed = JSON.parse(ld[0]!.textContent ?? "");
    expect(parsed.name).toBe(NAME);
    expect(parsed.about.parentOrganization.name).toBe(NAME);
  });
});
