import {
  Heart,
  LayoutDashboard,
  ListCheck,
  PiggyBankIcon,
  ReceiptIcon,
} from "lucide-react";
import { createRoutesStub } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { LinkGroup } from "../types";
import { SidebarOpener } from "./sidebar-opener";

const link_groups: LinkGroup[] = [
  {
    links: [
      { title: "Dashboard", to: "dashboard", icon: { fn: LayoutDashboard } },
      { title: "Donors", to: "donors", icon: { fn: Heart } },
      {
        title: "Programs",
        to: "programs",
        nests: ["program-editor"],
        icon: { fn: ListCheck },
      },
    ],
  },
  {
    links: [
      { title: "Savings", to: "savings", icon: { fn: PiggyBankIcon } },
      { title: "Savings log", to: "savings/log", icon: { fn: ReceiptIcon } },
    ],
  },
];

const opener_at = async (path: string) => {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/*",
      Component: () => (
        <SidebarOpener linkGroups={link_groups} rootRoute="/admin/:id/" />
      ),
    },
  ]);
  const screen = await render(<Stub initialEntries={[path]} />);
  // scoped to this render: a test that renders twice keeps both mounted
  return screen.locator.getByRole("button");
};

describe("SidebarOpener names the page's sidebar destination", () => {
  test("a sidebar destination reads its own link", async () => {
    await expect
      .element(await opener_at("/admin/1/donors"))
      .toHaveTextContent("Donors");
  });

  test("a page nested under a link's path reads that link", async () => {
    await expect
      .element(await opener_at("/admin/1/dashboard/grants"))
      .toHaveTextContent("Dashboard");
    await expect
      .element(await opener_at("/admin/1/donors/donor@example.com"))
      .toHaveTextContent("Donors");
  });

  test("the longest link prefixing the path wins over its ancestor", async () => {
    await expect
      .element(await opener_at("/admin/1/savings/log/2026"))
      .toHaveTextContent("Savings log");
    await expect
      .element(await opener_at("/admin/1/savings/deposit"))
      .toHaveAccessibleName("Savings");
  });

  test("a page whose path does not nest under its link reads the link that declares it", async () => {
    await expect
      .element(await opener_at("/admin/1/program-editor/abc123"))
      .toHaveTextContent("Programs");
  });

  test("a prefix is matched by segment, not by characters", async () => {
    await expect
      .element(await opener_at("/admin/1/programs-archive"))
      .toHaveTextContent("Open menu");
  });

  test("a path no link claims falls back to the generic label", async () => {
    await expect
      .element(await opener_at("/admin/1/funds"))
      .toHaveTextContent("Open menu");
  });
});
