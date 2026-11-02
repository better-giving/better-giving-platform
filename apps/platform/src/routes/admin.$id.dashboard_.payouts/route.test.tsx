import { format } from "date-fns";
import { createRoutesStub } from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const stripe = vi.hoisted(() => ({
  transfers: { retrieve: vi.fn() },
}));

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
vi.mock("$/kit/stripe", () => ({ stripe }));
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);
vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

import { seed_npo } from "#/__tests__/fixtures/funds";
import { admin_ctx } from "$/auth/test-utils";
import { dists } from "$/pg/schema/dist";
import { donations } from "$/pg/schema/donation";
import { npos } from "$/pg/schema/npo";
import { payouts } from "$/pg/schema/payout";
import { create_test_db } from "$/pg/test-utils/pglite";
import Page, { loader } from "./route";
import { SentToStripe } from "./sent";

const db = () => test_db.current!.db;
const unix = (iso: string) => Date.parse(iso) / 1000;

interface IRecord {
  amount: number;
  amount_reversed: number;
  created: number;
  reversals: { data: { amount: number }[]; has_more: boolean };
}

const records = new Map<string, IRecord>();
let npo_id: number;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  records.clear();
  vi.clearAllMocks();
  stripe.transfers.retrieve.mockImplementation(async (id: string) => {
    const t = records.get(id);
    if (!t) throw new Error(`missing transfer ${id}`);
    return { id, ...t };
  });
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(npos);
});

afterEach(async () => {
  await cleanup();
});

const listed = (amounts: number[]): IRecord["reversals"] => ({
  data: amounts.map((amount) => ({ amount })),
  has_more: false,
});

async function npo(acct: string | null = null) {
  const row = await seed_npo(db(), {
    registration_number: "EIN-SENT",
    ...(acct && { stripe_account_id: acct }),
  });
  npo_id = row!.id;
}

async function transfer(
  id: string,
  net: number,
  date: string,
  reversals: IRecord["reversals"],
  transferred_at = date
) {
  records.set(id, {
    amount: Math.round(net * 100),
    amount_reversed: 0,
    created: unix(transferred_at),
    reversals,
  });
  await db()
    .insert(donations)
    .values({
      id: `don-${id}`,
      upusd: 1,
      status: "settled",
      amount_base: net,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
    });
  await db()
    .insert(dists)
    .values({
      id: `dist-${id}`,
      donation_id: `don-${id}`,
      status: "settled",
      date_created: date,
      to_id: npo_id,
      amount_denom: "USD",
      net,
      stripe_routed_to: "acct_sent",
      stripe_transfer_id: id,
      stripe_transfer_created_at: transferred_at,
    });
}

async function payout(amount: number) {
  await db().insert(payouts).values({
    id: "p-1",
    source_id: "src-1",
    npo_id,
    source: "donation",
    date: "2026-07-04T00:00:00.000Z",
    amount,
    type: "pending",
  });
}

async function render_page() {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/dashboard/payouts",
      Component: Page as any,
      loader: loader as any,
      middleware: [
        async ({ context }, next) => {
          context.set(admin_ctx, npo_id);
          return next();
        },
      ],
    },
  ]);
  return render(
    <Stub
      initialEntries={[`/admin/${npo_id}/dashboard/payouts`]}
      future={{ v8_middleware: true }}
    />
  );
}

const sent_region = (screen: Awaited<ReturnType<typeof render_page>>) =>
  screen.getByRole("region", { name: "Sent to your Stripe account" });

describe("the payouts page", () => {
  test("a nonprofit not on Connect still has the empty payouts table", async () => {
    await npo();

    const screen = await render_page();

    await expect
      .element(screen.getByText("No payouts yet", { exact: true }))
      .toBeVisible();
    expect(sent_region(screen).query()).toBeNull();
    expect(
      screen.getByRole("link", { name: /stripe dashboard/i }).query()
    ).toBeNull();
  });

  test("a bank payout still renders when the nonprofit is not on Connect", async () => {
    await npo();
    await payout(12.5);

    const screen = await render_page();

    await expect.element(screen.getByText("$12.50")).toBeVisible();
    await expect.element(screen.getByText("Pending")).toBeVisible();
    expect(sent_region(screen).query()).toBeNull();
    expect(
      screen
        .getByRole("heading", { level: 2, name: "Payouts", exact: true })
        .query()
    ).toBeNull();
  });

  test("a connected nonprofit with nothing sent keeps an empty state", async () => {
    await npo("acct_sent");

    const screen = await render_page();
    const region = sent_region(screen);

    await expect
      .element(
        region.getByRole("heading", { name: "Sent to your Stripe account" })
      )
      .toBeVisible();
    await expect
      .element(region.getByText("No transfers yet", { exact: true }))
      .toBeVisible();
    expect(
      screen.getByText("No payouts yet", { exact: true }).query()
    ).toBeNull();
    const dashboard = region.getByRole("link", { name: /stripe dashboard/i });
    await expect
      .element(dashboard)
      .toHaveAttribute("href", "https://dashboard.stripe.com/");
    await expect.element(dashboard).toHaveAttribute("target", "_blank");
    expect(screen.getByText("$90.00").query()).toBeNull();
  });

  test("renders each routed transfer's amount, date and standing", async () => {
    await npo("acct_sent");
    await transfer("tr_none", 90, "2026-07-01T00:00:00.000Z", listed([]));
    await transfer("tr_part", 40, "2026-07-02T00:00:00.000Z", listed([2_500]));
    await transfer(
      "tr_full",
      15,
      "2026-07-03T00:00:00.000Z",
      listed([1_000, 500])
    );

    const screen = await render_page();
    const region = sent_region(screen);

    await expect.element(region.getByText("$90.00")).toBeVisible();
    await expect
      .element(region.getByText("Paid out", { exact: true }))
      .toBeVisible();
    await expect
      .element(region.getByText(format("2026-07-01T00:00:00.000Z", "PP")))
      .toBeVisible();

    await expect.element(region.getByText("$40.00")).toBeVisible();
    await expect
      .element(region.getByText("Partly reversed ($25.00)", { exact: true }))
      .toBeVisible();

    await expect.element(region.getByText("$15.00")).toBeVisible();
    await expect
      .element(region.getByText("Fully reversed", { exact: true }))
      .toBeVisible();
    await expect
      .element(region.getByText("$15.00"))
      .toHaveClass(/line-through/);

    expect(
      screen.getByText("No payouts yet", { exact: true }).query()
    ).toBeNull();
    expect(
      screen
        .getByRole("heading", { level: 2, name: "Payouts", exact: true })
        .query()
    ).toBeNull();
  });

  test("a bank payout still shows when nothing has been sent to Stripe", async () => {
    await npo("acct_sent");
    await payout(12.5);

    const screen = await render_page();

    await expect
      .element(
        sent_region(screen).getByText("No transfers yet", { exact: true })
      )
      .toBeVisible();
    await expect.element(screen.getByText("$12.50")).toBeVisible();
    await expect.element(screen.getByText("Pending")).toBeVisible();
    expect(
      screen.getByText("No payouts yet", { exact: true }).query()
    ).toBeNull();
  });

  test("lists a later transfer above an earlier one", async () => {
    await npo("acct_sent");
    await transfer(
      "tr_earlier",
      10,
      "2026-08-01T00:00:00.000Z",
      listed([]),
      "2026-07-01T00:00:00.000Z"
    );
    await transfer(
      "tr_later",
      20,
      "2026-06-01T00:00:00.000Z",
      listed([]),
      "2026-07-15T00:00:00.000Z"
    );

    const screen = await render_page();
    const region = sent_region(screen);
    await expect.element(region.getByText("$20.00")).toBeVisible();
    const text = region.element().textContent ?? "";
    expect(text.indexOf("$20.00")).toBeLessThan(text.indexOf("$10.00"));
    await expect
      .element(region.getByText(format("2026-07-15T00:00:00.000Z", "PP")))
      .toBeVisible();
    expect(
      region.getByText(format("2026-08-01T00:00:00.000Z", "PP")).query()
    ).toBeNull();
    expect(
      region.getByText(format("2026-06-01T00:00:00.000Z", "PP")).query()
    ).toBeNull();
  });

  test("bank payouts stay beside the stripe list", async () => {
    await npo("acct_sent");
    await transfer("tr_none", 90, "2026-07-01T00:00:00.000Z", listed([]));
    await payout(12.5);

    const screen = await render_page();

    await expect.element(sent_region(screen).getByText("$90.00")).toBeVisible();
    await expect
      .element(
        screen.getByRole("heading", { level: 2, name: "Payouts", exact: true })
      )
      .toBeVisible();
    await expect.element(screen.getByText("$12.50")).toBeVisible();
    await expect.element(screen.getByText("Pending")).toBeVisible();
  });
});

describe("SentToStripe", () => {
  test("says when the list stopped, and does not call an unread transfer paid out", async () => {
    const screen = await render(
      <SentToStripe
        sent={{
          truncated: true,
          items: [
            {
              id: "tr_x",
              amount: 10,
              date: "2026-07-01T00:00:00.000Z",
              standing: { kind: "unknown" },
            },
          ],
        }}
      />
    );

    await expect
      .element(screen.getByText(/Showing the most recent/))
      .toBeVisible();
    await expect
      .element(screen.getByText("Status unavailable", { exact: true }))
      .toBeVisible();
    expect(screen.getByText("Paid out", { exact: true }).query()).toBeNull();
  });
});
