import { createRoutesStub, Outlet } from "react-router";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { IComposition } from "@/nav/interfaces";
import { user } from "$/pg/schema/auth";
import { bal_txs } from "$/pg/schema/bal-tx";
import { banking_apps } from "$/pg/schema/banking";
import { nav_holders, nav_log_positions, nav_logs } from "$/pg/schema/nav";
import { npos } from "$/pg/schema/npo";
import { payouts, settlements } from "$/pg/schema/payout";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks ---

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
  (await import("$/auth/test-utils")).make_auth_mock()
);

vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return {
    redirectWithSuccess: vi.fn((url: string) => redirect(url)),
    dataWithSuccess: vi.fn((_d: unknown, msg: string) => ({ toast: msg })),
    dataWithError: vi.fn((_d: unknown, msg: string) => ({ error: msg })),
  };
});

// no clientLoader in these stubs, so there is no cache entry for `invalidate` to drop
vi.mock("remix-client-cache", async () => {
  const { createElement } = await import("react");
  return {
    CacheRoute: (Component: any) => (props: any) =>
      createElement(Component, { ...props, invalidate: async () => {} }),
    createClientLoaderCache: () => undefined,
  };
});

vi.mock("swr/immutable", () => ({
  default: () => ({ data: { points: [], total_return: 0 } }),
}));

// --- imports after mocks ---

import type { LoaderData } from "#/pages/admin/types";
import { action as verdict_action } from "#/pages/platform-admin/redeem-requests/api";
import TransferPage, {
  action as transfer_action,
  loader as transfer_loader,
} from "#/routes/admin.$id.dashboard.transfer/route";
import WithdrawPage, {
  action as withdraw_action,
  loader as withdraw_loader,
} from "#/routes/admin.$id.dashboard.withdraw/route";
import { loader as inv_loader } from "#/routes/admin.$id.investments/api";
import InvestmentsPage from "#/routes/admin.$id.investments/route";
import InvTransferPage, {
  action as inv_transfer_action,
  loader as inv_transfer_loader,
} from "#/routes/admin.$id.investments.transfer/route";
import InvWithdrawPage, {
  action as inv_withdraw_action,
  loader as inv_withdraw_loader,
} from "#/routes/admin.$id.investments.withdraw/route";
import { loader as redeem_loader } from "#/routes/platform.redeem-requests/api";
import RedeemRequestsPage from "#/routes/platform.redeem-requests/route";
import VerdictApprove from "#/routes/platform.redeem-requests.$tx_id.approve/route";
import VerdictReject from "#/routes/platform.redeem-requests.$tx_id.reject/route";
import { admin_ctx } from "$/auth/test-utils";
import { create_test_db } from "$/pg/test-utils/pglite";
import {
  endowUpdateAction as dashboard_action,
  loader as dashboard_loader,
} from "../api";
import DashboardPage from "../route";

// --- setup ---

const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-DASH",
  name: "Admin Test NPO",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
  published: false,
  active: true,
};

const DASH_USER = "dash-user";

beforeAll(async () => {
  test_db.current = await create_test_db();
  await test_db.current.db.insert(user).values({
    id: DASH_USER,
    name: "Dash User",
    email: "dash-user@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Dash",
    last_name: "User",
  });
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await cleanup();
  await test_db.current!.db.delete(nav_holders);
  await test_db.current!.db.delete(nav_logs);
  await test_db.current!.db.delete(bal_txs);
  await test_db.current!.db.delete(payouts);
  await test_db.current!.db.delete(settlements);
  await test_db.current!.db.delete(banking_apps);
  await test_db.current!.db.delete(npos);
});

// --- helpers ---

async function seed_npo(
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) {
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({ ...NPO_SEED, ...overrides })
    .returning();
  return row;
}

async function seed_nav_log(opts: {
  price: number;
  units: number;
  value: number;
  holders?: Record<number, number>;
  composition?: IComposition;
}) {
  const now = new Date().toISOString();
  const composition: IComposition = opts.composition ?? {
    CASH: {
      id: "CASH",
      qty: opts.value,
      price_date: now,
      price: 1,
      value: opts.value,
    },
  };
  const positions = Object.values(composition);
  await test_db.current!.db.transaction(async (tx) => {
    await tx.insert(nav_logs).values({
      date: now,
      reason: "test",
      units: opts.units,
      price: opts.price,
      price_updated: now,
    });
    if (positions.length) {
      await tx.insert(nav_log_positions).values(
        positions.map((p) => ({
          date: now,
          ticker: p.id,
          qty: p.qty,
          price: p.price,
          value: p.qty * p.price,
          price_date: p.price_date,
        }))
      );
    }
    if (opts.holders) {
      await tx.insert(nav_holders).values(
        Object.entries(opts.holders).map(([npo_id, units]) => ({
          date: now,
          npo_id: Number(npo_id),
          units,
        }))
      );
    }
  });
}

function make_admin_data(npo_id: number): LoaderData {
  return {
    id: npo_id,
    user: { email: "test@test.com", sub: "sub-1" } as any,
    endow: {
      logo: null,
      name: "Admin Test NPO",
      allocation: null,
      payout_minimum: undefined as any,
    },
  };
}

const admin_mdlwr = (npo_id: number) => [
  async ({ context }: any, next: any) => {
    context.set(admin_ctx, npo_id);
    return next();
  },
];

// --- render helpers ---

async function render_dashboard_with_transfer(npo_id: number) {
  const mdlwr = admin_mdlwr(npo_id);
  const Stub = createRoutesStub([
    {
      id: "admin",
      path: "/admin/:id",
      Component: () => <Outlet />,
      HydrateFallback: () => null,
      loader: () => make_admin_data(npo_id),
      children: [
        {
          id: "dashboard",
          path: "dashboard",
          Component: DashboardPage,
          loader: dashboard_loader as any,
          action: dashboard_action,
          middleware: mdlwr,
          children: [
            {
              path: "transfer",
              Component: TransferPage,
              loader: transfer_loader as any,
              action: transfer_action,
              middleware: mdlwr,
            },
          ],
        },
      ],
    },
  ]);
  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/dashboard`]}
      future={{ v8_middleware: true }}
    />
  );
}

async function render_dashboard_with_withdraw(npo_id: number) {
  const mdlwr = admin_mdlwr(npo_id);
  const Stub = createRoutesStub([
    {
      id: "admin",
      path: "/admin/:id",
      Component: () => <Outlet />,
      HydrateFallback: () => null,
      loader: () => make_admin_data(npo_id),
      children: [
        {
          id: "dashboard",
          path: "dashboard",
          Component: DashboardPage,
          loader: dashboard_loader as any,
          action: dashboard_action,
          middleware: mdlwr,
          children: [
            {
              path: "withdraw",
              Component: WithdrawPage,
              loader: withdraw_loader as any,
              action: withdraw_action,
              middleware: mdlwr,
            },
          ],
        },
        {
          path: "investments",
          Component: () => <div data-testid="investments-redirect" />,
        },
      ],
    },
  ]);
  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/dashboard`]}
      future={{ v8_middleware: true }}
    />
  );
}

async function render_dashboard(npo_id: number) {
  const Stub = createRoutesStub([
    {
      id: "admin",
      path: "/admin/:id",
      Component: () => <Outlet />,
      HydrateFallback: () => null,
      loader: () => make_admin_data(npo_id),
      children: [
        {
          id: "dashboard",
          path: "dashboard",
          Component: DashboardPage,
          loader: dashboard_loader as any,
          action: dashboard_action,
          middleware: admin_mdlwr(npo_id),
        },
      ],
    },
  ]);
  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/dashboard`]}
      future={{ v8_middleware: true }}
    />
  );
}

async function render_investments(npo_id: number) {
  const Stub = createRoutesStub([
    {
      path: "/admin/:id/investments",
      Component: InvestmentsPage,
      HydrateFallback: () => null,
      loader: inv_loader as any,
      middleware: admin_mdlwr(npo_id),
    },
  ]);
  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/investments`]}
      future={{ v8_middleware: true }}
    />
  );
}

async function render_investments_with_withdraw(npo_id: number) {
  const mdlwr = admin_mdlwr(npo_id);
  const Stub = createRoutesStub([
    {
      path: "/admin/:id",
      HydrateFallback: () => null,
      children: [
        {
          path: "investments",
          Component: InvestmentsPage,
          loader: inv_loader as any,
          middleware: mdlwr,
          children: [
            {
              path: "withdraw",
              Component: InvWithdrawPage,
              loader: inv_withdraw_loader as any,
              action: inv_withdraw_action,
              middleware: mdlwr,
            },
          ],
        },
      ],
    },
  ]);
  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/investments`]}
      future={{ v8_middleware: true }}
    />
  );
}

async function render_investments_with_transfer(npo_id: number) {
  const mdlwr = admin_mdlwr(npo_id);
  const Stub = createRoutesStub([
    {
      path: "/admin/:id",
      HydrateFallback: () => null,
      children: [
        {
          path: "investments",
          Component: InvestmentsPage,
          loader: inv_loader as any,
          middleware: mdlwr,
          children: [
            {
              path: "transfer",
              Component: InvTransferPage,
              loader: inv_transfer_loader as any,
              action: inv_transfer_action,
              middleware: mdlwr,
            },
          ],
        },
        {
          path: "savings",
          Component: () => <div data-testid="savings-redirect" />,
        },
      ],
    },
  ]);
  return await render(
    <Stub
      initialEntries={[`/admin/${npo_id}/investments`]}
      future={{ v8_middleware: true }}
    />
  );
}

async function render_redeem_requests() {
  const Stub = createRoutesStub([
    {
      path: "/platform/redeem-requests",
      Component: RedeemRequestsPage,
      HydrateFallback: () => null,
      loader: redeem_loader as any,
      children: [
        {
          path: ":tx_id/approve",
          Component: VerdictApprove,
          action: verdict_action,
        },
        {
          path: ":tx_id/reject",
          Component: VerdictReject,
          action: verdict_action,
        },
      ],
    },
  ]);
  return await render(<Stub initialEntries={["/platform/redeem-requests"]} />);
}

// --- tests ---

describe("dashboard — transfer savings → investments", () => {
  it("user sees dashboard, transfers savings, balances update on both pages", async () => {
    const npo = await seed_npo({ liq: 1000, lock_units: 0 });
    await seed_nav_log({ price: 1, units: 0, value: 0 });

    let screen = await render_dashboard_with_transfer(npo.id);

    // dashboard structure renders
    await expect
      .element(
        screen.getByRole("heading", {
          level: 1,
          name: "Dashboard",
          exact: true,
        })
      )
      .toBeInTheDocument();
    await expect.element(screen.getByText("Savings")).toBeInTheDocument();
    await expect.element(screen.getByText("Investments")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /deposit/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /withdraw/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /transfer/i }))
      .toBeInTheDocument();

    // initial balances: savings $1,000, investments $0
    await expect.element(screen.getByText("$1,000.00")).toBeInTheDocument();
    await expect.element(screen.getByText("$0.00")).toBeInTheDocument();

    // no activity yet
    await expect
      .element(screen.getByText(/no grant items/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/no payout records/i))
      .toBeInTheDocument();

    // user clicks Transfer
    await screen.getByRole("link", { name: /transfer/i }).click();

    await expect
      .element(screen.getByRole("heading", { name: /transfer/i }))
      .toBeInTheDocument();

    // fill amount and submit
    await screen.getByLabelText(/amount/i).fill("500");
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeEnabled();
    // the dialog overlay intercepts pointer events; use native DOM click
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    // dashboard reloads — savings decreased, investments increased
    await vi.waitFor(() =>
      expect(
        screen.getByText("$500.00", { exact: true }).elements()
      ).toHaveLength(2)
    );

    // cross-page: investments page shows the transfer tx
    await cleanup();
    screen = await render_investments(npo.id);

    await expect
      .element(screen.getByText(/transfer from savings/i))
      .toBeInTheDocument();
    await expect.element(screen.getByText(/final/i)).toBeInTheDocument();
  });
});

describe("dashboard — withdraw dialog", () => {
  it("opens withdraw dialog with account options", async () => {
    const npo = await seed_npo({ liq: 200, lock_units: 100 });
    await seed_nav_log({ price: 10, units: 100, value: 1000 });

    const screen = await render_dashboard_with_withdraw(npo.id);

    await expect
      .element(screen.getByText("$1,000.00", { exact: true }))
      .toBeInTheDocument();

    // click Withdraw link opens dialog
    await screen.getByRole("link", { name: /withdraw/i }).click();

    await expect
      .element(screen.getByRole("heading", { name: /withdraw/i }))
      .toBeInTheDocument();

    // shows amount field and submit button
    await expect.element(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeDisabled();
  });
});

describe("investments — withdraw creates pending request", () => {
  it("user sees balance, withdraws, sees pending Grant tx", async () => {
    const npo = await seed_npo({ lock_units: 100 });
    await seed_nav_log({
      price: 10,
      units: 100,
      value: 1000,
      holders: { [npo.id]: 100 },
    });

    const screen = await render_investments_with_withdraw(npo.id);

    // page structure
    await expect
      .element(screen.getByRole("heading", { name: /investments/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { name: /transactions/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /deposit/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /withdraw/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /transfer/i }))
      .toBeInTheDocument();

    // computed balance: 100 units × $10 = $1,000
    await expect.element(screen.getByText(/\$1,000/)).toBeInTheDocument();

    // click Withdraw link
    await screen.getByRole("link", { name: /withdraw/i }).click();

    // dialog appears with preset source = Investments
    await expect
      .element(screen.getByRole("heading", { name: /withdraw/i }))
      .toBeInTheDocument();

    // fill amount
    await screen.getByLabelText(/amount/i).fill("300");

    // submit
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    // after redirect, investments reloads — pending tx appears
    await expect.element(screen.getByText(/pending/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/grant/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/\$300/)).toBeInTheDocument();
  });
});

describe("investments — transfer to savings", () => {
  it("creates pending transfer, dashboard savings unchanged", async () => {
    const npo = await seed_npo({ lock_units: 100, liq: 0 });
    await seed_nav_log({
      price: 10,
      units: 100,
      value: 1000,
      holders: { [npo.id]: 100 },
    });

    let screen = await render_investments_with_transfer(npo.id);

    await expect.element(screen.getByText(/\$1,000/)).toBeInTheDocument();

    // click Transfer
    await screen.getByRole("link", { name: /transfer/i }).click();

    // dialog: "Transfer to Savings" (from="lock")
    await expect
      .element(screen.getByRole("heading", { name: /transfer/i }))
      .toBeInTheDocument();

    // fill amount
    await screen.getByLabelText(/amount/i).fill("200");

    // submit
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    // lock→liq transfer is pending, investments reloads
    await expect.element(screen.getByText(/pending/i)).toBeInTheDocument();
    await expect
      .element(screen.getByText(/transfer to savings/i))
      .toBeInTheDocument();

    // cross-page: dashboard still shows savings $0 (pending, not approved)
    await cleanup();
    screen = await render_dashboard(npo.id);

    await expect.element(screen.getByText("$0.00")).toBeInTheDocument();
  });
});

describe("cross-page — platform admin approves redemption", () => {
  it("full flow: withdraw → admin sees → approves → user sees final + payout", async () => {
    const npo = await seed_npo({ lock_units: 100, liq: 500 });
    await seed_nav_log({
      price: 10,
      units: 100,
      value: 1000,
      holders: { [npo.id]: 100 },
    });

    // step 1: user withdraws $300 from investments
    let screen = await render_investments_with_withdraw(npo.id);

    await expect.element(screen.getByText(/\$1,000/)).toBeInTheDocument();
    await screen.getByRole("link", { name: /withdraw/i }).click();
    await expect
      .element(screen.getByRole("heading", { name: /withdraw/i }))
      .toBeVisible();
    await screen.getByLabelText(/amount/i).fill("300");
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    // pending tx appears
    await expect.element(screen.getByText(/pending/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/\$300/)).toBeInTheDocument();
    await cleanup();

    // step 2: platform admin sees the request
    screen = await render_redeem_requests();

    await expect.element(screen.getByText(/redeem units/i)).toBeInTheDocument();
    await expect.element(screen.getByText(/\$300/)).toBeInTheDocument();

    // step 3: admin clicks Approve
    await screen.getByRole("link", { name: /approve/i }).click();

    // verdict dialog
    await expect
      .element(screen.getByText(/you are about to approve/i))
      .toBeInTheDocument();
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    // redirects back to list — request gone from pending (now final)
    await expect
      .element(screen.getByText(/redeem units/i))
      .not.toBeInTheDocument();
    await cleanup();

    // step 4: user sees result on investments page
    screen = await render_investments(npo.id);

    // tx status is now Final
    await expect.element(screen.getByText(/final/i)).toBeInTheDocument();
    await cleanup();

    // step 5: dashboard shows updated state — payout created from lock withdrawal
    screen = await render_dashboard(npo.id);

    await expect
      .element(
        screen.getByRole("heading", {
          level: 1,
          name: "Dashboard",
          exact: true,
        })
      )
      .toBeInTheDocument();
    // investments figure decreased
    await expect
      .element(screen.getByText("$700.00", { exact: true }))
      .toBeInTheDocument();
    // grant item created (payout from lock source)
    expect(screen.getByText(/\$300/).elements().length).toBeGreaterThanOrEqual(
      1
    );
  });
});

describe("cross-page — platform admin rejects redemption", () => {
  it("reject restores balance, user sees cancelled tx", async () => {
    const npo = await seed_npo({ lock_units: 100 });
    await seed_nav_log({
      price: 10,
      units: 100,
      value: 1000,
      holders: { [npo.id]: 100 },
    });

    // user withdraws $300
    let screen = await render_investments_with_withdraw(npo.id);

    await expect.element(screen.getByText(/\$1,000/)).toBeInTheDocument();
    await screen.getByRole("link", { name: /withdraw/i }).click();
    await expect
      .element(screen.getByRole("heading", { name: /withdraw/i }))
      .toBeVisible();
    await screen.getByLabelText(/amount/i).fill("300");
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    await expect.element(screen.getByText(/pending/i)).toBeInTheDocument();
    await cleanup();

    // platform admin rejects
    screen = await render_redeem_requests();

    await expect.element(screen.getByText(/redeem units/i)).toBeInTheDocument();
    await screen.getByRole("link", { name: /reject/i }).click();

    await expect
      .element(screen.getByText(/you are about to reject/i))
      .toBeInTheDocument();
    (
      screen.getByRole("button", { name: /submit/i }).element() as HTMLElement
    ).click();

    await expect
      .element(screen.getByText(/redeem units/i))
      .not.toBeInTheDocument();
    await cleanup();

    // user sees cancelled tx, balance restored
    screen = await render_investments(npo.id);

    await expect.element(screen.getByText(/^cancelled$/i)).toBeInTheDocument();
    // balance restored: lock_units back to 100, price=10 → $1,000
    await expect.element(screen.getByText(/\$1,000/)).toBeInTheDocument();
  });
});

describe("dashboard loader — where payouts go", () => {
  const load = (npo_id: number) =>
    dashboard_loader({
      context: { get: (k: unknown) => (k === admin_ctx ? npo_id : undefined) },
    } as any);
  const file_bank = (
    npo_id: number,
    id: string,
    status: "default" | "under-review",
    bank_summary = ""
  ) =>
    test_db
      .current!.db.insert(banking_apps)
      .values({ id, npo_id, status, bank_summary });

  it("names the default bank as where the money goes", async () => {
    const npo = await seed_npo();
    await file_bank(npo!.id, "bank-1", "default", "Chase ••1234");

    const data = await load(npo!.id);

    expect(data.payout_to).toEqual({ kind: "bank", summary: "Chase ••1234" });
    expect(data.bank_pending).toBe(false);
  });

  it("a bank filed and not yet reviewed is pending, not on file", async () => {
    const npo = await seed_npo();
    await file_bank(npo!.id, "bank-1", "under-review");

    const data = await load(npo!.id);

    expect(data.payout_to).toEqual({ kind: "none" });
    expect(data.bank_pending).toBe(true);
  });

  it("a second bank under review beside the default is not pending", async () => {
    const npo = await seed_npo();
    await file_bank(npo!.id, "bank-1", "default", "Chase ••1234");
    await file_bank(npo!.id, "bank-2", "under-review");

    const data = await load(npo!.id);

    expect(data.payout_to.kind).toBe("bank");
    expect(data.bank_pending).toBe(false);
  });

  it("with no bank filed, payouts go nowhere and nothing is pending", async () => {
    const npo = await seed_npo();

    const data = await load(npo!.id);

    expect(data.payout_to).toEqual({ kind: "none" });
    expect(data.bank_pending).toBe(false);
  });
});

describe("dashboard — returned payout notice", () => {
  const seed_payout = (
    npo_id: number,
    id: string,
    o: { type: "returned" | "settled"; amount: number; date: string }
  ) =>
    test_db.current!.db.insert(payouts).values({
      id,
      source_id: `don-${id}`,
      npo_id,
      source: "donation",
      ...o,
    });
  const notice = (screen: Awaited<ReturnType<typeof render_dashboard>>) =>
    screen.getByRole("region", { name: "Your bank sent a payout back" });

  it("names the one returned payout's amount and date, and links to the bank details", async () => {
    const npo = await seed_npo();
    await seed_nav_log({ price: 1, units: 0, value: 0 });
    await seed_payout(npo.id, "p-ret", {
      type: "returned",
      amount: 250,
      date: "2026-11-09T15:00:00.000Z",
    });

    const screen = await render_dashboard(npo.id);

    await expect.element(notice(screen)).toBeVisible();
    await expect
      .element(
        page
          .elementLocator(notice(screen).element())
          .getByText(
            "$250.00 from Nov 9 didn't reach your bank account, so it's back in your balance. Update your bank details, and it goes out again once the new ones are approved.",
            { exact: true }
          )
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("link", { name: "Update bank details", exact: true })
      )
      .toHaveAttribute("href", `/admin/${npo.id}/banking`);
    // the grant items card shows the same payout with its (!) explanation
    await expect
      .element(screen.getByText("Returned", { exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "What Returned means" }).click();
    await expect
      .element(
        screen.getByRole("tooltip", { name: /Your bank sent this back/ })
      )
      .toBeVisible();
  });

  it("counts several returned payouts and sums them", async () => {
    const npo = await seed_npo();
    await seed_nav_log({ price: 1, units: 0, value: 0 });
    for (const [id, amount, date] of [
      ["p-1", 250, "2026-11-09T15:00:00.000Z"],
      ["p-2", 400, "2026-11-04T15:00:00.000Z"],
      ["p-3", 80, "2026-10-30T15:00:00.000Z"],
    ] as const) {
      await seed_payout(npo.id, id, { type: "returned", amount, date });
    }

    const screen = await render_dashboard(npo.id);

    await expect
      .element(
        page
          .elementLocator(notice(screen).element())
          .getByText(
            "3 payouts ($730.00) didn't reach your bank account, so they're back in your balance. Update your bank details, and they go out again once the new ones are approved.",
            { exact: true }
          )
      )
      .toBeVisible();
  });

  it("is absent when no payout was returned", async () => {
    const npo = await seed_npo();
    await seed_nav_log({ price: 1, units: 0, value: 0 });
    await seed_payout(npo.id, "p-ok", {
      type: "settled",
      amount: 250,
      date: "2026-11-09T15:00:00.000Z",
    });

    const screen = await render_dashboard(npo.id);

    await expect.element(screen.getByText("Savings")).toBeVisible();
    expect(screen.getByText("Your bank sent a payout back").query()).toBeNull();
  });
});

describe("dashboard — payout strip during a return hold", () => {
  const RETURNED_AT = "2026-11-09T15:00:00.000Z";
  const seed_returned = async (npo_id: number) => {
    await test_db.current!.db.insert(settlements).values({
      id: `set-${npo_id}`,
      npo_id,
      date: RETURNED_AT,
      amount: 250,
      status: "returned",
    });
    await test_db.current!.db.insert(payouts).values({
      id: `p-${npo_id}`,
      source_id: `don-${npo_id}`,
      npo_id,
      source: "donation",
      type: "returned",
      amount: 250,
      date: RETURNED_AT,
    });
  };
  // the default account predates the returned transfer, so payouts stay held
  const file_old_bank = (npo_id: number) =>
    test_db.current!.db.insert(banking_apps).values({
      id: `bank-${npo_id}`,
      npo_id,
      status: "default",
      bank_summary: "Chase ••1234",
      date_created: "2026-11-01T15:00:00.000Z",
      updated_at: "2026-11-01T15:00:00.000Z",
    });
  const hold_sentence = (
    screen: Awaited<ReturnType<typeof render_dashboard>>
  ) => screen.getByText(/Payouts are on hold until your/);

  it("with a bank, shows the hold sentence and drops the Total / will-be-paid-out strip", async () => {
    const npo = await seed_npo();
    await seed_nav_log({ price: 1, units: 0, value: 0 });
    await seed_returned(npo.id);
    await file_old_bank(npo.id);

    const screen = await render_dashboard(npo.id);

    await expect.element(hold_sentence(screen)).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "new bank details" }))
      .toHaveAttribute("href", `/admin/${npo.id}/banking`);
    await expect
      .element(
        screen.getByText(
          "are approved. Donations wait in your Better Giving balance. Nothing is lost."
        )
      )
      .toBeVisible();
    expect(screen.getByText("Total", { exact: true }).query()).toBeNull();
    expect(screen.getByText(/will be paid out/).query()).toBeNull();
  });

  it("without a hold, the payout strip renders as before", async () => {
    const npo = await seed_npo();
    await seed_nav_log({ price: 1, units: 0, value: 0 });
    await file_old_bank(npo.id);
    await test_db.current!.db.insert(payouts).values({
      id: "p-ok",
      source_id: "don-ok",
      npo_id: npo.id,
      source: "donation",
      type: "settled",
      amount: 250,
      date: RETURNED_AT,
    });

    const screen = await render_dashboard(npo.id);

    await expect
      .element(screen.getByText("Total", { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText(/will be paid out/)).toBeVisible();
    expect(hold_sentence(screen).query()).toBeNull();
  });

  it("held with no bank keeps the no-bank copy, not the hold sentence", async () => {
    const npo = await seed_npo();
    await seed_nav_log({ price: 1, units: 0, value: 0 });
    await seed_returned(npo.id);

    const screen = await render_dashboard(npo.id);

    await expect
      .element(screen.getByText(/You have no way to get paid right now\./))
      .toBeVisible();
    expect(hold_sentence(screen).query()).toBeNull();
  });
});
