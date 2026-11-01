import type { ComponentProps, ReactNode } from "react";
import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { doc_args } from "#/__tests__/fixtures/route-args";
import { Steps } from "#/components/donation";
import { base_url as env_base_url } from "#/constants/env";
import type { Route } from "./+types/route";
import { Donate, donate_mount } from "./donate";
import AboutUsPage, { loader } from "./route";

// records what the mount is handed, then renders the real form — the props
// seam is the only place base_url is observable (it's read at submit time to
// build the return url, never rendered).
const mounts = vi.hoisted(() => [] as (string | undefined)[]);
vi.mock("#/components/donation", async (orig) => {
  const mod = await orig<typeof import("#/components/donation")>();
  return {
    ...mod,
    Steps: (props: ComponentProps<typeof mod.Steps>) => {
      mounts.push("base_url" in props ? props.base_url : undefined);
      return <mod.Steps {...props} />;
    },
  };
});

const test_base_url = "https://preview.example.org";

const stb = (node: ReactNode) =>
  createRoutesStub([
    {
      path: "/",
      Component: () => node,
      HydrateFallback: () => null,
    },
  ]);

const tip_label = /support free fundraising tools/i;

const tab_names = [
  /^card$/i,
  /bank transfer/i,
  /^stocks$/i,
  /donor advised fund/i,
  /ira \/ qcd/i,
  /^crypto$/i,
];

describe("about-us donate band", () => {
  test("mounts every payment method", async () => {
    const Stub = stb(<Donate base_url={test_base_url} />);
    const screen = await render(<Stub />);

    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();

    for (const name of tab_names) {
      await expect.element(screen.getByRole("tab", { name })).toBeVisible();
    }
    expect(screen.getByRole("tab").elements()).toHaveLength(tab_names.length);
  });

  test("a blocked payment sdk stays out of the visitor's way", async () => {
    // the card panel is the default tab and it mounts both express rails: the
    // global mock resolves paypal's sdk AND stripe.js to null — the adblocked
    // visitor. this is a page someone is reading, not a checkout, so both go
    // away silently: no modal, and no inline notice either.
    const Stub = stb(<Donate base_url={test_base_url} />);
    const screen = await render(<Stub />);

    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    // the card panel body is up, so every absence below is a real absence and
    // not an unmounted panel (Tabs.Root is lazyMount + unmountOnExit)
    await expect
      .element(screen.getByRole("button", { name: /continue with card/i }))
      .toBeVisible();
    // neither rail says anything, in a modal or inline. the message query is
    // proven live by the control test below — this mount can't assert the
    // block "was there first" instead, since the sdk failure resolves in a
    // microtask and may beat the first assertion.
    await expect
      .element(screen.getByText(/failed to load/i))
      .not.toBeInTheDocument();
    expect(screen.getByRole("dialog").query()).toBeNull();
    await vi.waitFor(() =>
      expect(
        screen.container.querySelector('[data-testid="paypal-gate"]')
      ).toBeNull()
    );
    // ...and the visitor is left with a working form
    await expect
      .element(screen.getByRole("button", { name: /continue with card/i }))
      .toBeVisible();
  });

  test("the same mount minus the flag does say it — the silence above is the flag", async () => {
    // control for the negatives above: identical form, `hide_unavailable_express`
    // off, and the notice appears. so those assertions are matching a query
    // that can match here, not a selector that never could.
    const Stub = stb(
      <Steps
        {...donate_mount}
        hide_unavailable_express={false}
        base_url={test_base_url}
      />
    );
    const screen = await render(<Stub />);

    await expect
      .element(screen.getByRole("button", { name: /continue with card/i }))
      .toBeVisible();
    // both rails, each in its own words, each where its block was — and both
    // at the same instant. asserting them one at a time would also pass on a
    // form that flip-flops between the two (what one shared unavailable slot
    // does: each rail's write evicts the other's, remounting it to fail again).
    await vi.waitFor(() => {
      // the form keeps an empty status region mounted for its own notices, so
      // count only regions that say something
      const notices = [...screen.container.querySelectorAll('[role="status"]')]
        .map((n) => n.textContent ?? "")
        .filter((t) => t.trim() !== "");
      expect(notices).toHaveLength(2);
      expect(notices.some((t) => /paypal failed to load/i.test(t))).toBe(true);
      expect(
        notices.some((t) => /express checkout failed to load/i.test(t))
      ).toBe(true);
    });
    // still inline, never a modal
    expect(screen.getByRole("dialog").query()).toBeNull();
  });

  test("renders no tip block", async () => {
    const Stub = stb(<Donate base_url={test_base_url} />);
    const screen = await render(<Stub />);

    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    // donate-methods is Tabs.Root itself, not a panel body — anchor on the
    // card panel's submit button so the negative below can't pass on an
    // unmounted panel
    await expect
      .element(screen.getByRole("button", { name: /continue with card/i }))
      .toBeVisible();
    await expect.element(screen.getByText(tip_label)).not.toBeInTheDocument();
  });
});

describe("about-us donate mount config", () => {
  test("no method offers the bg tip", async () => {
    const Stub = stb(<Steps {...donate_mount} base_url={test_base_url} />);
    const screen = await render(<Stub />);

    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    // default (card) panel — its submit button proves the panel body rendered,
    // so the absence below can't pass on an empty panel
    await expect
      .element(screen.getByRole("button", { name: /continue/i }))
      .toBeVisible();
    await expect.element(screen.getByText(tip_label)).not.toBeInTheDocument();

    // tabs lazy-mount, so every other panel needs its own look
    for (const name of tab_names.slice(1)) {
      const tab = screen.getByRole("tab", { name });
      await expect.element(tab).toBeVisible();
      await tab.click();
      await expect.element(tab).toHaveAttribute("aria-selected", "true");
      // same anchor: every method form ends in a submit button, and only the
      // mounted panel has one (unmountOnExit)
      await expect
        .element(screen.getByRole("button", { name: /continue/i }))
        .toBeVisible();
      await expect.element(screen.getByText(tip_label)).not.toBeInTheDocument();
    }
  });

  test("recipient is Better Giving (npo 1)", async () => {
    const Stub = stb(<Steps {...donate_mount} base_url={test_base_url} />);
    const screen = await render(<Stub />);

    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();

    // ira/qcd skips the donor step and prints the recipient on its checkout
    const tab = screen.getByRole("tab", { name: /ira \/ qcd/i });
    await expect.element(tab).toBeVisible();
    await tab.click();
    await expect.element(tab).toHaveAttribute("aria-selected", "true");
    await screen.getByPlaceholder(/enter amount/i).fill("100");
    const cont = screen.getByRole("button", { name: /continue/i });
    await expect.element(cont).toBeVisible();
    await cont.click();

    await expect
      .element(screen.getByText(/ira donation pending/i))
      .toBeVisible();
    // "Reference" row — the recipient name
    await expect.element(screen.getByText(/^Better Giving$/)).toBeVisible();
    // "Project URL" row — the recipient id
    await expect.element(screen.getByText(/\/org\/1$/)).toBeVisible();
  });
});

describe("about-us base_url", () => {
  test("the loader derives it from the request origin", async () => {
    const res = await loader({
      ...doc_args(new Request("https://preview.example.org/about-us?x=1")),
    } as Route.LoaderArgs);

    // only the origin — no session, no per-visitor data (the route is cdn-cached)
    expect(res).toEqual({ base_url: "https://preview.example.org" });
  });

  test("the mount takes the loader value, not the build-time env const", async () => {
    // the const would be http://localhost:4200 here (.env.test VITE_BASE_URL)
    expect(Object.keys(donate_mount)).not.toContain("base_url");

    let req_origin: string | undefined;
    const Stub = createRoutesStub([
      {
        path: "/about-us",
        Component: AboutUsPage,
        loader: (args) => {
          req_origin = new URL(args.request.url).origin;
          return loader(args as Route.LoaderArgs);
        },
        HydrateFallback: () => null,
      },
    ]);
    mounts.length = 0;
    const screen = await render(<Stub initialEntries={["/about-us"]} />);

    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    // what the mount got is the origin of the request the loader saw...
    expect(req_origin).toBeTruthy();
    expect(mounts.at(-1)).toBe(req_origin);
    // ...and not the build-time const
    expect(mounts.at(-1)).not.toBe(env_base_url);
  });
});
