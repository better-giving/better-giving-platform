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
import { render } from "vitest-browser-react";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks (before imports) ---

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

vi.mock("$/kit/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    paymentMethods: { retrieve: vi.fn() },
    invoices: { retrieve: vi.fn() },
    refunds: { create: vi.fn() },
  },
}));

vi.mock("$/email", () => ({
  send_email: vi.fn().mockResolvedValue({ MessageId: "test-msg-id" }),
  ses: { send: vi.fn() },
  sender: "test@test.com",
}));

// capture enqueued events so we can replay settlement outside the transaction
// (pglite is single-connection — calling global `db` inside a tx deadlocks)
const _emitted: { id: string; payload: any; dedupe: string }[] = [];
vi.mock("$/kit/queue", () => ({
  enqueue: vi.fn(
    async (...msgs: { id: string; payload: any; dedupe: string }[]) => {
      _emitted.push(...msgs);
    }
  ),
}));

vi.mock("$/kit/slack", () => ({
  fiat_monitor: { send_alert: vi.fn() },
}));

vi.mock("#/.server/auth/middleware", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    user_ctx: true,
    middleware: true,
  })
);
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock({
    session: { user: undefined },
    user_ctx: true,
    middleware: true,
  })
);

vi.mock("remix-client-cache", () => ({
  CacheRoute: (C: any) => C,
  createClientLoaderCache: () => undefined,
}));

vi.mock("swr", () => ({
  default: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("swr/immutable", () => ({
  default: () => ({ data: undefined, isLoading: false }),
}));

// --- imports after mocks ---

import { eq } from "drizzle-orm";
import { createRoutesStub } from "react-router";
import { loader as fund_loader } from "#/routes/_app.campaigns.$fund_id/api";
// fund page — for fund Target directly
import FundPage from "#/routes/_app.campaigns.$fund_id/route";
import { loader as user_forms_loader } from "#/routes/dashboard.forms/api";
// user-dashboard forms — for form ltd verification
import UserFormsPage from "#/routes/dashboard.forms/route";
// org profile page — the fund's goal on its Campaigns card
import ProfilePage, {
  loader as profile_loader,
} from "#/routes/org.$org._index/route";
// platform-admin refunds pages
import RefundsListPage from "#/routes/platform.donations/route";
import {
  action as refund_action,
  loader as refund_loader,
} from "#/routes/platform.donations.$donation_id.refund/api";
import RefundDialog from "#/routes/platform.donations.$donation_id.refund/route";
import type { IDonation } from "@/donations";
import { donation_put } from "$/pg/queries/donation";
import { bal_txs } from "$/pg/schema/bal-tx";
import { dists } from "$/pg/schema/dist";
import { forms } from "$/pg/schema/form";
import { fund_members, funds } from "$/pg/schema/fund";
import { npos } from "$/pg/schema/npo";
import { payouts } from "$/pg/schema/payout";
import { v_donation_total_usd } from "$/pg/schema/views";
import { create_test_db } from "$/pg/test-utils/pglite";
import {
  seed_form,
  seed_nav_log,
  seed_user,
  settle_via_webhook,
  setup_refund_stripe_mocks,
  setup_stripe_mocks,
  truncate_all,
  user_middleware,
} from "./fixtures/settlement";

// --- setup ---

const FUND_ID = "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4";
const DON_ID = "fund-don-001";
const FORM_ID = "user-form-001";
const FUTURE = new Date(Date.now() + 86400000 * 365).toISOString();

const NPO_A_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-FUND-A",
  name: "Fund NPO A",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
  published: true,
  active: true,
  fiscal_sponsored: true,
  hide_bg_tip: false,
  allocation: { liq: 60, lock: 20, cash: 20 },
  referrer_user: "PREF-TEST",
  referrer_expiry: FUTURE,
};

const NPO_B_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-FUND-B",
  name: "Fund NPO B",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
  published: true,
  active: true,
  fiscal_sponsored: false,
  hide_bg_tip: true,
  allocation: { liq: 0, lock: 0, cash: 100 },
};

const NPO_C_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-FUND-C",
  name: "Fund NPO C",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
  published: true,
  active: true,
  fiscal_sponsored: false,
  hide_bg_tip: false,
  allocation: { liq: 50, lock: 50, cash: 0 },
  referrer_user: "UREF-TEST",
  referrer_expiry: FUTURE,
};

let render_screen: Awaited<ReturnType<typeof render>> | null = null;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

afterEach(() => {
  render_screen?.unmount();
  render_screen = null;
});

// --- helpers ---

let npo_a_id: number;
let npo_b_id: number;
let npo_c_id: number;

async function seed() {
  // users (FK for funds.creator_id + form owner)
  await seed_user(test_db.current!.db, {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    email: "fund-creator@test.com",
    first_name: "Fund",
    last_name: "Creator",
    referral_code: "PREF-TEST",
  });
  await seed_user(test_db.current!.db, {
    id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    email: "user-referrer@test.com",
    first_name: "User",
    last_name: "Referrer",
    referral_code: "UREF-TEST",
  });

  // npo a: tip + fsa-fee (with referral commission)
  const [a] = await test_db
    .current!.db.insert(npos)
    .values(NPO_A_SEED)
    .returning();
  // npo b: tip + base-fee (no commission)
  const [b] = await test_db
    .current!.db.insert(npos)
    .values(NPO_B_SEED)
    .returning();
  // npo c: tip only (with referral commission)
  const [c] = await test_db
    .current!.db.insert(npos)
    .values(NPO_C_SEED)
    .returning();
  npo_a_id = a.id;
  npo_b_id = b.id;
  npo_c_id = c.id;

  // fund
  await test_db.current!.db.insert(funds).values({
    id: FUND_ID,
    name: "Test Fund",
    description_pt: "integration test fund",
    banner: "https://img.co/banner.png",
    logo: "https://img.co/logo.png",
    npo_owner: npo_a_id,
    creator_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    active: true,
    published: true,
    target_number: 1000,
  });
  await test_db.current!.db.insert(fund_members).values(
    [npo_a_id, npo_b_id, npo_c_id].map((npo_id, i) => ({
      fund_id: FUND_ID,
      npo_id,
      position: i,
    }))
  );

  // user-owned form (source for the donation)
  const now = new Date().toISOString();
  await seed_form(test_db.current!.db, {
    id: FORM_ID,
    name: "User Donation Form",
    owner_user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    tag: "user-form-tag",
    recipient_fund_id: FUND_ID,
    date_created: now,
    target_number: 5000,
  });

  await seed_nav_log(test_db.current!.db, now);

  // donation to fund via user form
  const don: IDonation = {
    id: DON_ID,
    upusd: 1,
    status: "intent",
    amount: { base: 300, tip: 15, fee_allowance: 0 },
    currency: "USD",
    frequency: "one-time",
    source: "bg-widget",
    form_id: FORM_ID,
    via: "stripe",
    to_id: FUND_ID,
    to_name: "Test Fund",
    to_type: "fund",
    to_tip_allowed: false,
    to_members: [npo_a_id.toString(), npo_b_id.toString(), npo_c_id.toString()],
    from_email: "donor@test.com",
    from_name: "Jane Donor",
    created_at: now,
    updated_at: now,
  };
  await donation_put(test_db.current!.db as any, don);
  return don;
}

const INTENT = {
  order_id: DON_ID,
  pi_id: "pi_fund_test",
  amount: 31500,
  payment_method: "pm_fund_test",
};

function fire_webhook(order_id = INTENT.order_id) {
  return settle_via_webhook({
    db: test_db.current!.db,
    emitted: _emitted,
    intent: { ...INTENT, order_id },
  });
}

// --- expected values ---
// donation: base=300, tip=15, fa=0, total=315, upusd=1
// stripe: net=300 (30000/100), fee=15 (1500/100)
// partition: base_r=300/315, tip_r=15/315

const TOTAL = 315;
const BASE_R = 300 / TOTAL;
const N = 3;

// per-npo settlement amounts (÷3)
const PER_STTL_BASE = (300 * BASE_R) / N; // ≈95.238

// credit_fa path: fa=0 → fa_added = PER_STTL_BASE
const FA_ADDED = PER_STTL_BASE;
// fees are on the full gift: the settled share plus its share of the $15 fee
const PER_FULL_BASE = ((300 + 15) * BASE_R) / N; // 100

// --- npo a: fsa=2.9%, referrer=30% ---
const A_FSA = PER_FULL_BASE * 0.029;
const A_NET = FA_ADDED - A_FSA;

// --- npo b: base=1.5%, no referrer ---
const B_BASE_FEE = PER_FULL_BASE * 0.015;
const B_NET = FA_ADDED - B_BASE_FEE;

// --- npo c: no fees, referrer=30% ---
const C_NET = FA_ADDED;

// form ltd: each npo settlement increments by that npo's net
const FORM_LTD = A_NET + B_NET + C_NET;

const P = 2;

// --- tests ---

describe("fund donation → settlement across 3 NPOs → DB + UI", () => {
  beforeEach(async () => {
    await truncate_all(test_db.current!.db);
    await seed();
    setup_stripe_mocks({ net: 30000, fee: 1500 });
  });

  it("persists the plan for each member — 3 dists, balances and payouts", async () => {
    const res = await fire_webhook();
    expect(res.status).toBe(200);

    const rows = await test_db.current!.db.select().from(dists);
    expect(rows).toHaveLength(3);

    const txs = await test_db.current!.db.select().from(bal_txs);
    const pos = await test_db.current!.db.select().from(payouts);
    const bals = await test_db
      .current!.db.select({
        id: npos.id,
        liq: npos.liq,
        lock_units: npos.lock_units,
        cash: npos.cash,
      })
      .from(npos);

    const allocs: Record<number, { liq: number; lock: number; cash: number }> =
      {
        [npo_a_id]: { liq: 60, lock: 20, cash: 20 },
        [npo_b_id]: { liq: 0, lock: 0, cash: 100 },
        [npo_c_id]: { liq: 50, lock: 50, cash: 0 },
      };
    const expected: Record<
      number,
      { net: number; fee_base: number; fee_fsa: number }
    > = {
      [npo_a_id]: { net: 92.34, fee_base: 0, fee_fsa: 2.9 },
      [npo_b_id]: { net: 93.74, fee_base: 1.5, fee_fsa: 0 },
      [npo_c_id]: { net: 95.24, fee_base: 0, fee_fsa: 0 },
    };

    for (const d of rows) {
      expect(d.donation_id).toBe(DON_ID);
      expect(d.status).toBe("settled");
      expect(d.amount_denom).toBe("USD");

      // every row a member's leg wrote is that leg's own persisted net,
      // split by the allocation persisted beside it
      const alloc = allocs[d.to_id!];
      expect(d.alloc).toEqual(alloc);

      // each member's $95.24 settled share, fees on its $100 full share
      const exp = expected[d.to_id!];
      expect(d.net).toBeCloseTo(exp.net, P);
      expect(d.fee_base).toBeCloseTo(exp.fee_base, P);
      expect(d.fee_fsa).toBeCloseTo(exp.fee_fsa, P);

      const share = (pct: number) => (d.net! * pct) / 100;
      const liq_tx = txs.find(
        (t) => t.npo_id === d.to_id && t.account === "liq"
      );
      const lock_tx = txs.find(
        (t) => t.npo_id === d.to_id && t.account === "lock"
      );
      const po = pos.find((p) => p.npo_id === d.to_id);
      const bal = bals.find((n) => n.id === d.to_id)!;

      expect(liq_tx?.amount ?? 0).toBeCloseTo(share(alloc.liq), P);
      expect(lock_tx?.amount ?? 0).toBeCloseTo(share(alloc.lock), P);
      expect(po?.amount ?? 0).toBeCloseTo(share(alloc.cash), P);
      expect(po?.type ?? "pending").toBe("pending");
      expect(bal.liq).toBeCloseTo(share(alloc.liq), P);
      // lock_units = lock_amount / nav_price (nav_price=1)
      expect(bal.lock_units).toBeCloseTo(share(alloc.lock), P);
      expect(bal.cash).toBeCloseTo(share(alloc.cash), P);
    }

    // a zero-percent leg writes no row at all
    expect(txs).toHaveLength(4);
    expect(pos).toHaveLength(2);
  });

  it("emits donation.settled.dist event for fund", async () => {
    await fire_webhook();

    const settled = _emitted.filter((e) => e.id === "don-dist");
    // one event per NPO in the fund
    expect(settled).toHaveLength(3);

    const total_net = settled.reduce((sum, e) => sum + e.payload.net, 0);
    expect(total_net).toBeCloseTo(FORM_LTD, P);
    for (const e of settled) {
      expect(e.payload.amount_denom).toBe("USD");
    }
  });

  it("increments form ltd and ltd_count after settlement", async () => {
    await fire_webhook();

    const [form] = await test_db
      .current!.db.select()
      .from(forms)
      .where(eq(forms.id, FORM_ID));
    // each npo settlement increments form ltd by its net, ltd_count by 1
    expect(form.ltd).toBeCloseTo(FORM_LTD, P);
    expect(form.ltd_count).toBe(3);
  });

  it("v_donation_total_usd aggregates to correct fund total", async () => {
    await fire_webhook();

    const [row] = await test_db
      .current!.db.select()
      .from(v_donation_total_usd)
      .where(eq(v_donation_total_usd.fund_id, FUND_ID));
    expect(row.total).toBeCloseTo(FORM_LTD, P);
  });

  it("fund page Target shows progress after settlement", async () => {
    await fire_webhook();

    const Stub = createRoutesStub([
      {
        path: "/campaigns/:fund_id",
        Component: FundPage,
        HydrateFallback: () => null,
        loader: fund_loader as any,
      },
    ]);

    const screen = await render(
      <Stub
        initialEntries={[`/campaigns/${FUND_ID}`]}
        future={{ v8_middleware: true }}
      />
    );
    render_screen = screen;

    await expect.element(screen.getByText("Test Fund")).toBeInTheDocument();
    // fund page renders member NPOs
    await expect.element(screen.getByText("Fund NPO A")).toBeInTheDocument();
    await expect.element(screen.getByText("Fund NPO B")).toBeInTheDocument();
    await expect.element(screen.getByText("Fund NPO C")).toBeInTheDocument();
    // Target shows raised from v_donation_total_usd (sum of nets, ~281.31), $1,000 goal from target_number
    expect(screen.getByText("$281").elements().length).toBeGreaterThanOrEqual(
      1
    );
    expect(screen.getByText("$1,000").elements().length).toBeGreaterThanOrEqual(
      1
    );
    expect(screen.getByText("Raised").elements().length).toBeGreaterThanOrEqual(
      1
    );
    expect(screen.getByText("Goal").elements().length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("profile page Campaigns section shows the fund against its goal", async () => {
    await fire_webhook();

    const Stub = createRoutesStub([
      {
        path: "/org/:org",
        Component: ProfilePage as any,
        HydrateFallback: () => null,
        loader: profile_loader as any,
      },
    ]);

    const screen = await render(
      <Stub
        initialEntries={[`/org/${npo_a_id}`]}
        future={{ v8_middleware: true }}
      />
    );
    render_screen = screen;

    await expect
      .element(screen.getByText("Test Fund", { exact: true }))
      .toBeInTheDocument();
    // the fund's own card: what it raised against its goal
    const card = screen.getByRole("article").filter({ hasText: "Test Fund" });
    await expect.element(card).toMatchTextContent(/\$281 of \$1,000/);
  });

  it("user-dashboard forms page shows form with updated ltd Target", async () => {
    await fire_webhook();

    const mdlwr = user_middleware(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "fund-creator@test.com"
    );

    const Stub = createRoutesStub([
      {
        path: "/forms",
        Component: UserFormsPage,
        HydrateFallback: () => null,
        loader: user_forms_loader as any,
        middleware: mdlwr,
      },
    ]);

    const screen = await render(
      <Stub initialEntries={["/forms"]} future={{ v8_middleware: true }} />
    );
    render_screen = screen;

    // page heading loads
    await expect
      .element(screen.getByRole("heading", { name: /Donation forms/i }))
      .toBeInTheDocument();
    // form card renders with tag and Target showing ltd progress
    await expect.element(screen.getByText("user-form-tag")).toBeInTheDocument();
    await expect.element(screen.getByText("$5,000")).toBeInTheDocument();
    expect(screen.getByText("Raised").elements().length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("refund dialog shows preview with 3 NPO distributions", async () => {
    await fire_webhook();
    setup_refund_stripe_mocks({ ...INTENT, refund_id: "re_fund_789" });

    const empty_list = () => ({
      items: [],
    });

    const Stub = createRoutesStub([
      {
        path: "/refunds",
        Component: RefundsListPage,
        HydrateFallback: () => null,
        loader: empty_list as any,
        children: [
          {
            path: ":donation_id/refund",
            Component: RefundDialog,
            loader: refund_loader as any,
            action: refund_action as any,
          },
        ],
      },
    ]);

    const screen = await render(
      <Stub
        initialEntries={[`/refunds/${DON_ID}/refund`]}
        future={{ v8_middleware: true }}
      />
    );
    render_screen = screen;

    await expect
      .element(screen.getByText("Refund preview"))
      .toBeInTheDocument();
    // 3 NPOs in preview table
    await expect.element(screen.getByText("Fund NPO A")).toBeInTheDocument();
    await expect.element(screen.getByText("Fund NPO B")).toBeInTheDocument();
    await expect.element(screen.getByText("Fund NPO C")).toBeInTheDocument();
    // effects: A has liq+lock+cash, B has cash only, C has liq+lock
    expect(
      screen.getByText("Savings balance").elements().length
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText("Investment balance").elements().length
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText("Grant payout").elements().length
    ).toBeGreaterThanOrEqual(1);
    // commissions for A and C
    expect(screen.getByText("Commission").elements()).toHaveLength(2);
    // confirm enabled
    const btn = screen.getByRole("button", { name: /Confirm refund/i });
    await expect.element(btn).not.toBeDisabled();
  });
});
