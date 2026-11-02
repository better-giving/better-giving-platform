import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { reset_viewport } from "#/__tests__/fixtures/viewport";
// the scrim's height is a tailwind arbitrary value, so the real stylesheet has
// to be loaded for the measurement below to mean anything.
import "#/index.css";
import { MarketingHeader } from "./marketing-header";

const session_mock = vi.hoisted(() => ({
  value: undefined as { signed_in: boolean } | undefined,
}));

vi.mock("#/hooks/use-session", () => ({
  use_session: () => ({
    session: session_mock.value,
    is_loading: false,
    revalidate: vi.fn(),
  }),
}));

afterEach(async () => {
  await cleanup();
  session_mock.value = undefined;
  await reset_viewport();
});

// the header as the layouts mount it: sticky, in a grid whose first track is
// the declared 4rem header row.
function stub() {
  return createRoutesStub([
    {
      path: "/",
      Component: () => (
        <div className="grid grid-cols-[minmax(0,1fr)] grid-rows-[4rem_1fr] min-h-dvh">
          <MarketingHeader classes="sticky z-sticky -top-px" />
          <main />
        </div>
      ),
      HydrateFallback: () => null,
    },
  ]);
}

describe("mobile menu scrim", () => {
  test("is a viewport minus the header, so it ends at the fold instead of overhanging", async () => {
    const Stub = stub();
    const screen = await render(
      <Stub initialEntries={["/"]} future={{ v8_middleware: true }} />
    );

    await screen.getByRole("button", { name: /navigation menu/i }).click();

    const scrim = screen
      .getByRole("button", { name: /close navigation menu/i })
      .element();
    const header = screen.container.querySelector("header");
    if (!header) throw new Error("header not found");

    const header_h = header.getBoundingClientRect().height;
    // the scrim hangs off the header's bottom edge (`top-full`), so a flat
    // `h-dvh` puts its bottom a header height past the fold — and a further
    // banner height past it while the announcement bar is mounted above an
    // unscrolled page. subtracting the containing block keeps that overhang out
    // of the document's scrollable area.
    const overhang =
      scrim.getBoundingClientRect().height - (window.innerHeight - header_h);
    // 1px of slack for the subpixel header box (its bottom border). the
    // regression this pins is a whole header height (64px), not a rounding step.
    expect(Math.abs(overhang)).toBeLessThanOrEqual(1);
  });
});

describe("marketing header account control", () => {
  test("signed in: the account menu replaces the sign-up and log-in links", async () => {
    session_mock.value = { signed_in: true };
    await page.viewport(1440, 900);
    const Stub = stub();
    const screen = await render(
      <Stub initialEntries={["/"]} future={{ v8_middleware: true }} />
    );

    const banner = screen.getByRole("banner");
    await expect
      .element(banner.getByRole("button", { name: "Account menu" }))
      .toBeVisible();
    expect(banner.getByRole("link", { name: "Log in" }).query()).toBeNull();
    expect(
      banner.getByRole("link", { name: "Join free forever" }).query()
    ).toBeNull();
  });

  test("signed out: sign-up and log-in links, no account menu", async () => {
    await page.viewport(1440, 900);
    const Stub = stub();
    const screen = await render(
      <Stub initialEntries={["/"]} future={{ v8_middleware: true }} />
    );

    const banner = screen.getByRole("banner");
    await expect
      .element(banner.getByRole("link", { name: "Log in" }))
      .toBeVisible();
    expect(
      banner.getByRole("button", { name: "Account menu" }).query()
    ).toBeNull();
  });
});
