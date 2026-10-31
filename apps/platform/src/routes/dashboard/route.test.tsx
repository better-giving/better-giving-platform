import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

// the route module's middleware and loader don't run under a stub render
vi.mock("#/.server/auth", () => ({ auth_mdlwr: vi.fn(), user_ctx: {} }));

vi.mock("#/hooks/use-session", () => ({
  use_session: () => ({
    session: { signed_in: true, avatar_url: undefined },
    is_loading: false,
    revalidate: vi.fn(),
  }),
}));

import DonorDashboard from "./route";

afterEach(async () => {
  await cleanup();
});

describe("donor dashboard shell", () => {
  test("the app header carries the signed-in account control", async () => {
    const Stub = createRoutesStub([
      {
        path: "/dashboard",
        Component: DonorDashboard,
        children: [{ index: true, Component: () => <h1>Jane Doe</h1> }],
      },
    ]);
    const screen = await render(<Stub initialEntries={["/dashboard"]} />);

    const banner = screen.getByRole("banner");
    await expect
      .element(banner.getByRole("link", { name: "Your dashboard" }))
      .toBeVisible();
  });
});
