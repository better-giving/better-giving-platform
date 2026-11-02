import { ListCheck, Wallet } from "lucide-react";
import { createRoutesStub, Outlet } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Sidebar } from "./sidebar";
import type { LinkGroup } from "./types";

const link_groups: LinkGroup[] = [
  {
    links: [
      {
        title: "Programs",
        to: "programs",
        nests: ["program-editor"],
        icon: { fn: ListCheck },
      },
      { title: "Banking", to: "banking", icon: { fn: Wallet } },
    ],
  },
];

const sidebar_at = async (path: string) => {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id",
      Component: () => (
        <>
          <Sidebar linkGroups={link_groups} rootRoute="/admin/:id/" />
          <Outlet />
        </>
      ),
      children: [
        { path: "programs", Component: () => <h1>Programs page</h1> },
        { path: "program-editor/:pid", Component: () => <h1>Editor</h1> },
        { path: "banking", Component: () => <h1>Banking page</h1> },
        { path: "banking/new", Component: () => <h1>New bank</h1> },
      ],
    },
  ]);
  const screen = await render(<Stub initialEntries={[path]} />);
  return screen;
};

describe("Sidebar marks the page's owning link", () => {
  test("a sidebar destination is its own current page, not clickable again", async () => {
    const screen = await sidebar_at("/admin/1/banking");
    const banking = screen.getByRole("link", { name: "Banking" });
    await expect.element(banking).toHaveAttribute("aria-current", "page");
    expect(getComputedStyle(banking.element()).pointerEvents).toBe("none");
  });

  test("a page declared in `nests` highlights the link that declares it", async () => {
    const screen = await sidebar_at("/admin/1/program-editor/abc123");
    const programs = screen.getByRole("link", { name: "Programs" });
    await expect.element(programs).toHaveAttribute("aria-current", "true");
    await expect
      .element(screen.getByRole("link", { name: "Banking" }))
      .not.toHaveAttribute("aria-current");
  });

  test("on a page nested under a link, that link is highlighted and leads back", async () => {
    const screen = await sidebar_at("/admin/1/banking/new");
    const banking = screen.getByRole("link", { name: "Banking" });
    await expect.element(banking).toHaveAttribute("aria-current", "true");

    await banking.click();
    await expect
      .element(screen.getByRole("heading", { name: "Banking page" }))
      .toBeVisible();
  });
});
