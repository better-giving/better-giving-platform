import type { ComponentType } from "react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { IOrgLayout } from "#/components/org-page/layouts/types";

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: ComponentType) => Component,
  createClientLoaderCache: () => () => null,
}));

vi.mock("./api", () => ({
  loader: () => null,
  headers: () => ({}),
}));

/** the props the layout was last rendered with */
const rendered = vi.hoisted(() => ({
  props: null as IOrgLayout | null,
  stub: (name: string) => (props: IOrgLayout) => {
    rendered.props = props;
    return <p>{name} layout</p>;
  },
}));
vi.mock("#/components/org-page/layouts/card", () => ({
  Card: rendered.stub("card"),
}));
vi.mock("#/components/org-page/layouts/poster", () => ({
  Poster: rendered.stub("poster"),
}));
vi.mock("#/components/org-page/layouts/letter", () => ({
  Letter: rendered.stub("letter"),
}));
vi.mock("#/components/org-page/layouts/hub", () => ({
  Hub: rendered.stub("hub"),
}));
vi.mock("#/components/org-page/layouts/feature", () => ({
  Feature: rendered.stub("feature"),
}));

import Page from "./route";

afterEach(async () => {
  await cleanup();
  rendered.props = null;
});

const NOW = Date.parse("2026-10-23T09:00:00Z");

const give: IOrgLayout["give"][number] = {
  kind: "campaign",
  id: "c1",
  title: "Winter coats",
  to: "/org/acme/winter",
  image: null,
  raised: 50,
  goal: 100,
  ends_at: null,
  byline: null,
  excerpt: "",
};

const loader_data = (layout: string) => ({
  npo: {
    id: 7,
    slug: "acme",
    name: "Acme Relief",
    registration_number: "12-3456789",
    hq_country: "United States",
    street_address: "1 Main St",
    active_in_countries: ["Kenya", "Uganda"],
  },
  url: "https://x/org/acme",
  donors: 3,
  messages: [{ id: "d1", name: "Ana", message: "Keep going" }],
  messages_next: null,
  campaigns: [],
  layout,
  layout_by: "threshold",
  shape: { campaigns: 1 },
  lists: {
    give: [give],
    programs: [],
    videos: [],
    failed: { give: false, programs: true, videos: false },
  },
  now: NOW,
  funds: Promise.resolve([]),
  media: Promise.resolve([]),
  programs: Promise.resolve([]),
});

const mount = (layout: string) => {
  const Stub = createRoutesStub([
    { path: "/org/:org", Component: Page, loader: () => loader_data(layout) },
  ]);
  return render(<Stub initialEntries={["/org/acme"]} />);
};

describe("public org page", () => {
  test.each(["card", "poster", "letter", "hub", "feature"])(
    "renders the %s layout when the loader picks it",
    async (layout) => {
      const screen = await mount(layout);
      await expect
        .element(screen.getByText(`${layout} layout`))
        .toBeInTheDocument();
    }
  );

  test("hands the layout the org's lists, links and details", async () => {
    const screen = await mount("hub");
    await expect.element(screen.getByText("hub layout")).toBeInTheDocument();

    expect(rendered.props).not.toHaveProperty("donors");
    expect(rendered.props).toMatchObject({
      now: NOW,
      give: [give],
      programs: [],
      videos: [],
      failed: { give: false, programs: true, videos: false },
      messages: [{ id: "d1", name: "Ana", message: "Keep going" }],
      donate_to: "/donate/7",
      share: { recipientName: "Acme Relief", url: "https://x/org/acme" },
      credential: { label: "EIN", value: "12-3456789" },
      footer: {
        registration_number: "12-3456789",
        address: "1 Main St",
        active_in: "Kenya, Uganda",
      },
    });
    // the first page was the last
    expect(rendered.props?.on_more_messages).toBeUndefined();
  });
});
