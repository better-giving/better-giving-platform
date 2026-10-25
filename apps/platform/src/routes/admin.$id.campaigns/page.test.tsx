import { createRoutesStub, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

vi.mock("$/pg/db", () => ({ db: {} }));
vi.mock("#/.server/auth", () => ({
  admin_ctx: Symbol("admin"),
  user_ctx: Symbol("user"),
}));
vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return { redirectWithSuccess: (url: string) => redirect(url) };
});
vi.mock("$/kit/queue", () => ({ enqueue: vi.fn() }));

import EditPage from "../admin.$id.campaigns_.$campaign_id/route";
import NewPage from "../admin.$id.campaigns_.new/route";
import { CampaignForm, type ICampaignFormInit } from "./form";
import ListPage from "./route";

afterEach(async () => {
  await cleanup();
});

const init: ICampaignFormInit = {
  name: "Winter",
  slug: "winter",
  campaign_type: "",
  description_pt: "A story of the drive",
  banner: "",
  logo: "",
  videos: [],
  ends_at: null,
  target: undefined,
  increments: [],
  donate_methods: ["stripe"],
  donate_frequencies: ["one-time"],
  hide_bg_tip: true,
  program_id: null,
};

function form_page(
  status: "draft" | "live" | "ended" | null,
  extra?: { gift_count?: number; locked?: boolean }
) {
  let entered = false;
  let posted: unknown;
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/campaigns/edit",
      Component: () => (
        <CampaignForm
          init={init}
          programs={[
            { id: "11111111-1111-4111-8111-111111111111", title: "Meals" },
          ]}
          locked={extra?.locked ?? false}
          status={status}
          gift_count={extra?.gift_count ?? 0}
          fallback_methods={["stripe"]}
          fallback_frequencies={["one-time"]}
          settings_donation_to="/admin/7/settings?tab=donation"
          link_base="https://x.test/org/acme/"
        />
      ),
      action: async ({ request }) => {
        // before await: a click that already submitted is visible while json() is pending
        entered = true;
        posted = await request.json();
        if (
          posted &&
          typeof posted === "object" &&
          "slug" in posted &&
          (posted as { slug?: string }).slug === "winter"
        ) {
          return {
            error: "That link is already used by another campaign.",
            field: "slug",
          };
        }
        return null;
      },
    },
    {
      path: "/admin/:id/settings",
      Component: () => <h1>Donation settings</h1>,
    },
  ]);
  return {
    posted: () => posted,
    entered: () => entered,
    Stub,
  };
}

async function render_form(
  status: "draft" | "live" | "ended" | null,
  extra?: { gift_count?: number; locked?: boolean }
) {
  const built = form_page(status, extra);
  const screen = await render(
    <built.Stub initialEntries={["/admin/7/campaigns/edit"]} />
  );
  return { screen, posted: built.posted, entered: built.entered };
}

function press(locator: { element: () => Element }) {
  (locator.element() as HTMLElement).click();
}

function SearchProbe() {
  return <output data-testid="url-search">{useLocation().search}</output>;
}

describe("campaign list", () => {
  const endow = {
    id: 7,
    slug: "acme",
    name: "Acme Fund",
    image: "",
    contributions_total: 90,
    target: undefined,
  };

  function row_of(screen: { getByText: typeof page.getByText }, name: string) {
    return page.elementLocator(
      (
        screen.getByText(name, { exact: true }).element() as HTMLElement
      ).closest("li") as HTMLElement
    );
  }

  async function render_list(campaigns: unknown[], search = "") {
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/campaigns",
        HydrateFallback: () => null,
        Component: (props) => (
          <>
            <ListPage {...props} />
            <SearchProbe />
          </>
        ),
        loader: ({ request }) => {
          const tab = new URL(request.url).searchParams.get("tab");
          if (tab === "fundraisers") {
            return {
              view: "fundraisers" as const,
              endow,
              funds: [],
              user: { role: null },
            };
          }
          return {
            view: "campaigns" as const,
            endow,
            campaigns,
          };
        },
      },
    ]);
    return render(<Stub initialEntries={[`/admin/7/campaigns${search}`]} />);
  }

  it("shows the empty state, no profile row, when there are no campaigns", async () => {
    const screen = await render_list([]);
    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Campaigns" }))
      .toBeVisible();
    expect(
      (
        screen
          .getByRole("link", { name: "New campaign" })
          .element() as HTMLAnchorElement
      ).getAttribute("href")
    ).toBe("/admin/7/campaigns/new");
    expect(
      screen
        .getByRole("tab")
        .elements()
        .map((el) => el.textContent)
    ).toEqual(["Your campaigns", "Supporter campaigns"]);
    await expect
      .element(screen.getByRole("tab", { name: "Your campaigns", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(screen.getByText("No campaigns yet")).toBeVisible();
    expect(
      (
        screen
          .getByRole("link", { name: "Create campaign" })
          .element() as HTMLAnchorElement
      ).getAttribute("href")
    ).toBe("/admin/7/campaigns/new");
    expect(screen.getByRole("listitem").elements()).toHaveLength(0);
    expect(screen.getByText("Acme Fund", { exact: true }).query()).toBeNull();
    expect(screen.getByText("Profile", { exact: true }).query()).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Supporter campaigns" }).query()
    ).toBeNull();
  });

  it("opens supporter fundraisers on the other tab and treats an unknown tab as yours", async () => {
    const screen = await render_list([], "?tab=nope");
    await expect
      .element(screen.getByRole("tab", { name: "Your campaigns", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(screen.getByText("No campaigns yet", { exact: true }))
      .toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Supporter campaigns" }).query()
    ).toBeNull();

    await screen
      .getByRole("tab", { name: "Supporter campaigns", exact: true })
      .click();
    await expect
      .element(
        screen.getByRole("tab", { name: "Supporter campaigns", exact: true })
      )
      .toHaveAttribute("aria-selected", "true");
    await vi.waitFor(() => {
      expect(screen.getByTestId("url-search").element().textContent).toBe(
        "?tab=fundraisers"
      );
    });
    await expect
      .element(
        screen.getByText(
          "These are campaigns people started for your nonprofit. You can leave any you don't want to receive from.",
          { exact: true }
        )
      )
      .toBeVisible();
    expect(
      screen.getByText("No campaigns yet", { exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "New campaign" }).query()
    ).toBeNull();
    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Campaigns" }))
      .toBeVisible();

    await screen
      .getByRole("tab", { name: "Your campaigns", exact: true })
      .click();
    await vi.waitFor(() => {
      expect(screen.getByTestId("url-search").element().textContent).toBe("");
    });
    await expect
      .element(screen.getByText("No campaigns yet", { exact: true }))
      .toBeVisible();
  });

  it("shows raised against a fixed goal and only raised without one", async () => {
    const screen = await render_list([
      {
        id: "c-goal",
        name: "Winter",
        slug: "winter",
        status: "live",
        status_label: "live",
        raised: 250,
        target: "1000",
        hero: "https://example.com/winter.png",
        ends_at: null,
      },
      {
        id: "c-smart",
        name: "Spring",
        slug: "spring",
        status: "live",
        status_label: "live",
        raised: 40,
        target: "smart",
        hero: null,
        ends_at: null,
      },
    ]);
    const winter = row_of(screen, "Winter");
    await expect.element(winter.getByRole("progressbar")).toBeVisible();
    await expect
      .element(winter.getByText("$250", { exact: true }))
      .toBeVisible();
    await expect
      .element(winter.getByText("$1,000", { exact: true }))
      .toBeVisible();
    await expect
      .element(winter.getByText("Goal", { exact: true }))
      .toBeVisible();

    const spring = row_of(screen, "Spring");
    await expect
      .element(spring.getByText("$40 Raised", { exact: true }))
      .toBeVisible();
    expect(spring.getByRole("progressbar").query()).toBeNull();
    expect(spring.getByText("Goal", { exact: true }).query()).toBeNull();
  });

  it("lists campaigns, without the profile, on Your campaigns", async () => {
    const screen = await render_list([
      {
        id: "c-live",
        name: "Winter",
        slug: "winter",
        status: "live",
        status_label: "ended",
        raised: 12,
        ends_at: "2020-01-02T00:00:00.000Z",
      },
      {
        id: "c-draft",
        name: "Spring",
        slug: "spring",
        status: "draft",
        status_label: "draft",
        raised: 1,
        ends_at: null,
      },
    ]);

    expect(screen.getByText("No campaigns yet").query()).toBeNull();
    await expect
      .element(screen.getByRole("tab", { name: "Your campaigns", exact: true }))
      .toHaveAttribute("aria-selected", "true");

    const winter_name = screen.getByText("Winter", { exact: true });
    expect((winter_name.element() as HTMLElement).tagName).toBe("P");
    expect((winter_name.element() as HTMLElement).className).toContain(
      "font-semibold"
    );
    expect(
      screen.getByRole("link", { name: "Winter", exact: true }).query()
    ).toBeNull();
    const winter_row = (winter_name.element() as HTMLElement).closest("li");
    expect(
      (
        page
          .elementLocator(winter_row as HTMLElement)
          .getByRole("link", { name: "Edit Winter", exact: true })
          .element() as HTMLAnchorElement
      ).pathname
    ).toBe("/admin/7/campaigns/c-live");
    const winter = page.elementLocator(winter_row as HTMLElement);
    await expect
      .element(winter.getByText("Ended", { exact: true }))
      .toBeVisible();
    await expect
      .element(winter.getByText("$12 Raised", { exact: true }))
      .toBeVisible();
    await expect
      .element(winter.getByText("Ended Jan 2, 2020", { exact: true }))
      .toBeVisible();
    const winter_view = page
      .elementLocator(winter_row as HTMLElement)
      .getByRole("link", { name: "View Winter", exact: true });
    expect((winter_view.element() as HTMLAnchorElement).textContent).toBe(
      "View"
    );
    expect(
      (winter_view.element() as HTMLAnchorElement).getAttribute("href")
    ).toBe("/org/acme/winter");
    expect(
      (winter_view.element() as HTMLAnchorElement).getAttribute("target")
    ).toBe("_blank");
    expect(
      (winter_view.element() as HTMLAnchorElement).getAttribute("rel")
    ).toBe("noopener noreferrer");
    expect(
      screen.getByRole("link", { name: "/org/acme/spring" }).query()
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "Spring", exact: true }).query()
    ).toBeNull();
    const spring_row = (
      screen.getByText("Spring", { exact: true }).element() as HTMLElement
    ).closest("li");
    expect(
      (
        page
          .elementLocator(spring_row as HTMLElement)
          .getByRole("link", { name: "Edit Spring", exact: true })
          .element() as HTMLAnchorElement
      ).pathname
    ).toBe("/admin/7/campaigns/c-draft");

    const spring = page.elementLocator(spring_row as HTMLElement);
    await expect
      .element(spring.getByText("Draft", { exact: true }))
      .toBeVisible();
    await expect
      .element(spring.getByText("$1 Raised", { exact: true }))
      .toBeVisible();
    await expect
      .element(spring.getByText("No end date", { exact: true }))
      .toBeVisible();
    expect(
      page
        .elementLocator(spring_row as HTMLElement)
        .getByRole("link", { name: "View Spring", exact: true })
        .query()
    ).toBeNull();

    const items = screen.getByRole("listitem").elements();
    expect(items.map((el) => el.querySelector("p")?.textContent)).toEqual([
      "Winter",
      "Spring",
    ]);
  });
});

describe("campaign form", () => {
  it("asks before delete and end, and does not submit until the confirm", async () => {
    const { screen, posted, entered } = await render_form("live", {
      gift_count: 0,
    });
    await screen.getByRole("button", { name: "Delete" }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Delete this campaign?" }))
      .toBeVisible();
    expect(entered()).toBe(false);
    await expect
      .element(
        screen.getByText("The page and its links and QR code stop working.")
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Cancel" }))
      .toHaveFocus();
    expect(posted()).toBeUndefined();
    await screen.getByRole("button", { name: "Cancel" }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Delete this campaign?" }))
      .not.toBeInTheDocument();
    expect(posted()).toBeUndefined();

    await screen.getByRole("button", { name: "End" }).click();
    await expect
      .element(screen.getByText("Donations stop for good."))
      .toBeVisible();
    expect(entered()).toBe(false);
    const dialog = screen.getByRole("dialog").element();
    press(page.elementLocator(dialog).getByRole("button", { name: "End" }));
    await vi.waitFor(() => {
      expect(entered()).toBe(true);
    });
    await vi_posted(posted, "end");
  });

  it("asks before the first publish and saves a live campaign without publishing", async () => {
    const draft = await render_form("draft");
    await expect
      .element(draft.screen.getByRole("button", { name: "Delete" }))
      .toBeVisible();
    expect(
      draft.screen
        .getByRole("button", { name: "Save changes", exact: true })
        .query()
    ).toBeNull();
    expect(
      draft.screen.getByRole("button", { name: "End", exact: true }).query()
    ).toBeNull();
    const address = draft.screen.getByLabelText(/campaign link/i);
    await address.fill("winter-drive");
    await expect
      .element(
        draft.screen.getByText(
          "Letters, numbers, and - . _ ~. The link can't change after you publish."
        )
      )
      .toBeVisible();
    await draft.screen.getByRole("button", { name: "Publish" }).click();
    await expect
      .element(
        draft.screen.getByText(
          "Donors will find this campaign at https://x.test/org/acme/winter-drive. The link can't change after you publish."
        )
      )
      .toBeVisible();
    expect(draft.posted()).toBeUndefined();
    const dialog = draft.screen.getByRole("dialog").element();
    press(page.elementLocator(dialog).getByRole("button", { name: "Publish" }));
    await vi_posted(draft.posted, "publish");

    const { cleanup } = await import("vitest-browser-react");
    await cleanup();
    const live = await render_form("live", { gift_count: 3, locked: true });
    expect(
      live.screen.getByRole("button", { name: "Publish", exact: true }).query()
    ).toBeNull();
    expect(
      live.screen.getByRole("button", { name: "Delete", exact: true }).query()
    ).toBeNull();
    expect(
      live.screen.getByRole("button", { name: "Save", exact: true }).query()
    ).toBeNull();
    await expect
      .element(
        live.screen.getByText(
          "This link is fixed because the campaign is published."
        )
      )
      .toBeVisible();
    expect(
      live.screen.getByText("The link can't change after you publish.").query()
    ).toBeNull();
    await live.screen.getByRole("button", { name: "Save changes" }).click();
    await vi_posted(live.posted, "save");
  });

  it("does not confirm publish when the address is empty", async () => {
    const { screen, posted } = await render_form("draft");
    const address = screen.getByLabelText(/campaign link/i);
    await address.clear();
    await screen.getByRole("button", { name: "Publish" }).click();
    expect(screen.getByRole("dialog").query()).toBeNull();
    await expect
      .element(
        screen.getByText(
          "Enter the end of the link. Use letters, numbers, and - . _ ~."
        )
      )
      .toBeVisible();
    expect(posted()).toBeUndefined();
  });

  it("leaves an ended campaign without save or publish", async () => {
    const { screen } = await render_form("ended", { gift_count: 0 });
    expect(
      screen.getByRole("button", { name: "Save", exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save changes", exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Publish", exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "End", exact: true }).query()
    ).toBeNull();
    await expect
      .element(screen.getByRole("button", { name: "Delete" }))
      .toBeVisible();
  });

  it("shows a server refusal on the address and moves focus there", async () => {
    const { screen } = await render_form("draft");
    await screen.getByRole("button", { name: "Save" }).click();
    const refusal = "That link is already used by another campaign.";
    await expect.element(screen.getByRole("alert")).toHaveTextContent(refusal);
    const address = screen.getByLabelText(/campaign link/i);
    await expect.element(address).toHaveAttribute("aria-invalid", "true");
    const error_id = address.element().getAttribute("aria-errormessage");
    await expect
      .element(
        page.elementLocator(
          document.getElementById(error_id ?? "") as HTMLElement
        )
      )
      .toHaveTextContent(refusal);
    await expect.element(address).toHaveFocus();
  });

  it("links the tip note to donation settings and offers no type and no program", async () => {
    const { screen } = await render_form("draft");
    const tip = screen.getByRole("link", { name: "Settings › Donation" });
    expect((tip.element() as HTMLAnchorElement).getAttribute("href")).toBe(
      "/admin/7/settings?tab=donation"
    );
    expect(
      (
        screen
          .getByRole("checkbox", { name: /hide the better giving tip/i })
          .element() as HTMLInputElement
      ).disabled
    ).toBe(true);

    await screen.getByRole("combobox", { name: "Type" }).click();
    await expect
      .element(screen.getByRole("option", { name: "No type" }))
      .toBeVisible();
    await screen.getByRole("option", { name: "Year-end" }).click();
    await expect
      .element(screen.getByRole("combobox", { name: "Type" }))
      .toHaveTextContent("Year-end");

    await screen.getByRole("combobox", { name: "Program" }).click();
    await expect
      .element(screen.getByRole("option", { name: "No program" }))
      .toBeVisible();
    await screen.getByRole("option", { name: "Meals" }).click();
    await expect
      .element(screen.getByRole("combobox", { name: "Program" }))
      .toHaveValue("Meals");
  });
});

async function vi_posted(posted: () => unknown, op: string) {
  await vi.waitFor(() => {
    expect(posted()).toMatchObject({ op });
  });
}

describe("campaign pages", () => {
  it("does not scroll horizontally at 375px on the new campaign page", async () => {
    const { page: browser_page } = await import("vitest/browser");
    await browser_page.viewport(375, 667);
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/campaigns/new",
        Component: NewPage,
        loader: () => ({
          endow: {
            id: 7,
            slug: "acme",
            donate_methods: ["stripe", "paypal"],
            donate_frequencies: ["one-time", "monthly"],
            hide_bg_tip: false,
          },
          programs: [
            { id: "11111111-1111-4111-8111-111111111111", title: "Meals" },
          ],
          profile_to: "/admin/7/organization",
          origin: "https://x.test",
        }),
      },
    ]);
    const screen = await render(
      <Stub initialEntries={["/admin/7/campaigns/new"]} />
    );
    await expect
      .element(screen.getByRole("heading", { name: "New campaign" }))
      .toBeVisible();
    await vi.waitFor(() => {
      expect(
        screen.container.querySelector('[contenteditable="true"]')
      ).not.toBeNull();
    });
    await vi.waitFor(() => {
      const doc = document.documentElement;
      expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
    });
    await browser_page.viewport(1280, 900);
  });

  it("crumbs the new page back to the list", async () => {
    const Stub = createRoutesStub([
      {
        path: "/admin/:id/campaigns/new",
        Component: NewPage,
        loader: () => ({
          endow: {
            id: 7,
            slug: "acme",
            donate_methods: ["stripe"],
            donate_frequencies: ["one-time"],
            hide_bg_tip: false,
          },
          programs: [],
          profile_to: "/admin/7/organization",
          origin: "https://x.test",
        }),
      },
    ]);
    const screen = await render(
      <Stub initialEntries={["/admin/7/campaigns/new"]} />
    );
    await expect
      .element(screen.getByRole("heading", { name: "New campaign" }))
      .toBeVisible();
    const crumb = screen.getByRole("link", { name: "Campaigns" });
    expect((crumb.element() as HTMLAnchorElement).pathname).toBe(
      "/admin/7/campaigns"
    );
    expect((crumb.element() as HTMLElement).className).not.toContain(
      "pointer-events-none"
    );
  });

  it("names the edit page and links a published address", async () => {
    const screen = await render(edit_stub(true));
    await expect
      .element(screen.getByRole("heading", { name: "Winter", exact: true }))
      .toBeVisible();
    expect(
      screen.getByRole("link", { name: "Winter", exact: true }).query()
    ).toBeNull();
    // the same pill the list rows wear
    await expect
      .element(screen.getByText("Live", { exact: true }))
      .toHaveAttribute("data-tone", "success");
    const crumb = screen.getByRole("link", { name: "Campaigns" });
    expect((crumb.element() as HTMLElement).className).not.toContain(
      "pointer-events-none"
    );
    // the qr card links the same url; this is the link field's
    const form = page.elementLocator(
      screen.container.querySelector("form") as HTMLElement
    );
    const url = form.getByRole("link", {
      name: "https://x.test/org/acme/winter",
    });
    expect((url.element() as HTMLAnchorElement).getAttribute("target")).toBe(
      "_blank"
    );
    expect((url.element() as HTMLAnchorElement).getAttribute("rel")).toBe(
      "noopener noreferrer"
    );
  });

  it("counts the stored story on load", async () => {
    const story = JSON.stringify([
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [],
        children: [
          { _type: "span", _key: "s1", text: "Twelve chars", marks: [] },
        ],
      },
    ]);
    const screen = await render(edit_stub(true, story));
    await expect
      .element(screen.getByText("chars : 12 /8000", { exact: true }))
      .toBeVisible();
  });

  it("keeps a draft address as text", async () => {
    const screen = await render(edit_stub(false));
    await expect
      .element(screen.getByText("Draft", { exact: true }))
      .toBeVisible();
    const url = "https://x.test/org/acme/winter";
    const form = page.elementLocator(
      screen.container.querySelector("form") as HTMLElement
    );
    expect(form.getByRole("link", { name: url }).query()).toBeNull();
    await expect
      .element(form.getByText(`Donors will find this campaign at ${url}`))
      .toBeVisible();
  });
});

function edit_stub(
  published: boolean,
  description_pt = "A story of the drive"
) {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/campaigns/:campaign_id",
      Component: EditPage,
      loader: () => ({
        endow: {
          id: 7,
          slug: "acme",
          hide_bg_tip: false,
          donate_methods: ["stripe"],
          donate_frequencies: ["one-time"],
          logo: null,
        },
        campaign: {
          id: "c1",
          name: "Winter",
          slug: "winter",
          campaign_type: null,
          description_pt,
          banner: null,
          logo: null,
          videos: [],
          ends_at: null,
          target: undefined,
          increments: [],
          donate_methods: ["stripe"],
          donate_frequencies: ["one-time"],
          program_id: null,
          status: published ? "live" : "draft",
          published_at: published ? "2026-01-01T00:00:00.000Z" : null,
          mark: null,
        },
        programs: [],
        gift_count: 0,
        campaign_url: "https://x.test/org/acme/winter",
        origin: "https://x.test",
        shown_status: published ? "live" : "draft",
      }),
    },
  ]);
  return <Stub initialEntries={["/admin/7/campaigns/c1"]} />;
}
