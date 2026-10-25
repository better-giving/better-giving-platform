import { HttpResponse, http } from "msw";
import { act } from "react";
import { createRoutesStub } from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { mswWorker } from "#/setup-tests-browser";
import { funds } from "$/pg/schema/fund";
import { npos } from "$/pg/schema/npo";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
// set to make the fundraisers query fail the way an unreachable neon does
const funds_failure = vi.hoisted(() => ({ current: null as Error | null }));
const report_error_mock = vi.hoisted(() => vi.fn());

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

vi.mock("$/pg/queries/fund", async (orig) => {
  const real = await orig<typeof import("$/pg/queries/fund")>();
  return {
    ...real,
    fund_npo_memberof: (...args: Parameters<typeof real.fund_npo_memberof>) =>
      funds_failure.current
        ? Promise.reject(funds_failure.current)
        : real.fund_npo_memberof(...args),
  };
});

vi.mock("#/errors/report", async (orig) => ({
  ...(await orig<typeof import("#/errors/report")>()),
  report_error: report_error_mock,
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    session: { user: undefined },
  })
);
vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

// --- imports after mocks ---

import {
  seed_npo as seed_any_npo,
  seed_fund,
  seed_user,
} from "#/__tests__/fixtures/funds";
import { FAILED_LINE } from "#/components/org-page/layouts/ways-to-help";
import { create_test_db } from "$/pg/test-utils/pglite";
import ProfilePage, { loader } from "../route";

// --- setup ---

const COULDNT_LOAD = FAILED_LINE.give;
/** a short story and at most a row of items: the poster layout's give section */
const WAYS_TO_HELP = { name: "Ways to help" };

const db = () => test_db.current!.db;

/** a profile anyone can see; an unpublished one is the loader suite's */
const seed_npo = (
  db: Parameters<typeof seed_any_npo>[0],
  o: Parameters<typeof seed_any_npo>[1] = {}
) => seed_any_npo(db, { published: true, ...o });

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await db().delete(funds);
  await db().delete(npos);
  mswWorker.use(
    http.get("/api/me", () => HttpResponse.json(null, { status: 401 })),
    http.get("/api/npo/:id/donors", () =>
      HttpResponse.json({ items: [], next: null })
    )
  );
});

afterEach(async () => {
  await cleanup();
  funds_failure.current = null;
  report_error_mock.mockReset();
});

// the last loader result, whose deferred `funds` a test can wait out
let loaded: Awaited<ReturnType<typeof loader>> | null = null;

async function render_profile(npo_id: number) {
  loaded = null;
  const Stub = createRoutesStub([
    {
      path: "/org/:org",
      Component: ProfilePage as any,
      HydrateFallback: () => null,
      loader: (async (args: Parameters<typeof loader>[0]) =>
        (loaded = await loader(args))) as any,
    },
  ]);
  return await render(<Stub initialEntries={[`/org/${npo_id}`]} />);
}

// --- tests ---

describe("npo profile — fundraisers section", () => {
  it("says the fundraisers couldn't be loaded when the query fails, and still shows the profile", async () => {
    const npo = await seed_npo(db(), {
      registration_number: "EIN-PROFILE-FUNDS",
      name: "Unreachable Funds Org",
      street_address: "87 Outage Ave",
    });
    const err = new Error(
      "Error connecting to database: TypeError: fetch failed"
    );
    funds_failure.current = err;

    const screen = await render_profile(npo.id);

    await expect.element(screen.getByText(COULDNT_LOAD)).toBeVisible();
    await expect
      .element(screen.getByRole("contentinfo").getByText("87 Outage Ave"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    // the section says so under its own heading
    await expect
      .element(screen.getByRole("region", WAYS_TO_HELP).getByText(COULDNT_LOAD))
      .toBeVisible();
    // a rejected deferred never reaches handleError, so the loader reports it
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(report_error_mock).toHaveBeenCalledWith(err, { endow_id: npo.id });
  });

  it("lists a live fundraiser among the ways to help, by its creator, linking to its own page", async () => {
    const npo = await seed_npo(db(), {
      registration_number: "EIN-PROFILE-LIVEFUND",
      name: "Live Fund Org",
    });
    const creator = await seed_user(
      db(),
      "live-fund@example.com",
      "Maya",
      "Lin"
    );
    await seed_fund(db(), {
      id: "fund-live",
      name: "Spring Drive",
      npo_owner: null,
      creator_id: creator.id,
      members: [npo.id],
      published: true,
      expiration: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const screen = await render_profile(npo.id);

    const card = screen
      .getByRole("region", WAYS_TO_HELP)
      .getByRole("article")
      .filter({ hasText: "Spring Drive" });
    // the only kind listed, so the card carries no kind line
    await expect
      .element(card.getByText("Supporter campaign"))
      .not.toBeInTheDocument();
    await expect.element(card.getByText("by Maya Lin")).toBeVisible();
    // the card's one link: the fundraiser's page carries its donation form
    await expect
      .element(card.getByRole("link", { name: "Spring Drive" }))
      .toHaveAttribute("href", "/fundraisers/fund-live");
  });

  it("shows nothing for a nonprofit with no fundraisers", async () => {
    const npo = await seed_npo(db(), {
      registration_number: "EIN-PROFILE-NOFUNDS",
      name: "No Funds Org",
      street_address: "1 Quiet St",
    });

    const screen = await render_profile(npo.id);

    await expect
      .element(screen.getByRole("contentinfo").getByText("1 Quiet St"))
      .toBeVisible();
    // the section renders nothing both while the fundraisers load and after
    // they come back empty, so wait for the deferred read and the render it
    // triggers before asserting absence
    await vi.waitFor(() => expect(loaded).not.toBeNull());
    await act(async () => {
      await loaded!.data.funds;
    });
    await expect
      .element(screen.getByRole("heading", { level: 1 }))
      .toBeVisible();
    await expect
      .element(screen.getByText(COULDNT_LOAD))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("region", WAYS_TO_HELP))
      .not.toBeInTheDocument();
    expect(report_error_mock).not.toHaveBeenCalled();
  });
});
