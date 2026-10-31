import { LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
import { Layout } from "./layout";

vi.mock("#/hooks/use-session", () => ({
  use_session: () => ({
    session: undefined,
    is_loading: false,
    revalidate: vi.fn(),
  }),
}));

const link_groups = [
  {
    links: [
      {
        title: "Overview",
        to: "/dashboard",
        icon: { fn: LayoutDashboard, size: 18 },
        end: true,
      },
    ],
  },
];

afterEach(async () => {
  await cleanup();
  await reset_viewport();
});

describe("dashboard Layout", () => {
  // route focus looks for the first h1 inside `main`, and without one falls
  // back to the whole document — where the chrome's heading comes first
  test("the view renders inside the page's one main landmark, the chrome outside it", async () => {
    const Stub = createRoutesStub([
      {
        path: "/dashboard",
        Component: () => (
          <Layout linkGroups={link_groups} rootRoute="/dashboard" />
        ),
        children: [{ index: true, Component: () => <h1>Donations</h1> }],
      },
    ]);
    const screen = await render(<Stub initialEntries={["/dashboard"]} />);

    const heading = screen.getByRole("heading", { name: "Donations" });
    await expect.element(heading).toBeVisible();
    expect(screen.getByRole("main").elements()).toHaveLength(1);
    const main = screen.getByRole("main").element();
    expect(main.contains(heading.element())).toBe(true);
    expect(main.contains(screen.getByRole("banner").element())).toBe(false);
    expect(main.contains(screen.getByRole("contentinfo").element())).toBe(
      false
    );
  });

  function stub(header_context?: ReactNode) {
    return createRoutesStub([
      {
        path: "/dashboard",
        Component: () => (
          <Layout
            linkGroups={link_groups}
            rootRoute="/dashboard"
            headerContext={header_context}
          />
        ),
        children: [{ index: true, Component: () => <h1>Donations</h1> }],
      },
    ]);
  }

  test("the header context takes the logo's place in the app header", async () => {
    await page.viewport(1440, 900);
    const Stub = stub(<button type="button">Switch organization</button>);
    const screen = await render(<Stub initialEntries={["/dashboard"]} />);

    const ctx = screen.getByRole("button", { name: "Switch organization" });
    await expect.element(ctx).toBeVisible();
    const banner = screen.getByRole("banner");
    expect(banner.element().contains(ctx.element())).toBe(true);
    expect(banner.getByTitle("Go to Home page").query()).toBeNull();
  });

  test("at phone width the header context stays in the header, not the drawer", async () => {
    await page.viewport(390, 844);
    const Stub = stub(<button type="button">Switch organization</button>);
    const screen = await render(<Stub initialEntries={["/dashboard"]} />);

    const ctx = screen.getByRole("button", { name: "Switch organization" });
    await expect.element(ctx).toBeVisible();
    expect(screen.getByRole("banner").element().contains(ctx.element())).toBe(
      true
    );
    await screen.getByRole("button", { name: "Open Menu" }).click();
    const drawer = screen.getByRole("dialog", { name: "Dashboard menu" });
    expect(
      drawer.getByRole("button", { name: "Switch organization" }).query()
    ).toBeNull();
  });

  test("without a header context the logo stands alone", async () => {
    await page.viewport(1440, 900);
    const Stub = stub();
    const screen = await render(<Stub initialEntries={["/dashboard"]} />);

    const logo = screen.getByRole("banner").getByTitle("Go to Home page");
    await expect.element(logo).toBeInTheDocument();
  });
});
