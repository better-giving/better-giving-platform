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

vi.mock("remix-client-cache", () => ({
  CacheRoute: (C: any) => C,
  createClientLoaderCache: () => undefined,
}));

// donor messages fetch their own api route
vi.mock("swr/immutable", () => ({
  default: () => ({ data: undefined }),
}));

import { seed_fund, seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import { dists } from "$/pg/schema/dist";
import { donations } from "$/pg/schema/donation";
import { create_test_db } from "$/pg/test-utils/pglite";
import { loader } from "./api";
import FundPage from "./route";

// the closing instant of a Sep 22 end date: Sep 22 has just ended in UTC-12
const NOW = new Date("2027-09-23T12:00:00.000Z");
const ms_before = (d: Date, ms: number) => new Date(d.getTime() - ms);
const DAY_MS = 86_400_000;

let creator_id: string;
let npo_id: number;
let served: Awaited<ReturnType<typeof loader>>;

beforeAll(async () => {
  test_db.current = await create_test_db();
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

/** one settled donation to the fund per net */
async function seed_settled(fund_id: string, nets: number[]) {
  const db = test_db.current!.db;
  for (const net of nets) {
    const donation_id = crypto.randomUUID();
    await db.insert(donations).values({
      id: donation_id,
      upusd: net,
      status: "settled",
      amount_base: net,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "stripe",
      via: "card",
    });
    await db.insert(dists).values({
      id: crypto.randomUUID(),
      donation_id,
      status: "settled",
      date_created: new Date().toISOString(),
      to_id: npo_id,
      amount_denom: "USD",
      net,
      fund_id,
    });
  }
}

/** `server` is the clock the loader runs on, `browser` the one the page renders on */
async function open_fund_page(
  expiration: string,
  {
    server,
    browser,
    nets = [],
  }: { server: Date; browser: Date; nets?: number[] }
) {
  const fund = await seed_fund(test_db.current!.db, {
    id: crypto.randomUUID(),
    npo_owner: npo_id,
    creator_id,
    members: [npo_id],
    expiration,
  });
  await seed_settled(fund.id, nets);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const Stub = createRoutesStub([
    {
      path: "/campaigns/:fund_id",
      Component: FundPage as any,
      loader: async (args: any) => {
        vi.setSystemTime(server);
        served = await loader(args);
        vi.setSystemTime(browser);
        return served;
      },
      HydrateFallback: () => null,
    },
  ]);
  return render(<Stub initialEntries={[`/campaigns/${fund.id}`]} />);
}

describe("campaign page", () => {
  test("shows a fund closed by the server's clock when the browser's runs behind", async () => {
    const screen = await open_fund_page("2027-09-22T00:00:00.000Z", {
      server: NOW,
      browser: ms_before(NOW, DAY_MS),
    });
    // one of the two donate links is display:none at any width
    await expect
      .element(screen.getByRole("link", { name: /donate now/i }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("last day", { exact: true }).query()).toBeNull();
  });

  test("closes once mounted when served from before closing to a browser past it", async () => {
    const screen = await open_fund_page("2027-09-22T00:00:00.000Z", {
      server: ms_before(NOW, 1),
      browser: NOW,
    });
    // one of the two donate links is display:none at any width
    await expect
      .element(screen.getByRole("link", { name: /donate now/i }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("last day", { exact: true }).query()).toBeNull();
  });

  test("closes without a reload once the closing instant passes", async () => {
    const at = ms_before(NOW, 1);
    const screen = await open_fund_page("2027-09-22T00:00:00.000Z", {
      server: at,
      browser: at,
    });
    await expect
      .element(screen.getByText("last day", { exact: true }))
      .toBeVisible();
    await vi.advanceTimersByTimeAsync(1);
    await expect
      .element(screen.getByRole("link", { name: /donate now/i }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("last day", { exact: true }).query()).toBeNull();
  });

  test("reads expired when it closed with no settled donations", async () => {
    const screen = await open_fund_page("2027-09-22T00:00:00.000Z", {
      server: NOW,
      browser: NOW,
    });
    await expect
      .element(screen.getByText("expired", { exact: true }))
      .toBeVisible();
    expect(served.donation_total_usd).toBe(0);
  });

  test("reads completed when it closed with settled donations", async () => {
    const screen = await open_fund_page("2027-09-22T00:00:00.000Z", {
      server: NOW,
      browser: NOW,
      nets: [4.53, 10.25],
    });
    await expect
      .element(screen.getByText("completed", { exact: true }))
      .toBeVisible();
    expect(served.donation_total_usd).toBe(14.78);
  });
});
