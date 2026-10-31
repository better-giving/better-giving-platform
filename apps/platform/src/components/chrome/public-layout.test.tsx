import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
// sticky, z-index and scroll-padding are all stylesheet behaviour — without the
// real css the header is a static block and every case passes or fails on
// nothing.
import "#/index.css";
import { PublicLayout } from "./public-layout";

// far taller than any test viewport, so a 2000px scroll has room to land
function TallPage() {
  return (
    <div>
      {Array.from({ length: 300 }, (_, i) => (
        <p key={i} id={`section-${i}`}>
          section {i}
        </p>
      ))}
    </div>
  );
}

function layout_stub() {
  return createRoutesStub([
    {
      path: "/",
      Component: PublicLayout,
      HydrateFallback: () => null,
      children: [
        // marketing chrome, with the announcement bar above the header
        { path: "about-us", Component: TallPage },
        // minimal chrome: AppHeader, no bar
        { path: "marketplace", Component: TallPage },
      ],
    },
  ]);
}

afterEach(() => {
  window.scrollTo(0, 0);
});

describe("PublicLayout header", () => {
  test.each([
    ["marketing", "/about-us"],
    ["minimal", "/marketplace"],
  ])(
    "stays pinned to the top of the viewport on a %s route",
    async (_, path) => {
      const Stub = layout_stub();
      const screen = await render(
        <Stub initialEntries={[path]} future={{ v8_middleware: true }} />
      );
      await expect.element(screen.getByText("section 299")).toBeInTheDocument();

      window.scrollTo(0, 2000);
      expect(window.scrollY).toBe(2000);

      const header = screen.container.querySelector("header") as HTMLElement;
      const { top } = header.getBoundingClientRect();
      // -top-px: stuck one pixel above the edge, not scrolled off with the page
      expect(top).toBeLessThanOrEqual(0);
      expect(top).toBeGreaterThan(-2);
    }
  );

  test("the announcement bar scrolls away while the header pins", async () => {
    const Stub = layout_stub();
    const screen = await render(
      <Stub initialEntries={["/about-us"]} future={{ v8_middleware: true }} />
    );
    await expect.element(screen.getByText("section 299")).toBeInTheDocument();

    window.scrollTo(0, 2000);

    const bar = screen.container.querySelector(
      '[data-banner="ncnp-endorsement"]'
    ) as HTMLElement;
    expect(bar.getBoundingClientRect().bottom).toBeLessThanOrEqual(0);
  });

  test.each([
    ["marketing", "/about-us"],
    ["minimal", "/marketplace"],
  ])(
    "a hash jump lands the target below the pinned header on a %s route",
    async (_, path) => {
      const Stub = layout_stub();
      const screen = await render(
        <Stub initialEntries={[path]} future={{ v8_middleware: true }} />
      );
      await expect.element(screen.getByText("section 299")).toBeInTheDocument();

      document.getElementById("section-150")!.scrollIntoView();

      const header = screen.container.querySelector("header") as HTMLElement;
      const target = document.getElementById("section-150")!;
      expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        header.getBoundingClientRect().bottom
      );
    }
  );

  test("scroll-padding equals the header's measured height", async () => {
    const Stub = layout_stub();
    const screen = await render(
      <Stub initialEntries={["/about-us"]} future={{ v8_middleware: true }} />
    );
    await expect.element(screen.getByText("section 299")).toBeInTheDocument();

    const header = screen.container.querySelector("header") as HTMLElement;
    expect(getComputedStyle(document.documentElement).scrollPaddingTop).toBe(
      `${header.getBoundingClientRect().height}px`
    );
  });
});

describe("PublicLayout ground", () => {
  test.each([
    ["marketing", "/about-us", "--background"],
    ["minimal", "/marketplace", "--ground"],
  ])("a %s route (%s) sits on %s", async (_, path, token) => {
    const Stub = layout_stub();
    const screen = await render(
      <Stub initialEntries={[path]} future={{ v8_middleware: true }} />
    );
    await expect.element(screen.getByText("section 299")).toBeInTheDocument();

    // resolve the token through a probe so the assertion names the token, not
    // its value: --ground and --background differ, so a swapped seam fails.
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${token})`;
    document.body.append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();

    expect(getComputedStyle(document.body).backgroundColor).toBe(expected);
  });
});
