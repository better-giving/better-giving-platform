import { eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { createRoutesStub, Link, Outlet, useFetcher } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { mswWorker } from "#/setup-tests-browser";
import { admin_ctx } from "$/auth/test-utils";
import { npo_get } from "$/pg/queries/npo";
import { npos } from "$/pg/schema/npo";
import { create_test_db, type TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

// .env.test carries a gateway key, so an unmocked layout pick would call the real gateway
vi.mock("$/jev", () => ({ jev_choice: async () => null }));

vi.mock("$/pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = test_db.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    session: { user: undefined },
  })
);

vi.mock("#/.server/toast", () => ({
  dataWithSuccess: vi.fn((d: unknown) => d),
  dataWithError: vi.fn((d: unknown) => d),
}));

vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

vi.mock("#/.server/funds", () => ({
  get_funds_npo_memberof: vi.fn(async () => []),
}));

import MarketplacePage, {
  loader as marketplace_loader,
} from "#/routes/_app.marketplace/route";
import ProfilePage, {
  loader as profile_loader,
} from "#/routes/org.$org._index/route";
import type { INpoUpdate } from "@/npo";
import { action, loader } from "../api";
import OrganizationPage from "../route";

const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN123456",
  name: "Test Charity",
  endow_designation: "Charity",
  hq_country: "United States",
  tagline: "Helping the world",
  image: "https://example.com/banner.jpg",
  logo: "https://example.com/logo.jpg",
  card_img: "https://example.com/card.jpg",
  overview_pt: "Test charity overview text.",
  overview_v2: "Test charity overview text.",
  active_in_countries: [],
  published: true,
  active: true,
  street_address: "123 Main St",
  url: "https://example.org",
};

const note = "Can't change once set, so links you've shared keep working.";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(npos);
  vi.restoreAllMocks();
  // msw handlers for profile page SWR calls
  mswWorker.use(
    http.get("/api/me", () => HttpResponse.json(null, { status: 401 })),
    http.get("/api/npo/:id/donors", () =>
      HttpResponse.json({ items: [], next: null })
    )
  );
});

async function seed_npo(
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) {
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({ ...NPO_SEED, ...overrides })
    .returning();
  return row!;
}

function stub(npo_id: number, route_action: unknown = action) {
  return createRoutesStub([
    {
      path: "/admin/:id/organization",
      Component: OrganizationPage,
      HydrateFallback: () => null,
      loader: loader as any,
      action: route_action as any,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
    },
  ]);
}

async function render_org(npo_id: number, route_action: unknown = action) {
  const Stub = stub(npo_id, route_action);
  return render(
    <Stub
      initialEntries={[`/admin/${npo_id}/organization`]}
      future={{ v8_middleware: true }}
    />
  );
}

async function render_profile(npo_id: number) {
  const npo = await npo_get(npo_id);
  const Stub = createRoutesStub([
    {
      path: "/org/:org",
      Component: ProfilePage as any,
      HydrateFallback: () => null,
      loader: profile_loader as any,
    },
  ]);

  return await render(
    <Stub initialEntries={[`/org/${npo?.slug || npo_id}`]} />
  );
}

async function render_marketplace() {
  const Stub = createRoutesStub([
    {
      path: "/marketplace",
      Component: MarketplacePage,
      HydrateFallback: () => null,
      loader: marketplace_loader,
    },
  ]);

  return await render(<Stub initialEntries={["/marketplace"]} />);
}

type Screen = Awaited<ReturnType<typeof render_org>>;

/** a set link reads as text with a copy button, and its field is gone */
async function expect_locked(screen: Screen, slug: string) {
  await expect
    .element(screen.getByRole("link", { name: new RegExp(`/org/${slug}$`) }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Copy page link" }))
    .toBeVisible();
  await expect.element(screen.getByText(note)).toBeVisible();
  expect(screen.getByLabelText("Profile link").query()).toBeNull();
  await expect
    .element(screen.getByRole("link", { name: new RegExp(`/donate/${slug}$`) }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Copy donate link" }))
    .toBeVisible();
}

function free_slug() {
  const og = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/npos/")) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return og(input, init as RequestInit);
  });
}

async function post(npo_id: number, body: { slug: string; tagline?: string }) {
  await cleanup();
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/organization",
      Component: function Poster() {
        const f = useFetcher<{ ok: boolean; error?: string }>();
        return (
          <>
            <button
              type="button"
              onClick={() =>
                f.submit(body, { method: "post", encType: "application/json" })
              }
            >
              save
            </button>
            <p>{f.data?.error}</p>
          </>
        );
      },
      action: action as any,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
    },
  ]);
  const screen = await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/organization`]}
      future={{ v8_middleware: true }}
    />
  );
  await screen.getByRole("button", { name: "save" }).click();
  return screen;
}

describe("organization — slug unset", () => {
  it("can be set, then shows locked", async () => {
    free_slug();
    const npo = await seed_npo();
    const screen = await render_org(npo.id);
    const slug = screen.getByLabelText("Profile link");
    await expect.element(slug).toBeEnabled();
    await expect.element(slug).toHaveAttribute("placeholder", "TestCharity");

    await slug.fill("acme-org");
    expect(
      screen
        .getByText("Logo of your organization")
        .element()
        .getAttribute("data-required")
    ).toBe("true");
    await screen.getByRole("button", { name: "Save organization" }).click();
    const cancel = screen.getByRole("button", { name: "Cancel", exact: true });
    await expect
      .element(screen.getByRole("heading", { name: "Lock your profile link?" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Your profile link can't be changed later."))
      .toBeVisible();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(cancel.element());
    });
    (
      screen
        .getByRole("button", { name: "Save", exact: true })
        .element() as HTMLElement
    ).click();

    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.slug).toBe("acme-org")
    );
    await expect_locked(screen, "acme-org");
  });

  it("previews the profile link as the slug is typed", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);
    const slug = screen.getByLabelText("Profile link");
    await expect
      .element(
        screen.getByText(
          new RegExp(
            `^Donors will find your profile at https?://[^/]+/org/${npo.id} until you set a link$`
          )
        )
      )
      .toBeVisible();

    await slug.fill("acme-org");
    await expect
      .element(
        screen.getByText(
          /^Donors will find your profile at https?:\/\/[^/]+\/org\/acme-org$/
        )
      )
      .toBeVisible();
    await expect
      .element(slug)
      .toHaveAccessibleDescription(
        /Your campaign links start with it too \(…\/org\/acme-org\/…\)\. Letters, numbers, and - \. _ ~/
      );
  });

  it("focuses the logo before a later invalid field", async () => {
    const npo = await seed_npo({ logo: "" });
    const screen = await render_org(npo.id);
    const reg = screen.getByLabelText(/ein.*registration/i);
    await expect.element(reg).toBeVisible();
    await reg.fill("NEW999");
    await screen.getByRole("button", { name: "Save organization" }).click();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByLabelText("Logo of your organization").element()
      );
    });
    expect((await npo_get(npo.id))?.registration_number).toBe("EIN123456");
  });

  it("a first slug beside an invalid website focuses the website and asks nothing", async () => {
    free_slug();
    const npo = await seed_npo();
    const screen = await render_org(npo.id);
    await screen.getByLabelText("Profile link").fill("acme-org");
    const website = screen.getByLabelText("Website of your organization");
    // a port that is not a number: chromium's parser escapes a space in a
    // host, so a spaced name would pass
    await website.fill("acme.example:web");
    await screen.getByRole("button", { name: "Save organization" }).click();

    await expect.element(website).toHaveFocus();
    await expect.element(screen.getByText("invalid url")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Lock your profile link?" }).query()
    ).toBeNull();

    // fixed, the same press asks to lock
    await website.fill("acme.example");
    await screen.getByRole("button", { name: "Save organization" }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Lock your profile link?" }))
      .toBeVisible();
  });

  it("asks before the first slug and cancel leaves it unset", async () => {
    free_slug();
    const npo = await seed_npo();
    const screen = await render_org(npo.id);
    await screen.getByLabelText("Profile link").fill("acme-org");
    await screen.getByRole("button", { name: "Save organization" }).click();
    const cancel = screen.getByRole("button", { name: "Cancel", exact: true });
    await expect.element(cancel).toBeVisible();
    (cancel.element() as HTMLElement).click();
    await expect
      .element(screen.getByRole("heading", { name: "Lock your profile link?" }))
      .not.toBeInTheDocument();
    expect((await npo_get(npo.id))?.slug).toBeFalsy();
    await expect.element(screen.getByLabelText("Profile link")).toBeEnabled();
  });
});

describe("organization — slug set", () => {
  it("shows the profile and donate links as text with copy buttons, no field", async () => {
    const npo = await seed_npo({ slug: "already-set" });
    const screen = await render_org(npo.id);
    await expect_locked(screen, "already-set");

    await screen.getByLabelText(/ein.*registration/i).fill("NEW999");
    await screen.getByRole("button", { name: "Save organization" }).click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.registration_number).toBe("NEW999")
    );
    expect((await npo_get(npo.id))?.slug).toBe("already-set");
  });
});

describe("organization — stored route slug", () => {
  it("saves other fields and leaves the slug", async () => {
    const npo = await seed_npo({ slug: "donate" });
    const screen = await render_org(npo.id);
    await expect_locked(screen, "donate");

    await screen.getByLabelText(/ein.*registration/i).fill("NEW999");
    await screen.getByRole("button", { name: "Save organization" }).click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.registration_number).toBe("NEW999")
    );
    expect((await npo_get(npo.id))?.slug).toBe("donate");
  });

  it("accepts a direct post that repeats the stored slug", async () => {
    const npo = await seed_npo({ slug: "donate" });
    await post(npo.id, { slug: "donate", tagline: "after" });
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.tagline).toBe("after")
    );
    expect((await npo_get(npo.id))?.slug).toBe("donate");
  });
});

describe("organization — server refusal", () => {
  it("refuses a direct post that changes a set slug", async () => {
    const npo = await seed_npo({ slug: "already-set" });
    const screen = await post(npo.id, { slug: "changed", tagline: "nope" });
    await expect
      .element(
        screen.getByText(
          "Your profile link is already set and can't be changed"
        )
      )
      .toBeVisible();
    const saved = await npo_get(npo.id);
    expect(saved?.slug).toBe("already-set");
    expect(saved?.tagline).toBe("Helping the world");
  });

  it("accepts a direct post that sets a slug for the first time", async () => {
    const npo = await seed_npo();
    await post(npo.id, { slug: "from-post" });
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.slug).toBe("from-post")
    );
  });

  it("refuses a reserved slug", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);
    const slug = screen.getByLabelText("Profile link");
    await slug.fill("donate");
    await screen.getByRole("button", { name: "Save organization" }).click();
    // refused before the lock prompt, which a slug that can't save never opens
    await expect
      .element(screen.getByText("donate matches a top-level route"))
      .toBeVisible();
    await expect.element(slug).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "Lock your profile link?" }).query()
    ).toBeNull();
    expect((await npo_get(npo.id))?.slug).toBeFalsy();

    await cleanup();
    const posted = await post(npo.id, { slug: "org" });
    await expect.element(posted.getByText("org is reserved")).toBeVisible();
    expect((await npo_get(npo.id))?.slug).toBeFalsy();
  });

  it("refuses a slug another nonprofit already has", async () => {
    const npo = await seed_npo();
    const other = await seed_npo({
      registration_number: "OTHER789",
      slug: "taken-slug",
    });
    const og = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/npos/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: other.id }), { status: 200 })
        );
      }
      return og(input, init as RequestInit);
    });

    const screen = await render_org(npo.id);
    await screen.getByLabelText("Profile link").fill("taken-slug");
    await screen.getByRole("button", { name: "Save organization" }).click();
    (
      screen
        .getByRole("button", { name: "Save", exact: true })
        .element() as HTMLElement
    ).click();
    await expect
      .element(screen.getByText(/taken-slug.*already taken/i))
      .toBeVisible();
    expect((await npo_get(npo.id))?.slug).toBeFalsy();

    vi.restoreAllMocks();
    await cleanup();
    const posted = await post(npo.id, { slug: "taken-slug" });
    await expect
      .element(posted.getByText("Slug taken-slug is already taken"))
      .toBeVisible();
    expect((await npo_get(npo.id))?.slug).toBeFalsy();
  });
});

describe("organization — headquarters", () => {
  it("clear blocks submit; refill persists", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);
    const country_input = screen.getByPlaceholder("Select a country");
    await expect.element(country_input).toHaveDisplayValue("United States");

    const combo_row = (country_input.element() as HTMLInputElement)
      .parentElement!;
    const buttons = page.elementLocator(combo_row).getByRole("button");
    await buttons.nth(1).click();

    (
      screen
        .getByRole("button", { name: "Save organization" })
        .element() as HTMLElement
    ).click();
    await expect.element(screen.getByText(/required/i).first()).toBeVisible();
    expect((await npo_get(npo.id))?.hq_country).toBe("United States");

    await country_input.fill("Fran");
    await expect
      .element(screen.getByRole("option", { name: /France/i }))
      .toBeVisible();
    await screen.getByRole("option", { name: /France/i }).click();
    await screen.getByRole("button", { name: "Save organization" }).click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.hq_country).toBe("France")
    );
  });

  it("clear button refocuses the input and reopens the dropdown", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);
    const country_input = screen.getByPlaceholder("Select a country");
    await expect.element(country_input).toHaveDisplayValue("United States");
    expect(screen.getByRole("option").query()).toBeNull();

    const combo_row = (country_input.element() as HTMLInputElement)
      .parentElement!;
    await page.elementLocator(combo_row).getByRole("button").nth(1).click();

    await expect.element(country_input).toHaveDisplayValue("");
    expect(document.activeElement).toBe(country_input.element());
    await expect
      .element(screen.getByRole("option", { name: /Afghanistan/i }))
      .toBeVisible();
  });
});

describe("organization — renders pre-filled", () => {
  it("shows seeded NPO data in form fields", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    // wait for form to render
    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();
    await expect
      .element(screen.getByLabelText(/tagline/i))
      .toHaveDisplayValue("Helping the world");

    const page_link = screen.getByRole("link", {
      name: "Your Better Giving Page",
    });
    await expect.element(page_link).toHaveAttribute("href", `/org/${npo.id}`);
    await expect.element(page_link).toHaveAttribute("target", "_blank");
    expect(page_link.element().querySelector("svg")).not.toBeNull();
    await expect
      .element(screen.getByLabelText(/address/i))
      .toHaveDisplayValue("123 Main St");
    // url: sans_https strips prefix
    await expect
      .element(screen.getByLabelText(/website/i))
      .toHaveDisplayValue("example.org");

    // submit disabled when not dirty
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save Better Giving Page" }).element()
        .className
    ).toContain("btn-primary");
    expect(
      screen.getByRole("button", { name: "Save organization" }).element()
        .className
    ).toContain("btn-primary");
    expect(
      screen.getByRole("button", { name: "Save social media" }).element()
        .className
    ).toContain("btn-primary");
  });

  it("puts the org facts above the Better Giving Page section, in outline order", async () => {
    const npo = await seed_npo({ slug: "kept-slug" });
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();
    const page_section = screen
      .getByRole("region", { name: "Your Better Giving Page" })
      .element();
    expect(page_section.id).toBe("page");
    await expect
      .element(screen.getByRole("link", { name: "Your Better Giving Page" }))
      .toHaveAttribute("href", "/org/kept-slug");

    const pos = (el: Element) =>
      [...document.querySelectorAll("*")].indexOf(el as HTMLElement);
    const org_facts = [
      screen.getByLabelText("Logo of your organization"),
      screen.getByLabelText(/ein.*registration/i),
      screen.getByPlaceholder("Select a country"),
      screen.getByLabelText(/website/i),
      screen.getByLabelText(/address/i),
      screen.getByRole("combobox", { name: "Active countries" }),
      screen.getByLabelText(/facebook/i),
    ].map((l) => pos(l.element()));
    const outline = [
      screen.getByLabelText(/tagline/i),
      screen.getByLabelText("Banner"),
      screen.getByText("Content", { exact: true }),
    ].map((l) => pos(l.element()));

    expect(org_facts).toEqual([...org_facts].sort((a, b) => a - b));
    expect(outline).toEqual([...outline].sort((a, b) => a - b));
    expect(Math.max(...org_facts)).toBeLessThan(pos(page_section));
    for (const el of outline) expect(el).toBeGreaterThan(pos(page_section));
    // the switch sits on the profile link's row, at the top of the section
    const published = pos(
      screen.getByRole("checkbox", { name: "Published" }).element()
    );
    expect(published).toBeGreaterThan(pos(page_section));
    expect(published).toBeLessThan(Math.min(...outline));

    // every card under the page's heading is one level below it
    for (const name of [
      "Organization",
      "Social Media",
      "Your Better Giving Page",
      "Donate link",
    ]) {
      await expect
        .element(screen.getByRole("heading", { name, exact: true, level: 3 }))
        .toBeInTheDocument();
    }
  });

  it("a first slug's save keeps an unsaved page edit", async () => {
    free_slug();
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    const tagline = screen.getByLabelText(/tagline/i);
    await tagline.fill("Unsaved tagline");
    await screen.getByLabelText("Profile link").fill("acme-org");
    await screen.getByRole("button", { name: "Save organization" }).click();
    (
      screen
        .getByRole("button", { name: "Save", exact: true })
        .element() as HTMLElement
    ).click();

    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.slug).toBe("acme-org")
    );
    await expect_locked(screen, "acme-org");
    await expect.element(tagline).toHaveDisplayValue("Unsaved tagline");
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeEnabled();
    expect((await npo_get(npo.id))?.tagline).toBe("Helping the world");
  });
});

describe("organization — text fields", () => {
  it("edits tagline, address → DB + profile", async () => {
    const npo = await seed_npo({ slug: "kept-slug" });
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    const tagline = screen.getByLabelText(/tagline/i);
    await tagline.clear();
    await tagline.fill("New tagline");

    const address = screen.getByLabelText(/address/i);
    await address.clear();
    await address.fill("456 New Ave");

    const general = screen.getByRole("button", {
      name: "Save Better Giving Page",
    });
    await general.click();
    const organization = screen.getByRole("button", {
      name: "Save organization",
    });
    await vi.waitFor(() => {
      expect(general.element()).toBeDisabled();
      expect(tagline.element()).toBeEnabled();
    });
    await organization.click();
    await expect.element(tagline).toBeEnabled();
    await expect.element(organization).toBeDisabled();
    await expect.element(tagline).toHaveDisplayValue("New tagline");

    const saved = await npo_get(npo.id);
    expect(saved?.registration_number).toBe("EIN123456");
    expect(saved?.name).toBe("Test Charity");
    expect(saved?.logo).toBe("https://example.com/logo.jpg");
    expect(saved?.endow_designation).toBe("Charity");
    expect(saved?.hq_country).toBe("United States");
    expect(saved?.slug).toBe("kept-slug");

    await screen.unmount();
    const profile = await render_profile(npo.id);

    await expect.element(profile.getByText("New tagline")).toBeInTheDocument();
    const details = profile.getByLabelText("Organization details");
    await expect.element(details.getByText("EIN123456")).toBeInTheDocument();
    await expect.element(details.getByText("456 New Ave")).toBeInTheDocument();
  });
});

describe("organization — organization fields", () => {
  it("designation and website changed here persist, the website under its https prefix", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    const website = screen.getByLabelText(/website/i);
    await expect.element(website).toHaveDisplayValue("example.org");
    await website.clear();
    await website.fill("newsite.org");
    await screen.getByRole("combobox", { name: /designation/i }).click();
    await screen.getByRole("option", { name: "University" }).click();
    await screen.getByRole("button", { name: "Save organization" }).click();

    await vi.waitFor(async () => {
      const saved = await npo_get(npo.id);
      expect(saved?.url).toBe("https://newsite.org");
      expect(saved?.endow_designation).toBe("University");
    });
    // the form reads back the stored value without the prefix, and is clean
    await expect.element(website).toHaveDisplayValue("newsite.org");
    await expect
      .element(screen.getByRole("button", { name: "Save organization" }))
      .toBeDisabled();

    await screen.unmount();
    const profile = await render_profile(npo.id);
    await expect
      .element(profile.getByRole("link", { name: "newsite.org" }))
      .toHaveAttribute("href", "https://newsite.org");
    await expect.element(profile.getByText("University")).toBeVisible();
  });

  it("an address save leaves designation + hq_country → DB + profile", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    await screen.getByLabelText(/address/i).fill("456 New Ave");
    await screen.getByRole("button", { name: "Save organization" }).click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.street_address).toBe("456 New Ave")
    );

    const saved = await npo_get(npo.id);
    expect(saved?.endow_designation).toBe("Charity");
    expect(saved?.hq_country).toBe("United States");

    await screen.unmount();
    const profile = await render_profile(npo.id);
    await expect
      .element(profile.getByText("Test Charity").first())
      .toBeVisible();
    await expect
      .element(profile.getByText(/united states/i).first())
      .toBeVisible();
  });
});

describe("organization — active countries (multi-combo)", () => {
  it("filter → select multiple, deselect all, refill → DB persists array", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    // anchor on the "Active countries" Label and scope into its sibling section
    const label_el = screen
      .getByText("Active countries", { exact: true })
      .element() as HTMLElement;
    const multi_section = label_el.nextElementSibling as HTMLElement;
    const scoped = page.elementLocator(multi_section);
    const multi_input = scoped.getByRole("combobox");

    // open + filter via typing
    await multi_input.click();
    await multi_input.fill("Cana");
    await expect
      .element(screen.getByRole("option", { name: /^Canada$/i }))
      .toBeVisible();
    // filter narrows — Brazil is filtered out
    expect(
      screen.getByRole("option", { name: /^Brazil$/i }).query()
    ).toBeNull();
    await screen.getByRole("option", { name: /^Canada$/i }).click();

    // chip rendered in the multi-combo section (scoped — popup options share the text)
    await expect
      .element(scoped.getByText("Canada", { exact: true }))
      .toBeVisible();

    // filter + select second value
    await multi_input.fill("Fran");
    await screen.getByRole("option", { name: /^France$/i }).click();
    await expect
      .element(scoped.getByText("France", { exact: true }))
      .toBeVisible();

    // Reset clears all chips. Portaled popup may render offscreen — native click bypasses viewport check
    await multi_input.click();
    await multi_input.fill("");
    (
      screen.getByRole("button", { name: /^reset$/i }).element() as HTMLElement
    ).click();
    // chips live in multi_section; options are portaled out — scope assertions to the section
    await expect
      .element(scoped.getByText("Canada", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(scoped.getByText("France", { exact: true }))
      .not.toBeInTheDocument();

    // refill single + submit → DB persists array
    await multi_input.fill("Cana");
    await screen.getByRole("option", { name: /^Canada$/i }).click();
    // popup stays open after multi-select; dismiss before clicking submit
    (multi_input.element() as HTMLInputElement).focus();
    (multi_input.element() as HTMLInputElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await screen.getByRole("button", { name: "Save organization" }).click();

    await vi.waitFor(async () => {
      const reloaded = await npo_get(npo.id);
      expect(reloaded?.active_in_countries).toEqual(["Canada"]);
    });
  });
});

describe("organization — social media", () => {
  it("adds social URLs → DB + profile", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/facebook/i)).toBeVisible();

    await screen.getByLabelText(/facebook/i).fill("facebook.com/testorg");
    await screen.getByLabelText(/linkedin/i).fill("linkedin.com/in/testorg");

    // submit
    await screen.getByRole("button", { name: "Save social media" }).click();

    // revalidation completes → form resets dirty
    await expect
      .element(screen.getByLabelText(/facebook/i))
      .toHaveDisplayValue("facebook.com/testorg");
    // isDirty resets async — one render after values sync
    await expect
      .element(screen.getByRole("button", { name: "Save social media" }))
      .toBeDisabled();

    // verify on profile page — socials renders ExtLinks
    await screen.unmount();
    const profile = await render_profile(npo.id);

    await expect
      .element(profile.getByText("Test Charity").first())
      .toBeVisible();
    // social icons render as links
    const links = profile.getByRole("link");
    // use vi.waitFor for non-element assertion on locator results
    await vi.waitFor(async () => {
      const els = links.elements();
      const hrefs = els.map((l) => l.getAttribute("href"));
      expect(hrefs).toContain("https://facebook.com/testorg");
      expect(hrefs).toContain("https://linkedin.com/in/testorg");
    });
  });
});

describe("organization — published toggle", () => {
  it("flipping publish saves it on the spot, leaving other edits unsent", async () => {
    const npo = await seed_npo({ published: false });
    const screen = await render_org(npo.id);

    // initially unpublished
    await expect
      .element(screen.getByText("Hidden from the marketplace"))
      .toBeVisible();

    const tagline = screen.getByLabelText(/tagline/i);
    await tagline.fill("Unsaved tagline");

    // click toggle — dispatch via JS (element below fold, not visible to Playwright)
    (
      screen
        .getByRole("checkbox", { name: "Published" })
        .element() as HTMLElement
    ).click();

    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.published).toBe(true)
    );
    expect((await npo_get(npo.id))?.tagline).toBe("Helping the world");

    await expect.element(tagline).toBeEnabled();
    await expect.element(tagline).toHaveDisplayValue("Unsaved tagline");
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeEnabled();
    await expect
      .element(screen.getByText("Visible in the marketplace"))
      .toBeInTheDocument();

    // verify NPO appears on marketplace (filters by published)
    await screen.unmount();
    const marketplace = await render_marketplace();

    await expect
      .element(marketplace.getByText("Test Charity"))
      .toBeInTheDocument();
  });

  it("a refused publish reverts to the stored value, through a later save's revalidation", async () => {
    const npo = await seed_npo({ published: false });
    let calls = 0;
    const refuse_first: typeof action = async (args) =>
      calls++ === 0 ? { ok: false } : action(args);
    const screen = await render_org(npo.id, refuse_first);

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();

    const toggle = screen.getByRole("checkbox", { name: "Published" });
    (toggle.element() as HTMLElement).click();
    await vi.waitFor(() => expect(calls).toBe(1));
    await expect.element(toggle).toBeEnabled();
    await expect.element(toggle).not.toBeChecked();
    await expect
      .element(screen.getByText("Hidden from the marketplace"))
      .toBeVisible();

    await tagline.fill("New tagline");
    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.tagline).toBe("New tagline")
    );
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeDisabled();
    await expect.element(tagline).toBeEnabled();

    expect((await npo_get(npo.id))?.published).toBe(false);
    await expect.element(toggle).not.toBeChecked();
    await expect
      .element(screen.getByText("Hidden from the marketplace"))
      .toBeVisible();
  });
});

describe("organization — a page save leaves the slug", () => {
  it("an unset slug stays unset", async () => {
    const npo = await seed_npo();
    await seed_npo({
      registration_number: "OTHER789",
      slug: "taken-slug",
    });

    const screen = await render_org(npo.id);
    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    const tagline = screen.getByLabelText(/tagline/i);
    await tagline.fill("New tagline");
    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.tagline).toBe("New tagline")
    );
    expect((await npo_get(npo.id))?.slug).toBeFalsy();
  });

  it("a set slug is kept; the save disarms", async () => {
    const npo = await seed_npo({ slug: "kept-slug" });
    await seed_npo({ registration_number: "OTHER789", slug: "server-taken" });

    const screen = await render_org(npo.id);
    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();

    await tagline.fill("New tagline");
    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.tagline).toBe("New tagline")
    );
    await expect.element(tagline).toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeDisabled();
    expect((await npo_get(npo.id))?.slug).toBe("kept-slug");
  });
});

describe("organization — switching profiles", () => {
  it("navigating to another profile shows that profile's values", async () => {
    const first = await seed_npo();
    const second = await seed_npo({
      registration_number: "SECOND456",
      tagline: "Second tagline",
    });
    const Stub = createRoutesStub([
      {
        Component: () => (
          <>
            <Link to={`/admin/${second.id}/organization`}>Second profile</Link>
            <Outlet />
          </>
        ),
        children: [
          {
            path: "/admin/:id/organization",
            Component: OrganizationPage,
            HydrateFallback: () => null,
            loader: loader as any,
            action: action as any,
            middleware: [
              async ({ context, params }, next) => {
                context.set(admin_ctx, Number(params.id));
                return next();
              },
            ],
          },
        ],
      },
    ]);
    const screen = await render(
      <Stub
        initialEntries={[`/admin/${first.id}/organization`]}
        future={{ v8_middleware: true }}
      />
    );

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toHaveDisplayValue("Helping the world");
    await screen.getByRole("link", { name: "Second profile" }).click();
    await expect.element(tagline).toHaveDisplayValue("Second tagline");
  });
});

describe("organization — per-group save", () => {
  it("each group's save stays disabled until that group is dirty", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    const general = screen.getByRole("button", {
      name: "Save Better Giving Page",
    });
    const organization = screen.getByRole("button", {
      name: "Save organization",
    });
    const social = screen.getByRole("button", { name: "Save social media" });
    await expect.element(general).toBeDisabled();
    await expect.element(organization).toBeDisabled();
    await expect.element(social).toBeDisabled();

    await screen.getByLabelText(/tagline/i).fill("New tagline");
    await expect.element(general).toBeEnabled();
    await expect.element(organization).toBeDisabled();
    await expect.element(social).toBeDisabled();

    await screen.getByLabelText(/facebook/i).fill("facebook.com/testorg");
    await expect.element(social).toBeEnabled();
    await expect.element(organization).toBeDisabled();
  });

  it("saving organization sends only its fields; a dirty general edit survives unsent", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    await screen.getByLabelText(/tagline/i).fill("Unsaved tagline");
    await screen.getByLabelText(/address/i).fill("456 New Ave");

    const organization = screen.getByRole("button", {
      name: "Save organization",
    });
    await organization.click();

    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.street_address).toBe("456 New Ave")
    );
    expect((await npo_get(npo.id))?.tagline).toBe("Helping the world");

    // organization's save disarms only once its write is confirmed, after the
    // loader has revalidated — the page group is read past that point
    await expect.element(organization).toBeDisabled();
    await expect
      .element(screen.getByLabelText(/address/i))
      .toHaveDisplayValue("456 New Ave");
    await expect
      .element(screen.getByLabelText(/tagline/i))
      .toHaveDisplayValue("Unsaved tagline");
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeEnabled();

    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.tagline).toBe("Unsaved tagline")
    );
    await expect.element(screen.getByLabelText(/tagline/i)).toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeDisabled();
  });

  it("an invalid general field does not block saving organization", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    await screen.getByLabelText(/tagline/i).clear();
    await screen.getByLabelText(/address/i).fill("456 New Ave");

    await screen.getByRole("button", { name: "Save organization" }).click();

    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.street_address).toBe("456 New Ave")
    );
    expect((await npo_get(npo.id))?.tagline).toBe("Helping the world");
    // the page group validates only on its own save
    expect(screen.getByText(/required/i).query()).toBeNull();
  });

  it("an edit made while a save is in flight survives it, unsaved", async () => {
    const npo = await seed_npo();
    let open_gate = () => {};
    const gate = new Promise<void>((r) => {
      open_gate = r;
    });
    const gated: typeof action = async (args) => {
      await gate;
      return action(args);
    };
    const screen = await render_org(npo.id, gated);

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();
    await tagline.fill("New tagline");
    const general = screen.getByRole("button", {
      name: "Save Better Giving Page",
    });
    await general.click();
    await expect.element(tagline).toBeDisabled();

    // the fieldset holds native inputs only; the rich text stays editable
    const editor = () =>
      screen.container.querySelector<HTMLElement>('[contenteditable="true"]');
    await vi.waitFor(() => expect(editor()).not.toBeNull());
    const counted = screen.getByText(/chars :/).element().textContent!;
    const before = Number(counted.match(/\d+/));
    await userEvent.click(editor()!);
    await userEvent.keyboard(" More");
    // the counter reads the form's value, not the editor's DOM
    const counter = screen.getByText(`chars : ${before + 5} `);
    await expect.element(counter).toBeInTheDocument();

    open_gate();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.tagline).toBe("New tagline")
    );
    await expect.element(tagline).toBeEnabled();
    await expect.element(counter).toBeInTheDocument();
    await expect.element(general).toBeEnabled();

    await general.click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.overview_v2).toMatch(/More/)
    );
    await expect.element(general).toBeDisabled();
  });

  it("a field's error clears as it is fixed after a failed save", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();
    await tagline.clear();

    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();
    await expect.element(screen.getByText(/required/i).first()).toBeVisible();

    await tagline.fill("Fixed tagline");
    await expect.element(screen.getByText(/required/i)).not.toBeInTheDocument();
    expect((await npo_get(npo.id))?.tagline).toBe("Helping the world");
  });
});

/** native clicks, dispatched in one tick, so the saves are in flight together
 * rather than one after another's actionability wait */
const press = (...locators: { element: () => Element }[]) => {
  for (const l of locators) (l.element() as HTMLElement).click();
};

describe("organization — back-to-back saves", () => {
  it("a general save and a publish fired together both write and settle", async () => {
    const npo = await seed_npo({ published: false });
    const screen = await render_org(npo.id);

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();
    await tagline.fill("New tagline");

    const general = screen.getByRole("button", {
      name: "Save Better Giving Page",
    });
    press(general, screen.getByRole("checkbox", { name: "Published" }));

    await vi.waitFor(async () => {
      const row = await npo_get(npo.id);
      expect(row?.tagline).toBe("New tagline");
      expect(row?.published).toBe(true);
    });
    await expect.element(tagline).toBeEnabled();
    await expect.element(general).toBeDisabled();
    await expect
      .element(screen.getByText("Visible in the marketplace"))
      .toBeInTheDocument();
  });

  it("two group saves fired together both write and settle", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();
    await tagline.fill("New tagline");
    await screen.getByLabelText(/address/i).fill("456 New Ave");

    const general = screen.getByRole("button", {
      name: "Save Better Giving Page",
    });
    const organization = screen.getByRole("button", {
      name: "Save organization",
    });
    press(general, organization);

    await vi.waitFor(async () => {
      const row = await npo_get(npo.id);
      expect(row?.tagline).toBe("New tagline");
      expect(row?.street_address).toBe("456 New Ave");
    });
    await expect.element(tagline).toBeEnabled();
    await expect.element(general).toBeDisabled();
    await expect.element(organization).toBeDisabled();
  });

  it("a refused save fired just before a confirmed one stays unsaved", async () => {
    const npo = await seed_npo();
    let calls = 0;
    const refuse_first: typeof action = async (args) =>
      calls++ === 0 ? { ok: false } : action(args);
    const screen = await render_org(npo.id, refuse_first);

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();
    await tagline.fill("Refused tagline");
    await screen.getByLabelText(/address/i).fill("456 New Ave");

    const general = screen.getByRole("button", {
      name: "Save Better Giving Page",
    });
    const organization = screen.getByRole("button", {
      name: "Save organization",
    });
    press(general, organization);

    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.street_address).toBe("456 New Ave")
    );
    await expect.element(tagline).toBeEnabled();
    await expect.element(organization).toBeDisabled();
    await expect.element(general).toBeEnabled();
    await expect.element(tagline).toHaveDisplayValue("Refused tagline");
    expect(calls).toBe(2);
    expect((await npo_get(npo.id))?.tagline).toBe("Helping the world");
  });

  it("the action's schema refusal prompts its message, on the retry too", async () => {
    const npo = await seed_npo();
    // the client schema never lets this body out, so the action gets it forged
    const malformed: typeof action = (args) =>
      action({
        ...args,
        request: new Request(args.request.url, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tagline: "x".repeat(141) }),
        }),
      });
    const screen = await render_org(npo.id, malformed);

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();
    await tagline.fill("New tagline");

    const general = screen.getByRole("button", {
      name: "Save Better Giving Page",
    });
    const message = screen.getByText(/invalid length/i);
    const close = screen.getByRole("button", { name: "Close" });
    for (const _ of [1, 2]) {
      await general.click();
      await expect.element(message).toBeVisible();
      press(close);
      await expect.element(message).not.toBeInTheDocument();
      await expect.element(general).toBeEnabled();
    }
  });
});

describe("organization — validation", () => {
  it("rejects empty required fields", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    const tagline = screen.getByLabelText(/tagline/i);
    await tagline.clear();

    // submit — client-side validation blocks the action
    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();

    // form stays on page, submit still enabled (dirty + invalid)
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeEnabled();
  });
});

describe("organization — focus after a keyboard save", () => {
  // a saved group's button disarms (nothing dirty), so the focus its
  // fieldset ejected lands on the form, not <body>
  it.each([
    { group: "Better Giving Page", field: /tagline/i, value: "New tagline" },
    { group: "organization", field: /address/i, value: "456 New Ave" },
    {
      group: "social media",
      field: /facebook/i,
      value: "facebook.com/testorg",
    },
  ])(
    "saving $group returns focus to the form",
    async ({ group, field, value }) => {
      const npo = await seed_npo();
      const screen = await render_org(npo.id);

      const input = screen.getByLabelText(field);
      await expect.element(input).toBeVisible();
      await input.fill(value);

      const save = screen.getByRole("button", { name: `Save ${group}` });
      await expect.element(save).toBeEnabled();
      (save.element() as HTMLElement).focus();
      await userEvent.keyboard("{Enter}");

      await vi.waitFor(() => {
        expect(save.element()).toBeDisabled();
        expect(input.element()).toBeEnabled();
      });
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(
          (save.element() as HTMLElement).closest("form")
        )
      );
    }
  );
});

describe("organization — focus on error", () => {
  it("missing banner image takes focus on submit", async () => {
    // without the scroll the banner goes to its error state off-screen, so the
    // submit reads as doing nothing
    const npo = await seed_npo({ image: "" });
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    // submit is disabled until dirty, so touch a field the schema accepts
    const tagline = screen.getByLabelText(/tagline/i);
    await tagline.clear();
    await tagline.fill("Still helping the world");

    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByLabelText("Banner").element()
      );
    });
  });
});

describe("organization — card image", () => {
  it("has no control, and a page save neither sends nor clears it", async () => {
    const npo = await seed_npo();
    const sent: Record<string, unknown>[] = [];
    const spy: typeof action = async (args) => {
      sent.push(await args.request.clone().json());
      return action(args);
    };
    const screen = await render_org(npo.id, spy);

    const tagline = screen.getByLabelText(/tagline/i);
    await expect.element(tagline).toBeVisible();
    expect(screen.getByLabelText("Card image").query()).toBeNull();

    await tagline.fill("New tagline");
    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();
    await vi.waitFor(async () =>
      expect((await npo_get(npo.id))?.tagline).toBe("New tagline")
    );
    expect(sent).toEqual([{ tagline: "New tagline" }]);
    expect((await npo_get(npo.id))?.card_img).toBe(
      "https://example.com/card.jpg"
    );
  });
});

describe("organization — image fields", () => {
  it("each upload is named by its caption; a missing one is invalid and described by its error", async () => {
    const npo = await seed_npo({ image: "", logo: "", card_img: "" });
    const screen = await render_org(npo.id);

    const captions = ["Banner"];
    const inputs = captions.map((c) => screen.getByLabelText(c));
    for (const [i, input] of inputs.entries()) {
      await expect.element(input).toHaveAccessibleName(captions[i]);
      await expect.element(input).not.toHaveAttribute("aria-invalid", "true");
    }

    const tagline = screen.getByLabelText(/tagline/i);
    await tagline.clear();
    await tagline.fill("Still helping the world");
    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();

    for (const input of inputs) {
      await expect.element(input).toHaveAttribute("aria-invalid", "true");
      await expect.element(input).toHaveAccessibleDescription(/required/);
    }
  });
});

/** target lives in the npos row as an XOR pair, not as the domain's single
 * `target` field — read the columns directly so a wipe can't hide behind
 * `to_target`'s undefined */
async function target_cols(npo_id: number) {
  const [row] = await test_db
    .current!.db.select({
      target_number: npos.target_number,
      target_smart: npos.target_smart,
    })
    .from(npos)
    .where(eq(npos.id, npo_id));
  return row;
}

describe("organization — fundraising goal", () => {
  it("a save that sends no target leaves the existing goal alone", async () => {
    const npo = await seed_npo({ target_number: 25_000 });
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    const tagline = screen.getByLabelText(/tagline/i);
    await tagline.clear();
    await tagline.fill("New tagline");

    await screen
      .getByRole("button", { name: "Save Better Giving Page" })
      .click();

    await expect
      .element(screen.getByLabelText(/tagline/i))
      .toHaveDisplayValue("New tagline");
    // isDirty resets async — one render after values sync
    await expect
      .element(screen.getByRole("button", { name: "Save Better Giving Page" }))
      .toBeDisabled();

    expect(await target_cols(npo.id)).toEqual({
      target_number: 25_000,
      target_smart: null,
    });
  });
});

/** this page itself never sends `target` — only the settings donation form
 * does. this drives the same action over the same json transport so the
 * sent-target half of the contract is covered here too. */
async function submit_json(npo_id: number, body: INpoUpdate) {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/organization",
      Component: function JsonSubmitter() {
        const f = useFetcher();
        return (
          <button
            type="button"
            onClick={() =>
              f.submit(body, { method: "post", encType: "application/json" })
            }
          >
            save
          </button>
        );
      },
      action: action as any,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
    },
  ]);

  const screen = await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/organization`]}
      future={{ v8_middleware: true }}
    />
  );
  await screen.getByRole("button", { name: "save" }).click();
}

describe("organization — fundraising goal, sent", () => {
  it("a sent target still writes: smart, then a fixed number", async () => {
    const npo = await seed_npo({ target_number: 25_000 });

    await submit_json(npo.id, { target: "smart" });
    await vi.waitFor(async () =>
      expect(await target_cols(npo.id)).toEqual({
        target_number: null,
        target_smart: true,
      })
    );

    await cleanup();
    await submit_json(npo.id, { target: "9000" });
    await vi.waitFor(async () =>
      expect(await target_cols(npo.id)).toEqual({
        target_number: 9000,
        target_smart: null,
      })
    );
  });

  it('target "0" — the deliberate "no goal" clear — still writes', async () => {
    const npo = await seed_npo({ target_smart: true });

    await submit_json(npo.id, { tagline: "New tagline", target: "0" });

    await vi.waitFor(async () =>
      // "0" is the domain's "no goal": target_number 0, not the null pair
      expect(await target_cols(npo.id)).toEqual({
        target_number: 0,
        target_smart: null,
      })
    );
    expect((await npo_get(npo.id))?.target).toBe("0");
  });
});

describe("organization — every caption names something", () => {
  it("names the active-countries and designation controls", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    // by role, not by label: the combobox's popup borrows the same label id
    // through `aria-labelledby`, so a label query resolves to two elements
    await expect
      .element(screen.getByRole("combobox", { name: "Active countries" }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("combobox", { name: "Organization Designation" })
      )
      .toBeVisible();
  });

  it("has no <label> pointing at a control that does not exist", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();

    // `.control` resolves both spellings — htmlFor and nesting — so a null is
    // a caption wearing a <label> element and naming nothing
    const orphaned = [
      ...document.querySelectorAll<HTMLLabelElement>("form label"),
    ]
      .filter((l) => l.control == null)
      .map((l) => l.textContent?.trim());

    expect(orphaned).toEqual([]);
  });

  it("shows the legal name as text, with the address that changes it", async () => {
    const npo = await seed_npo();
    const screen = await render_org(npo.id);

    await expect.element(screen.getByLabelText(/tagline/i)).toBeVisible();
    expect(
      screen
        .getByRole("textbox", { name: /name of your organization/i })
        .query()
    ).toBeNull();
    await expect
      .element(screen.getByText("Test Charity", { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText(/your legal name from your application/i))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "hi@better.giving" }))
      .toHaveAttribute("href", "mailto:hi@better.giving");
  });
});
