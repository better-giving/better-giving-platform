import { LayoutDashboard, Wallet } from "lucide-react";
import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { ToggleableSidebar } from "./toggleable-sidebar";

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
  {
    title: "Finances",
    links: [
      {
        title: "Payouts",
        to: "/dashboard/payouts",
        icon: { fn: Wallet, size: 18 },
      },
    ],
  },
];

describe("ToggleableSidebar", () => {
  test("opens as a dialog named for the menu, not for its first link group", async () => {
    const Stub = createRoutesStub([
      {
        path: "/dashboard",
        Component: () => (
          <ToggleableSidebar
            rootRoute="/"
            open
            linkGroups={link_groups}
            set_open={() => {}}
          />
        ),
      },
    ]);
    const screen = await render(<Stub initialEntries={["/dashboard"]} />);

    await expect
      .element(
        screen.getByRole("dialog", { name: "Dashboard menu", exact: true })
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Payouts" }))
      .toBeVisible();
  });
});
