import { createRoutesStub } from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { render } from "vitest-browser-react";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
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

vi.mock("remix-client-cache", () => ({
  CacheRoute: (C: any) => C,
  createClientLoaderCache: () => undefined,
}));

import { seed_fund, seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { campaigns } from "$/pg/schema/campaign";
import { create_test_db } from "$/pg/test-utils/pglite";
import { loader } from "./api";
import DonatePage from "./route";

// the closing instant of a Sep 22 end date: Sep 22 has just ended in UTC-12
const NOW = new Date("2027-09-23T12:00:00.000Z");
const ms_before = (d: Date, ms: number) => new Date(d.getTime() - ms);
const DAY_MS = 86_400_000;
const closed_notice = /this campaign is already closed/i;

let creator_id: string;
let npo_id: number;

beforeAll(async () => {
  test_db.current = await create_test_db();
  // a non-utc session: the text read back carries +05:30, not the host's zone
  await test_db.current.client.exec("set time zone 'Asia/Kolkata'");
  const db = test_db.current.db;
  creator_id = (await seed_user(db, "creator@test.com")).id;
  npo_id = (await seed_npo(db)).id;
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

afterEach(() => {
  vi.useRealTimers();
});

/** `server` is the clock the loader runs on, `browser` the one the page renders on */
async function open_donate_page(
  expiration: string | null,
  { server = NOW, browser = server }: { server?: Date; browser?: Date } = {}
) {
  const fund = await seed_fund(test_db.current!.db, {
    id: crypto.randomUUID(),
    npo_owner: npo_id,
    creator_id,
    members: [npo_id],
    expiration,
  });
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const Stub = createRoutesStub([
    {
      path: "/campaigns/:fund_id/donate",
      Component: DonatePage as any,
      loader: async (args: any) => {
        vi.setSystemTime(server);
        const data = await loader(args);
        vi.setSystemTime(browser);
        return data;
      },
      HydrateFallback: () => null,
    },
  ]);
  return render(<Stub initialEntries={[`/campaigns/${fund.id}/donate`]} />);
}

describe("campaign donate page", () => {
  test("takes donations on its end date after that date began in UTC", async () => {
    const screen = await open_donate_page("2027-09-23T00:00:00.000Z");
    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    expect(screen.getByText(closed_notice).query()).toBeNull();
  });

  test("is closed once its end date has ended everywhere", async () => {
    const screen = await open_donate_page("2027-09-22T00:00:00.000Z");
    await expect.element(screen.getByText(closed_notice)).toBeVisible();
    expect(screen.getByTestId("donate-methods").query()).toBeNull();
  });

  test("takes donations from a fund with no expiration", async () => {
    const screen = await open_donate_page(null);
    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    expect(screen.getByText(closed_notice).query()).toBeNull();
  });

  test("takes donations until an expiry that falls on the next local day", async () => {
    // 20:00Z is 01:30 the next day in the session's Asia/Kolkata
    const screen = await open_donate_page("2027-09-23T20:00:00.000Z");
    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    expect(screen.getByText(closed_notice).query()).toBeNull();
  });

  test("reads an expiration stored with microsecond precision", async () => {
    const screen = await open_donate_page("2027-09-22T23:59:59.999999Z", {
      server: ms_before(NOW, 1),
    });
    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    expect(screen.getByText(closed_notice).query()).toBeNull();
  });

  test("is closed by the server's clock when the browser's runs behind", async () => {
    const screen = await open_donate_page("2027-09-22T00:00:00.000Z", {
      browser: ms_before(NOW, DAY_MS),
    });
    await expect.element(screen.getByText(closed_notice)).toBeVisible();
    expect(screen.getByTestId("donate-methods").query()).toBeNull();
  });

  test("closes once mounted when served from before closing to a browser past it", async () => {
    const screen = await open_donate_page("2027-09-22T00:00:00.000Z", {
      server: ms_before(NOW, 1),
      browser: NOW,
    });
    await expect.element(screen.getByText(closed_notice)).toBeVisible();
    expect(screen.getByTestId("donate-methods").query()).toBeNull();
  });

  test("closes without a reload once the closing instant passes", async () => {
    const screen = await open_donate_page("2027-09-22T00:00:00.000Z", {
      server: ms_before(NOW, 1),
    });
    await expect.element(screen.getByTestId("donate-methods")).toBeVisible();
    await vi.advanceTimersByTimeAsync(1);
    await expect.element(screen.getByText(closed_notice)).toBeVisible();
    expect(screen.getByTestId("donate-methods").query()).toBeNull();
  });
});

describe("folded fund donate redirect", () => {
  async function fold(opts: {
    members: number[];
    owner: number;
    status?: "live" | "draft";
  }) {
    const fund = await seed_fund(test_db.current!.db, {
      id: crypto.randomUUID(),
      npo_owner: opts.owner,
      creator_id,
      members: opts.members,
    });
    await test_db.current!.db.insert(campaigns).values({
      id: `camp-${fund.id}`,
      owner_npo_id: opts.owner,
      creator_id,
      name: "Winter",
      slug: "winter",
      status: opts.status ?? "live",
      legacy_fund_id: fund.id,
    });
    return fund;
  }

  const load = (fund_id: string, search = "") =>
    (loader as any)({
      request: new Request(`https://x/campaigns/${fund_id}/donate${search}`),
      params: { fund_id },
    });

  test("301s a single-beneficiary folded fund's donate page to the campaign, keeping the query", async () => {
    const owner = (
      await seed_npo(test_db.current!.db, {
        registration_number: "EIN-DON-PUB",
        slug: "pub-org",
        published: true,
      })
    ).id;
    const fund = await fold({ members: [owner], owner });

    const res = (await load(fund.id, "?amount=10").catch(
      (e: unknown) => e
    )) as Response;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/org/pub-org/winter?amount=10");
  });

  test("keeps serving a multi-beneficiary folded fund's donate page", async () => {
    const owner = (
      await seed_npo(test_db.current!.db, {
        registration_number: "EIN-DON-MULTI",
        slug: "multi-org",
        published: true,
      })
    ).id;
    const other = (
      await seed_npo(test_db.current!.db, {
        registration_number: "EIN-DON-MULTI-2",
        slug: "multi-org-2",
        published: true,
      })
    ).id;
    const fund = await fold({ members: [owner, other], owner });

    const data = await load(fund.id);
    expect(data).not.toBeInstanceOf(Response);
    expect((data as { fund: { id: string } }).fund.id).toBe(fund.id);
  });

  test("keeps serving a folded fund's donate page when the owner is unpublished", async () => {
    const owner = (
      await seed_npo(test_db.current!.db, {
        registration_number: "EIN-DON-HIDDEN",
        slug: "hidden-don-org",
        published: false,
      })
    ).id;
    const fund = await fold({ members: [owner], owner });

    const data = await load(fund.id);
    expect(data).not.toBeInstanceOf(Response);
    expect((data as { fund: { id: string } }).fund.id).toBe(fund.id);
  });
});
