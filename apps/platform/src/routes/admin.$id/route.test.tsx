import { createRoutesStub, useParams } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";

vi.mock("$/pg/queries/npo", () => ({ npo_get: vi.fn() }));
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    user_ctx: true,
    middleware: true,
  })
);
vi.mock("#/hooks/use-session", () => ({
  use_session: () => ({
    session: undefined,
    is_loading: false,
    revalidate: vi.fn(),
  }),
}));
const two_orgs = [
  { id: 11, name: "Current Org", logo: undefined },
  { id: 22, name: "Second Org", logo: undefined },
];
const user_orgs = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("#/hooks/use-user", () => ({
  use_user: () => ({ user: { orgs: user_orgs.list } }),
}));

import AdminLayout from "./route";

afterEach(async () => {
  await cleanup();
  await reset_viewport();
});

function OrgView() {
  const { id } = useParams();
  return <h1>{`viewing org ${id}`}</h1>;
}

const endow = {
  name: "Current Org",
  logo: null,
  allocation: undefined,
  payout_minimum: undefined,
};

const Stub = createRoutesStub([
  {
    path: "/admin/:id",
    Component: AdminLayout as any,
    loader: ({ params }) => ({ user: {}, id: Number(params.id), endow }),
    children: [{ index: true, Component: OrgView }],
  },
]);

describe("npo admin org switcher", () => {
  test("leads the app header in the logo's place, lists the orgs, and switching navigates", async () => {
    user_orgs.list = two_orgs;
    await page.viewport(1440, 900);
    const screen = await render(<Stub initialEntries={["/admin/11"]} />);

    const banner = screen.getByRole("banner");
    const trigger = banner.getByRole("button", { name: "Current Org" });
    await expect.element(trigger).toBeVisible();

    expect(banner.getByTitle("Go to Home page").query()).toBeNull();

    await trigger.click();
    const second = screen.getByRole("menuitem", { name: "Second Org" });
    await expect.element(second).toBeVisible();
    // registering is a long process, not a menu shortcut
    expect(
      screen.getByRole("menuitem", { name: "Register another org" }).query()
    ).toBeNull();
    await second.click();

    await expect
      .element(screen.getByRole("heading", { name: "viewing org 22" }))
      .toBeVisible();
  });

  test("with one org the header shows it with no switcher", async () => {
    user_orgs.list = [two_orgs[0]];
    await page.viewport(1440, 900);
    const screen = await render(<Stub initialEntries={["/admin/11"]} />);

    const banner = screen.getByRole("banner");
    await expect.element(banner.getByText("Current Org")).toBeVisible();
    expect(
      banner.getByRole("button", { name: "Current Org" }).query()
    ).toBeNull();
  });
});
