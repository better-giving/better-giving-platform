import { AskHost } from "@better-giving/ui";
import { createRoutesStub, useLocation } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { user } from "$/pg/schema/auth";
import { campaigns as campaign_table } from "$/pg/schema/campaign";
import { funds as fund_table } from "$/pg/schema/fund";
import { npos } from "$/pg/schema/npo";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks ---

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

vi.mock("$/kit/queue", () => ({
  receiver: {},
  client: {},
  enqueue: vi.fn(),
  don_dist: vi.fn(),
  verify_qstash: vi.fn(),
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    session: true,
    user_ctx: true,
  })
);

vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return {
    redirectWithSuccess: vi.fn((url: string) => redirect(url)),
    dataWithSuccess: vi.fn((_d: unknown, msg: string) => ({ toast: msg })),
    dataWithError: vi.fn((_d: unknown, msg: string) => ({ error: msg })),
  };
});

// --- imports after mocks ---

import { Suspense } from "react";
import { Await } from "react-router";
import { dataWithSuccess } from "#/.server/toast";
import {
  seed_fund as insert_fund,
  seed_npo as insert_npo,
  seed_user as insert_user,
} from "#/__tests__/fixtures/funds";
import { loader as campaigns_loader } from "#/routes/admin.$id.campaigns/api";
import CampaignsPage from "#/routes/admin.$id.campaigns/route";
import { loader as profile_loader } from "#/routes/org.$org._index/api";
import type { IFundItem } from "@/fundraiser";
import { admin_ctx, user_ctx } from "$/auth/test-utils";
import { enqueue } from "$/kit/queue";
import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "../api";

// --- setup ---

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await cleanup();
  // campaigns reference funds (legacy_fund_id) and npos, so drop them first
  await test_db.current!.db.delete(campaign_table);
  await test_db.current!.db.delete(fund_table);
  await test_db.current!.db.delete(npos);
  await test_db.current!.db.delete(user);
});

// --- helpers ---

const db = () => test_db.current!.db;

const seed_npo = (
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) =>
  insert_npo(db(), {
    registration_number: "EIN-FUNDS",
    name: "Funds Test NPO",
    published: true,
    ...overrides,
  });

const seed_user = (email: string, first = "Test", last = "User") =>
  insert_user(db(), email, first, last);

const seed_fund = (vals: Parameters<typeof insert_fund>[1]) =>
  insert_fund(db(), vals);

const MOCK_USER = {
  token_refresh: "tok",
  groups: [] as string[],
  endowments: [] as number[],
  funds: [] as string[],
  email: "admin@test.com",
};

function SearchProbe() {
  return <output data-testid="url-search">{useLocation().search}</output>;
}

async function render_funds(
  npo_id: number,
  user = MOCK_USER,
  search = "",
  // holds the route action open so a test can read the in-flight leave
  hold?: { gate: Promise<void>; posts: { n: number } }
) {
  const mdlwr = [
    async ({ context }: any, next: any) => {
      context.set(admin_ctx, npo_id);
      context.set(user_ctx, user);
      return next();
    },
  ];
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/funds",
      Component: () => null,
      HydrateFallback: () => null,
      loader: loader as any,
      action: (hold
        ? async (args: any) => {
            hold.posts.n += 1;
            await hold.gate;
            return action(args);
          }
        : action) as any,
      middleware: mdlwr,
    },
    {
      path: "/admin/:id/campaigns",
      Component: (props: any) => (
        <>
          <CampaignsPage {...props} />
          <SearchProbe />
          {/* the leave confirm is raised through `ask`, which mounts at `AskHost` */}
          <AskHost />
        </>
      ),
      HydrateFallback: () => null,
      loader: campaigns_loader as any,
      middleware: mdlwr,
    },
    {
      path: "/fundraisers/:fund_id/edit",
      Component: () => <div data-testid="edit-page" />,
    },
    {
      path: "/fundraisers/new",
      Component: () => <div data-testid="new-fund-page" />,
    },
    {
      path: "/fundraisers/:fund_id",
      Component: () => <div data-testid="fund-page" />,
    },
  ]);
  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/funds${search}`]}
      future={{ v8_middleware: true }}
    />
  );
}

async function render_profile(npo_id: number) {
  const Stub = createRoutesStub([
    {
      path: "/org/:org",
      HydrateFallback: () => null,
      Component: ({ loaderData }: any) => (
        <Suspense fallback={null}>
          <Await resolve={loaderData.funds}>
            {(f: IFundItem[]) =>
              f.length > 0 ? (
                <div>
                  {f.map((fund) => (
                    <div key={fund.id}>{fund.name}</div>
                  ))}
                </div>
              ) : (
                <div>No profile funds</div>
              )
            }
          </Await>
        </Suspense>
      ),
      loader: profile_loader as any,
    },
  ]);
  return await render(<Stub initialEntries={[`/org/${npo_id}`]} />);
}

// --- tests ---

describe("funds — filter and display", () => {
  it("redirects a funds GET onto the supporter tab", async () => {
    const call = (search: string) =>
      loader({
        request: new Request(`http://x/admin/7/funds${search}`),
        params: { id: "7" },
        context: { get: (k: unknown) => (k === admin_ctx ? 7 : undefined) },
      } as any);

    const ours = await call("?creator=ours");
    expect(ours.status).toBe(302);
    expect(ours.headers.get("Location")).toBe(
      "/admin/7/campaigns?tab=fundraisers&creator=ours"
    );
    const others = await call("?creator=others");
    expect(others.headers.get("Location")).toBe(
      "/admin/7/campaigns?tab=fundraisers&creator=others"
    );
    expect((await call("?creator=all")).headers.get("Location")).toBe(
      "/admin/7/campaigns?tab=fundraisers"
    );
    expect((await call("")).headers.get("Location")).toBe(
      "/admin/7/campaigns?tab=fundraisers"
    );
    expect((await call("?creator=nope")).headers.get("Location")).toBe(
      "/admin/7/campaigns?tab=fundraisers"
    );
  });

  it("lists only supporters' campaigns and has no Creator control", async () => {
    const npo = await seed_npo();
    const other_npo = await seed_npo({
      registration_number: "EIN-OTHER",
      name: "Other NPO",
    });

    const npo_user = await seed_user("npo-user@test.com", "Our", "NPO");
    const other_user = await seed_user("other-user@test.com", "Other", "NPO");

    await seed_fund({
      id: "aaaaaaaa-0001-0001-0001-000000000001",
      name: "Our Gala Fund",
      npo_owner: npo.id,
      creator_id: npo_user.id,
      members: [npo.id, other_npo.id],
    });

    await seed_fund({
      id: "aaaaaaaa-0002-0002-0002-000000000002",
      name: "Supporter Drive",
      npo_owner: other_npo.id,
      creator_id: other_user.id,
      members: [npo.id, other_npo.id],
    });

    const screen = await render_funds(npo.id, {
      ...MOCK_USER,
      endowments: [npo.id],
    });

    await expect
      .element(
        screen.getByRole("heading", {
          level: 1,
          name: "Campaigns",
          exact: true,
        })
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("tab", { name: "Supporter campaigns", exact: true })
      )
      .toHaveAttribute("aria-selected", "true");
    expect(
      screen
        .getByRole("heading", { name: "Supporter campaigns", exact: true })
        .query()
    ).toBeNull();
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
      .toBeInTheDocument();

    expect(
      screen.getByRole("combobox", { name: "Creator", exact: true }).query()
    ).toBeNull();
    await expect
      .element(screen.getByText("Supporter Drive"))
      .toBeInTheDocument();
    expect(screen.getByText("Our Gala Fund").query()).toBeNull();

    await expect
      .element(screen.getByRole("link", { name: /\+ create/i }))
      .not.toBeInTheDocument();
  });

  it("lists a fund with no owning nonprofit as a supporter campaign", async () => {
    const npo = await seed_npo();
    const creator = await seed_user("creator@test.com", "Some", "Creator");

    await seed_fund({
      id: "aaaaaaaa-0003-0003-0003-000000000003",
      name: "Community Fund",
      npo_owner: null,
      creator_id: creator.id,
      members: [npo.id],
    });

    const screen = await render_funds(npo.id);

    await expect
      .element(screen.getByText("Community Fund"))
      .toBeInTheDocument();
  });

  it("labels each supporter campaign Draft, Closed, Ended or Live", async () => {
    const npo = await seed_npo();
    const other_npo = await seed_npo({
      registration_number: "EIN-STATUS",
      name: "Status NPO",
    });
    const creator = await seed_user("status@test.com", "Stat", "Us");
    const seed = (n: number, name: string, vals: object) =>
      seed_fund({
        id: `dddddddd-000${n}-000${n}-000${n}-00000000000${n}`,
        name,
        npo_owner: other_npo.id,
        creator_id: creator.id,
        members: [npo.id, other_npo.id],
        published: true,
        ...vals,
      });
    await seed(1, "Draft drive", { published: false });
    await seed(2, "Closed drive", { active: false });
    await seed(3, "Ended drive", { expiration: "2020-01-02T00:00:00.000Z" });
    await seed(4, "Live drive", { expiration: "2099-03-04T00:00:00.000Z" });

    const screen = await render_funds(npo.id);
    const pill = (name: string, word: string) =>
      screen
        .getByRole("listitem")
        .filter({ hasText: name })
        .getByText(word, { exact: true });
    await expect.element(pill("Draft drive", "Draft")).toBeVisible();
    await expect.element(pill("Closed drive", "Closed")).toBeVisible();
    await expect.element(pill("Ended drive", "Ended")).toBeVisible();
    await expect.element(pill("Live drive", "Live")).toBeVisible();
    await expect
      .element(pill("Ended drive", "Ended Jan 2, 2020"))
      .toBeVisible();
    await expect.element(pill("Live drive", "Ends Mar 4, 2099")).toBeVisible();
  });

  it("shows empty message when no funds exist", async () => {
    await seed_user("seed@test.com");
    const npo = await seed_npo();

    const screen = await render_funds(npo.id);

    await expect
      .element(
        screen.getByRole("heading", {
          name: "No supporter campaigns yet",
          exact: true,
        })
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "Campaigns people start for your nonprofit will show up here.",
          { exact: true }
        )
      )
      .toBeInTheDocument();
  });
});

describe("funds — opt out", () => {
  it("npo opts out of a supporter fund, fund removed from admin list and profile page", async () => {
    const npo = await seed_npo();
    const other_npo = await seed_npo({
      registration_number: "EIN-OTHER2",
      name: "Creator NPO",
    });
    const creator_user = await seed_user(
      "creator-user@test.com",
      "Creator",
      "Person"
    );

    await seed_fund({
      id: "bbbbbbbb-0001-0001-0001-000000000001",
      name: "Community Drive",
      npo_owner: other_npo.id,
      creator_id: creator_user.id,
      members: [npo.id, other_npo.id],
      published: true,
    });

    // profile page shows the fund before opt-out
    let screen = await render_profile(npo.id);
    await expect
      .element(screen.getByText("Community Drive"))
      .toBeInTheDocument();
    await cleanup();

    // admin opts out from the supporter tab
    screen = await render_funds(npo.id, { ...MOCK_USER, endowments: [npo.id] });

    await expect
      .element(screen.getByText("Community Drive"))
      .toBeInTheDocument();

    vi.mocked(dataWithSuccess).mockClear();
    vi.mocked(enqueue).mockClear();
    await screen
      .getByRole("button", { name: /leave campaign community drive/i })
      .click();
    const dialog = screen.getByRole("dialog", {
      name: "Leave Community Drive?",
      exact: true,
    });
    await expect.element(dialog).toBeVisible();
    await expect
      .element(
        dialog.getByText(
          "An email goes to Creator Person. You will stop receiving from this campaign.",
          { exact: true }
        )
      )
      .toBeVisible();
    const cancel = dialog.getByRole("button", {
      name: "Cancel",
      exact: true,
    });
    await expect.element(cancel).toHaveFocus();
    (cancel.element() as HTMLElement).click();
    await expect
      .element(
        screen.getByRole("dialog", {
          name: "Leave Community Drive?",
          exact: true,
        })
      )
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Community Drive"))
      .toBeInTheDocument();
    expect(dataWithSuccess).not.toHaveBeenCalled();

    await screen
      .getByRole("button", { name: /leave campaign community drive/i })
      .click();
    const confirm = screen.getByRole("dialog", {
      name: "Leave Community Drive?",
      exact: true,
    });
    await expect.element(confirm).toBeVisible();
    (
      confirm
        .getByRole("button", { name: "Leave campaign", exact: true })
        .element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText("Community Drive"))
      .not.toBeInTheDocument();
    expect(dataWithSuccess).toHaveBeenCalledWith(
      null,
      "You left this campaign. It will disappear from this list shortly."
    );
    expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueue)).toHaveBeenCalledWith({
      id: "fund-member-removed",
      payload: {
        fund_id: "bbbbbbbb-0001-0001-0001-000000000001",
        creator_id: creator_user.id,
        creator_name: "Community Drive",
        npo_id: npo.id,
      },
      dedupe: `fund.removed_bbbbbbbb-0001-0001-0001-000000000001_${creator_user.id}_${npo.id}`,
      retries: 3,
    });
    await cleanup();

    // profile page no longer shows the fund
    screen = await render_profile(npo.id);
    await expect
      .element(screen.getByText("No profile funds"))
      .toBeInTheDocument();
  });

  it("a second confirm and a press while leaving do not submit again", async () => {
    const npo = await seed_npo();
    const other_npo = await seed_npo({
      registration_number: "EIN-HELD",
      name: "Held Creator NPO",
    });
    const creator_user = await seed_user(
      "held-user@test.com",
      "Held",
      "Person"
    );
    await seed_fund({
      id: "bbbbbbbb-0003-0003-0003-000000000003",
      name: "Held Drive",
      npo_owner: other_npo.id,
      creator_id: creator_user.id,
      members: [npo.id, other_npo.id],
    });

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posts = { n: 0 };
    const screen = await render_funds(
      npo.id,
      { ...MOCK_USER, endowments: [npo.id] },
      "",
      { gate, posts }
    );

    try {
      await expect.element(screen.getByText("Held Drive")).toBeInTheDocument();
      await screen
        .getByRole("button", { name: /leave campaign held drive/i })
        .click();
      const confirm = screen.getByRole("dialog", {
        name: "Leave Held Drive?",
        exact: true,
      });
      await expect.element(confirm).toBeVisible();
      const leave = confirm
        .getByRole("button", { name: "Leave campaign", exact: true })
        .element() as HTMLElement;
      // two presses before the dialog unmounts; the sent ref makes the second a no-op
      leave.click();
      leave.click();

      const leaving = screen.getByRole("button", {
        name: "Leaving… Held Drive",
        exact: true,
      });
      await expect.element(leaving).toBeVisible();
      await expect.element(leaving).toHaveAttribute("aria-disabled", "true");
      await vi.waitFor(() => expect(posts.n).toBe(1));
      const again = screen.getByRole("dialog", {
        name: "Leave Held Drive?",
        exact: true,
      });
      await expect.element(again).not.toBeInTheDocument();
      (leaving.element() as HTMLElement).click();
      await expect.element(again).not.toBeInTheDocument();
    } finally {
      release();
    }

    await expect
      .element(screen.getByText("Held Drive"))
      .not.toBeInTheDocument();
    expect(posts.n).toBe(1);
    expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(1);
  });

  it("last member opts out — fund leaves the supporter view and the member's profile", async () => {
    const npo = await seed_npo();
    const other_npo = await seed_npo({
      registration_number: "EIN-SOLO",
      name: "Solo Creator NPO",
    });
    const solo_user = await seed_user("solo-user@test.com", "Solo", "Creator");

    // fund where npo is the only member
    await seed_fund({
      id: "bbbbbbbb-0002-0002-0002-000000000002",
      name: "Solo Fund",
      npo_owner: other_npo.id,
      creator_id: solo_user.id,
      members: [npo.id],
    });

    const screen = await render_funds(npo.id, {
      ...MOCK_USER,
      endowments: [npo.id],
    });

    await expect.element(screen.getByText("Solo Fund")).toBeInTheDocument();

    await screen
      .getByRole("button", { name: /leave campaign solo fund/i })
      .click();
    const dialog = screen.getByRole("dialog", {
      name: "Leave Solo Fund?",
      exact: true,
    });
    await expect.element(dialog).toBeVisible();
    (
      dialog
        .getByRole("button", { name: "Leave campaign", exact: true })
        .element() as HTMLElement
    ).click();

    // fund disappears from supporter view
    await expect.element(screen.getByText("Solo Fund")).not.toBeInTheDocument();
    await cleanup();

    // fund deactivated — profile page won't show it (published filter requires active)
    const profile_screen = await render_profile(npo.id);
    await expect
      .element(profile_screen.getByText("No profile funds"))
      .toBeInTheDocument();
  });
});

describe("funds — edit visibility", () => {
  it("supporter fund shows View not Edit; an org's own fund stays off the supporter tab", async () => {
    const npo = await seed_npo();
    const other_npo = await seed_npo({
      registration_number: "EIN-EDIT-OTHER",
      name: "Other Edit NPO",
    });
    const own_user = await seed_user("own-npo@test.com", "Own", "NPO");
    const other_user = await seed_user("other-edit@test.com", "Other", "NPO");

    const own_fund_id = "cccccccc-0001-0001-0001-000000000001";
    await seed_fund({
      id: own_fund_id,
      name: "Editable Fund",
      npo_owner: npo.id,
      creator_id: own_user.id,
      members: [npo.id],
    });

    const supporter_fund_id = "cccccccc-0002-0002-0002-000000000002";
    await seed_fund({
      id: supporter_fund_id,
      name: "Supporter Fund",
      npo_owner: other_npo.id,
      creator_id: other_user.id,
      members: [npo.id, other_npo.id],
      published: true,
    });

    // a stale ?creator=ours leaves the org's own funds off the supporter tab
    let screen = await render_funds(
      npo.id,
      { ...MOCK_USER, endowments: [npo.id], funds: [] },
      "?creator=ours"
    );
    await expect
      .element(screen.getByText("Supporter Fund", { exact: true }))
      .toBeInTheDocument();
    // the org's own fund is a campaign now (BG-1943), so it never lists as a
    // fund on either tab — only supporter funds remain here
    expect(screen.getByText("Editable Fund").query()).toBeNull();

    await cleanup();

    // supporter view — the name is text; View opens the public page, not Edit
    screen = await render_funds(npo.id, {
      ...MOCK_USER,
      endowments: [],
      funds: [],
    });
    await expect
      .element(screen.getByText("Supporter Fund", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("link", { name: "Supporter Fund", exact: true })
      )
      .not.toBeInTheDocument();
    const view = screen.getByRole("link", {
      name: "View Supporter Fund",
      exact: true,
    });
    await expect.element(view).toBeVisible();
    expect(view.element().getAttribute("href")).toBe(
      `/fundraisers/${supporter_fund_id}`
    );
    await expect
      .element(screen.getByRole("link", { name: /^edit/i }))
      .not.toBeInTheDocument();
  });
});

describe("funds — published visibility on npo profile", () => {
  it("profile shows only published + active funds where npo is member", async () => {
    const npo = await seed_npo();
    const creator = await seed_user("pub-creator@test.com", "Pub", "Creator");

    // published + active — visible
    await seed_fund({
      id: "dddddddd-0001-0001-0001-000000000001",
      name: "Published Fund",
      npo_owner: npo.id,
      creator_id: creator.id,
      members: [npo.id],
      published: true,
    });

    // unpublished (draft) — hidden from profile
    await seed_fund({
      id: "dddddddd-0002-0002-0002-000000000002",
      name: "Draft Fund",
      npo_owner: npo.id,
      creator_id: creator.id,
      members: [npo.id],
      published: false,
    });

    // published but inactive — hidden from profile
    await seed_fund({
      id: "dddddddd-0003-0003-0003-000000000003",
      name: "Closed Fund",
      npo_owner: npo.id,
      creator_id: creator.id,
      members: [npo.id],
      published: true,
      active: false,
    });

    const screen = await render_profile(npo.id);
    await expect
      .element(screen.getByText("Published Fund"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Draft Fund"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Closed Fund"))
      .not.toBeInTheDocument();
  });

  it("lists an unfolded org fund on Your campaigns and drops a folded one (BG-1943)", async () => {
    const npo = await seed_npo();
    const creator = await seed_user("admin-vis@test.com", "Admin", "Vis");

    // an org fund not yet folded (the backfill is gated) still lists here, so it
    // never vanishes from the admin's view
    await seed_fund({
      id: "eeeeeeee-0001-0001-0001-000000000001",
      name: "Standalone Org Fund",
      npo_owner: npo.id,
      creator_id: creator.id,
      members: [npo.id],
      published: true,
    });

    // an org fund already folded lives on as its campaign, so the fund row is
    // dropped and only the campaign shows
    await seed_fund({
      id: "eeeeeeee-0002-0002-0002-000000000002",
      name: "Merged Legacy Fund",
      npo_owner: npo.id,
      creator_id: creator.id,
      members: [npo.id],
      published: true,
    });
    await db().insert(campaign_table).values({
      id: "camp-folded-fund",
      owner_npo_id: npo.id,
      creator_id: creator.id,
      name: "Merged Campaign",
      slug: "merged-campaign",
      status: "live",
      legacy_fund_id: "eeeeeeee-0002-0002-0002-000000000002",
    });

    const screen = await render_funds(npo.id, {
      ...MOCK_USER,
      endowments: [npo.id],
    });
    await screen
      .getByRole("tab", { name: "Your campaigns", exact: true })
      .click();

    // the unfolded org fund still lists as its own row
    await expect
      .element(screen.getByText("Standalone Org Fund", { exact: true }))
      .toBeVisible();
    // the folded fund shows only as its campaign, not as a fund row
    await expect
      .element(screen.getByText("Merged Campaign", { exact: true }))
      .toBeVisible();
    expect(
      screen.getByText("Merged Legacy Fund", { exact: true }).query()
    ).toBeNull();
    expect(
      screen.getByText("No campaigns yet", { exact: true }).query()
    ).toBeNull();
  });
});

describe("funds — stale opt out", () => {
  const opt_out = (npo_id: number, fund_id: string) => {
    const fd = new FormData();
    fd.set("fund_id", fund_id);
    return (action as any)({
      request: new Request(`http://x/admin/${npo_id}/funds`, {
        method: "POST",
        body: fd,
      }),
      params: { id: String(npo_id) },
      context: { get: (k: unknown) => (k === admin_ctx ? npo_id : undefined) },
    });
  };

  it("a second press after the fund is gone answers in place", async () => {
    const npo = await seed_npo();

    const res = await opt_out(npo.id, "ffffffff-0001-0001-0001-000000000001");

    expect(res).toEqual({ error: "Campaign not found" });
  });

  it("a second press after the opt-out committed answers in place", async () => {
    const npo = await seed_npo();
    const other_npo = await seed_npo({
      registration_number: "EIN-STALE",
      name: "Stale Creator NPO",
    });
    const creator = await seed_user("stale@test.com", "Stale", "Creator");
    const fid = "ffffffff-0002-0002-0002-000000000002";
    await seed_fund({
      id: fid,
      name: "Already Left",
      npo_owner: other_npo.id,
      creator_id: creator.id,
      members: [other_npo.id],
    });

    const res = await opt_out(npo.id, fid);

    expect(res).toEqual({
      error: "You're no longer part of this campaign.",
    });
  });
});
