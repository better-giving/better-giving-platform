import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Breadcrumb } from "./breadcrumb";

const items = [
  { label: "Programs", to: "/admin/9/programs" },
  { label: "Clean water for Turkana County", to: "/admin/9/programs/3" },
  { label: "Edit milestone" },
];

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/admin/9/programs/3/milestones/1"]}>
      <Breadcrumb items={items} />
    </MemoryRouter>
  );

describe("Breadcrumb", () => {
  test("is a navigation landmark labelled Breadcrumb", async () => {
    const screen = await mount();
    await expect
      .element(screen.getByRole("navigation", { name: "Breadcrumb" }))
      .toBeVisible();
    expect(screen.getByRole("listitem").elements()).toHaveLength(3);
  });

  test("every ancestor is a link to its own href", async () => {
    const screen = await mount();
    const links = screen.getByRole("link").elements();
    expect(links.map((x) => [x.textContent, x.getAttribute("href")])).toEqual([
      ["Programs", "/admin/9/programs"],
      ["Clean water for Turkana County", "/admin/9/programs/3"],
    ]);
  });

  test("the last item is the page's h1, current and not a link", async () => {
    const screen = await mount();
    const h1 = screen.getByRole("heading", { level: 1 });
    await expect.element(h1).toHaveTextContent("Edit milestone");
    await expect.element(h1).toHaveAttribute("aria-current", "page");
    expect(h1.element().closest("a")).toBeNull();
  });

  test("a `to` on the last item does not make it a link", async () => {
    const screen = await render(
      <MemoryRouter>
        <Breadcrumb
          items={[
            { label: "Campaigns", to: "/admin/9/campaigns" },
            { label: "Spring appeal", to: "/admin/9/campaigns/4" },
          ]}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole("link").elements()).toHaveLength(1);
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Spring appeal");
  });

  test("in a narrow column the ancestors keep their labels and only the current item truncates", async () => {
    const screen = await render(
      <MemoryRouter>
        <div style={{ width: 300 }}>
          <Breadcrumb
            items={[
              { label: "Banking", to: "/admin/9/banking" },
              { label: "Add a new bank account for payouts to your nonprofit" },
            ]}
          />
        </div>
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "Banking" }).element();
    expect(link.scrollWidth).toBeGreaterThan(0);
    expect(link.scrollWidth).toBeLessThanOrEqual(link.clientWidth);
    const h1 = screen.getByRole("heading", { level: 1 }).element();
    expect(h1.scrollWidth).toBeGreaterThan(h1.clientWidth);
    const nav = screen.getByRole("navigation").element();
    expect(nav.getBoundingClientRect().width).toBeLessThanOrEqual(300);
  });
});
