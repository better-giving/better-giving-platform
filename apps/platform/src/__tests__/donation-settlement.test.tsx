import { createRoutesStub, Outlet } from "react-router";
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

vi.mock("#/errors/report", () => ({
  report_error: vi.fn(),
  report_degraded: vi.fn(),
  report_null: vi.fn(() => null),
  report_undefined: vi.fn(() => undefined),
  report_msg: vi.fn((_, m: string) => m),
  report_obj: vi.fn((_, v) => v),
  report_resp: vi.fn(
    (_, message?: string, status = 500) =>
      new Response(message ?? "Server Error", { status })
  ),
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
// admin donations page
import { npo_donors } from "#/.server/npo-donors";
import type { LoaderData } from "#/pages/admin/types";
import { loader as admin_donations_loader } from "#/routes/admin.$id.donations/api";
import AdminDonationsPage from "#/routes/admin.$id.donations/route";
import { action as stripe_action } from "#/routes/api.stripe-webhook/route";
// user dashboard final tab
import { loader as user_donations_loader } from "#/routes/dashboard.donations._index/api";
import UserDonationsPage from "#/routes/dashboard.donations._index/route";
import type { IDonation } from "@/donations";
import { admin_ctx } from "$/auth/test-utils";
import { stripe } from "$/kit/stripe";
import { donation_put } from "$/pg/queries/donation";
import { user } from "$/pg/schema/auth";
import { bal_txs } from "$/pg/schema/bal-tx";
import { dists } from "$/pg/schema/dist";
import { donation_donors } from "$/pg/schema/donation";
import { donation_messages } from "$/pg/schema/donation-message";
import { forms } from "$/pg/schema/form";
import { npos } from "$/pg/schema/npo";
import { payouts } from "$/pg/schema/payout";
import { programs } from "$/pg/schema/program";
import { create_test_db } from "$/pg/test-utils/pglite";
import {
  seed_form,
  seed_nav_log,
  seed_user,
  settle_via_webhook,
  setup_stripe_mocks,
  stripe_event,
  truncate_all,
  user_middleware,
} from "./fixtures/settlement";

// --- setup ---

// fiscal_sponsored + hide_bg_tip → generates fsa-fee + base-fee revenue logs
// mixed allocation → generates bal_txs (lock), payouts (cash), liq balance update
const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-STTL-TEST",
  name: "Settlement Test NPO",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
  published: true,
  active: true,
  fiscal_sponsored: true,
  hide_bg_tip: true,
  allocation: { liq: 50, lock: 30, cash: 20 },
  target_smart: true,
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

let npo_id: number;

const NPO_FORM_ID = "npo-form-001";
const USER_FORM_ID = "user-form-002";
const PROGRAM_ID = "b0b0b0b0-c1c1-d2d2-e3e3-f4f4f4f4f4f4";

async function seed() {
  // user (FK for user-owned form)
  await seed_user(test_db.current!.db, {
    id: "test-donor-id",
    email: "donor@test.com",
    first_name: "Jane",
    last_name: "Donor",
  });

  // seed npo
  const [npo] = await test_db
    .current!.db.insert(npos)
    .values(NPO_SEED)
    .returning();
  npo_id = npo.id;

  const now = new Date().toISOString();

  // npo-owned form (not used as source — verifies admin/forms renders it)
  await seed_form(test_db.current!.db, {
    id: NPO_FORM_ID,
    name: "NPO Donation Form",
    owner_npo_id: npo_id,
    tag: "npo-form-tag",
    recipient_npo_id: npo_id,
    date_created: now,
    target_number: 2000,
  });

  // user-owned form (source for the donation — ltd incremented by settlement)
  await seed_form(test_db.current!.db, {
    id: USER_FORM_ID,
    name: "User Donation Form",
    owner_user_id: "test-donor-id",
    tag: "user-form-tag",
    recipient_npo_id: npo_id,
    date_created: now,
    target_number: 3000,
  });

  // program (for program attribution)
  await test_db.current!.db.insert(programs).values({
    id: PROGRAM_ID,
    npo_id: npo_id,
    title: "Test Program",
    description_pt: "integration test program",
    target_raise: 500,
    total_donations: 0,
    created_at: now,
  });

  await seed_nav_log(test_db.current!.db, now);

  // seed donation in "intent" state — via user form, attributed to program
  const don: IDonation = {
    id: "test-order-123",
    upusd: 1,
    status: "intent",
    amount: { base: 100, tip: 5, fee_allowance: 0 },
    currency: "USD",
    frequency: "one-time",
    source: "bg-widget",
    form_id: USER_FORM_ID,
    via: "stripe",
    to_id: npo_id.toString(),
    to_name: "Settlement Test NPO",
    to_type: "npo",
    to_tip_allowed: false,
    to_members: [],
    from_email: "donor@test.com",
    from_name: "Jane Donor",
    program: { id: PROGRAM_ID, name: "Test Program" },
    created_at: now,
    updated_at: now,
  };
  await donation_put(test_db.current!.db as any, don);
  return don;
}

function make_admin_data(id: number): LoaderData {
  return {
    id,
    user: { email: "admin@test.com" } as any,
    endow: {
      logo: null,
      name: "Settlement Test NPO",
      allocation: { liq: 50, lock: 30, cash: 20 },
      payout_minimum: undefined as any,
    },
  };
}

const INTENT = {
  order_id: "test-order-123",
  pi_id: "pi_test_123",
  amount: 10500,
  payment_method: "pm_test_456",
};

// program page (nested under profile)
import { loader as admin_forms_loader } from "#/routes/admin.$id.forms/api";
// admin forms page
import AdminFormsPage from "#/routes/admin.$id.forms/route";
import { loader as user_forms_loader } from "#/routes/dashboard.forms/api";
// user-dashboard forms page
import UserFormsPage from "#/routes/dashboard.forms/route";
// npo profile page
import ProfilePage, {
  loader as profile_loader,
} from "#/routes/org.$org._index/route";
import ProgramPage, {
  loader as program_loader,
} from "#/routes/org.$org.program.$program_id/route";
// platform-admin revenue pages
import { loader as rev_loader } from "#/routes/platform.revenue/api";
import RevenuePage from "#/routes/platform.revenue/route";
import { loader as rev_logs_loader } from "#/routes/platform.revenue_.logs/api";
import RevLogsPage from "#/routes/platform.revenue_.logs/route";

// --- helpers ---

function fire_webhook(order_id = INTENT.order_id) {
  return settle_via_webhook({
    db: test_db.current!.db,
    emitted: _emitted,
    intent: { ...INTENT, order_id },
  });
}

// --- expected values ---
// donation: base=100, tip=5, fa=0, upusd=1
// stripe settlement: net=95 (9500/100), fee=5 (500/100)
// partition ratio: base=100/105, tip=5/105

const GROSS = 95 * (100 / 105); // base portion of settlement net: ~90.476
const TIP = 95 * (5 / 105); // tip portion: ~4.524
// fees: base=1.5%, fsa=2.9% of the full gift, its fee share included
const FULL = (95 + 5) * (100 / 105); // ~95.238
const BASE_FEE = FULL * 0.015; // ~1.429
const FSA_FEE = FULL * 0.029; // ~2.762
const NET = GROSS - BASE_FEE - FSA_FEE; // ~86.286

const P = 2; // precision digits for toBeCloseTo

// --- tests ---

describe("payment_intent.succeeded → settlement → UI", () => {
  beforeEach(async () => {
    await truncate_all(test_db.current!.db);
    await seed();
    setup_stripe_mocks({ net: 9500, fee: 500 });
  });

  it("persists the plan — dist row, balance txs, payout and npo balances", async () => {
    const res = await fire_webhook();
    expect(res.status).toBe(200);

    const [dist] = await test_db.current!.db.select().from(dists);
    expect(dist.status).toBe("settled");
    expect(dist.to_id).toBe(npo_id);
    expect(dist.amount_denom).toBe("USD");
    expect(dist.net!).toBeCloseTo(NET, P);
    expect(dist.alloc).toEqual({ liq: 50, lock: 30, cash: 20 });

    // every downstream row is the persisted dist's own net split by its own alloc
    const txs = await test_db.current!.db.select().from(bal_txs);
    const lock_tx = txs.find((t) => t.account === "lock")!;
    const liq_tx = txs.find((t) => t.account === "liq")!;
    expect(liq_tx.amount).toBeCloseTo(dist.net! * 0.5, P);
    expect(liq_tx.status).toBe("final");
    expect(liq_tx.account_other).toBe("donation");
    expect(lock_tx.amount).toBeCloseTo(dist.net! * 0.3, P);
    expect(lock_tx.status).toBe("final");

    // cash allocation → pending payout
    const [po] = await test_db.current!.db.select().from(payouts);
    expect(po.amount).toBeCloseTo(dist.net! * 0.2, P);
    expect(po.type).toBe("pending");
    expect(po.source).toBe("donation");

    const [npo] = await test_db
      .current!.db.select({
        liq: npos.liq,
        lock_units: npos.lock_units,
        cash: npos.cash,
      })
      .from(npos);
    expect(npo.liq).toBeCloseTo(dist.net! * 0.5, P);
    // lock_units = lock_amount / nav_price (nav_price=1)
    expect(npo.lock_units).toBeCloseTo(dist.net! * 0.3, P);
    expect(npo.cash).toBeCloseTo(dist.net! * 0.2, P);
  });

  it("admin donations page renders correct donor, method, and fee values", async () => {
    await fire_webhook();

    const mdlwr = [
      async ({ context }: any, next: any) => {
        context.set(admin_ctx, npo_id);
        return next();
      },
    ];

    const Stub = createRoutesStub([
      {
        id: "admin",
        path: "/admin/:id",
        Component: () => <Outlet />,
        HydrateFallback: () => null,
        loader: () => make_admin_data(npo_id),
        children: [
          {
            id: "donations",
            path: "donations",
            Component: AdminDonationsPage,
            loader: admin_donations_loader as any,
            middleware: mdlwr,
          },
        ],
      },
    ]);

    const screen = await render(
      <Stub
        initialEntries={[`/admin/${npo_id}/donations`]}
        future={{ v8_middleware: true }}
      />
    );
    render_screen = screen;

    // wait for data to load, then verify content values
    await expect.element(screen.getByText("Jane Donor")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Card", { exact: true }))
      .toBeInTheDocument();
    // fee labels conditionally rendered (only when > 0)
    // fiscal_sponsored + hide_bg_tip → all 3 fee types show
    await expect.element(screen.getByText(/^base$/)).toBeInTheDocument();
    await expect
      .element(screen.getByText(/^fiscal sponsorship$/))
      .toBeInTheDocument();
    await expect.element(screen.getByText(/^processing$/)).toBeInTheDocument();
    // net amount rendered (exact value verified in DB test)
    await expect.element(screen.getByText(/\$86/)).toBeInTheDocument();
    // program attribution
    await expect.element(screen.getByText("Test Program")).toBeInTheDocument();
    // form origin: source=bg-widget → "Donation Form" heading with form tag below
    await expect
      .element(screen.getByText("Donation Form", { exact: true }))
      .toBeInTheDocument();
    await expect.element(screen.getByText("user-form-tag")).toBeInTheDocument();
  });

  it("user dashboard renders correct recipient and payment method", async () => {
    await fire_webhook();

    const mdlwr = user_middleware("test-donor-id", "donor@test.com");

    const Stub = createRoutesStub([
      {
        path: "/donations",
        Component: UserDonationsPage,
        HydrateFallback: () => null,
        loader: user_donations_loader as any,
        middleware: mdlwr,
      },
    ]);

    const screen = await render(
      <Stub initialEntries={["/donations"]} future={{ v8_middleware: true }} />
    );
    render_screen = screen;

    // recipient name + payment method (capitalize renders "card" → "card")
    await expect
      .element(screen.getByText("Settlement Test NPO"))
      .toBeInTheDocument();
    await expect.element(screen.getByText(/card/i)).toBeInTheDocument();
    // frequency shown (css uppercase, dom text is lowercase)
    await expect.element(screen.getByText("one-time")).toBeInTheDocument();
    // program attribution shown as link below recipient
    await expect.element(screen.getByText("Test Program")).toBeInTheDocument();
  });

  it("platform-admin revenue page renders correct LTD totals and per-npo breakdown", async () => {
    await fire_webhook();

    const Stub = createRoutesStub([
      {
        path: "/revenue",
        Component: RevenuePage,
        HydrateFallback: () => null,
        loader: rev_loader as any,
        children: [
          {
            path: "logs",
            Component: RevLogsPage,
            loader: rev_logs_loader as any,
          },
        ],
      },
    ]);

    const screen = await render(
      <Stub initialEntries={["/revenue"]} future={{ v8_middleware: true }} />
    );
    render_screen = screen;

    // wait for page load
    await expect.element(screen.getByText("Total Revenue")).toBeInTheDocument();

    // LTD card values (first 4 $-prefixed elements): total, tip, base_fee, fsa_fee
    const dollar_els = screen.getByText(/^\$\d/).elements();
    const parse_dollar = (el: Element) =>
      Number.parseFloat(el.textContent!.replace("$", "").replace(/,/g, ""));

    const [total, tip_ltd, base_ltd, fsa_ltd] = dollar_els
      .slice(0, 4)
      .map(parse_dollar);
    const expected_total = TIP + BASE_FEE + FSA_FEE;
    expect(total).toBeCloseTo(expected_total, 1);
    expect(tip_ltd).toBeCloseTo(TIP, 1);
    expect(base_ltd).toBeCloseTo(BASE_FEE, 1);
    expect(fsa_ltd).toBeCloseTo(FSA_FEE, 1);

    // per-npo row shows npo name (appears in both breakdown table and log table)
    expect(
      screen.getByText("Settlement Test NPO").elements().length
    ).toBeGreaterThanOrEqual(1);

    // recent revenue log entries show all 3 types
    await expect
      .element(screen.getByText("tip", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("base-fee", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("fsa-fee", { exact: true }))
      .toBeInTheDocument();
  });

  it("profile page shows no org-wide total or goal after settlement", async () => {
    await fire_webhook();

    // targets live in campaigns and programs only, so the settled $100 shows
    // nowhere on the org page while the program keeps its own target
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
        initialEntries={[`/org/${npo_id}`]}
        future={{ v8_middleware: true }}
      />
    );
    render_screen = screen;

    await expect
      .element(screen.getByRole("progressbar", { name: /Test Program/ }))
      .toBeInTheDocument();
    expect(screen.getByText("$100", { exact: true }).elements()).toHaveLength(
      0
    );
    expect(screen.getByText(/goal/).elements()).toHaveLength(0);
  });

  it("increments form ltd and program total_donations after settlement", async () => {
    await fire_webhook();

    const [form] = await test_db
      .current!.db.select()
      .from(forms)
      .where(eq(forms.id, USER_FORM_ID));
    expect(form.ltd).toBeCloseTo(NET, P);
    expect(form.ltd_count).toBe(1);

    const [prog] = await test_db
      .current!.db.select()
      .from(programs)
      .where(eq(programs.id, PROGRAM_ID));
    expect(prog.total_donations).toBeCloseTo(NET, P);
  });

  it("program page shows its target card after settlement", async () => {
    await fire_webhook();

    const Stub = createRoutesStub([
      {
        path: "/org/:org/program/:program_id",
        Component: ProgramPage as any,
        HydrateFallback: () => null,
        loader: program_loader as any,
      },
    ]);

    const screen = await render(
      <Stub
        initialEntries={[`/org/${npo_id}/program/${PROGRAM_ID}`]}
        future={{ v8_middleware: true }}
      />
    );
    render_screen = screen;

    await expect
      .element(screen.getByRole("heading", { name: "Test Program" }))
      .toBeInTheDocument();
    // target_raise=500; total_donations ≈ NET (86.286) is the raised figure
    await expect
      .element(screen.getByText("$86", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("17% of $500 goal", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("progressbar", { name: "Amount raised" }))
      .toBeInTheDocument();
  });

  it("admin forms page shows form with updated ltd Target", async () => {
    await fire_webhook();

    const mdlwr = [
      async ({ context }: any, next: any) => {
        context.set(admin_ctx, npo_id);
        return next();
      },
    ];

    const Stub = createRoutesStub([
      {
        path: "/forms",
        Component: AdminFormsPage,
        HydrateFallback: () => null,
        loader: admin_forms_loader as any,
        middleware: mdlwr,
      },
    ]);

    const screen = await render(
      <Stub initialEntries={["/forms"]} future={{ v8_middleware: true }} />
    );
    render_screen = screen;

    await expect
      .element(screen.getByRole("heading", { name: /Donation forms/i }))
      .toBeInTheDocument();
    // form card renders with tag and Target showing ltd progress
    await expect.element(screen.getByText("npo-form-tag")).toBeInTheDocument();
    // form Target goal = $2,000
    await expect.element(screen.getByText("$2,000")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Raised", { exact: true }))
      .toBeInTheDocument();
  });

  it("user-dashboard forms page shows user form with updated ltd", async () => {
    await fire_webhook();

    const mdlwr = user_middleware("test-donor-id", "donor@test.com");

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

    await expect
      .element(screen.getByRole("heading", { name: /Donation forms/i }))
      .toBeInTheDocument();
    // user form card with tag and Target showing ltd after settlement
    await expect.element(screen.getByText("user-form-tag")).toBeInTheDocument();
    // form Target goal = $3,000
    await expect.element(screen.getByText("$3,000")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Raised", { exact: true }))
      .toBeInTheDocument();
  });

  it("donor message created on settlement with avatar from joined user", async () => {
    // update donation to have public message + update user to have avatar
    await test_db
      .current!.db.update(donation_donors)
      .set({ is_public: true, public_msg: "Great cause!" })
      .where(eq(donation_donors.donation_id, "test-order-123"));
    await test_db
      .current!.db.update(user)
      .set({ avatar_url: "https://example.com/jane.jpg" })
      .where(eq(user.id, "test-donor-id"));

    await fire_webhook();

    // verify donation_message was inserted
    const msgs = await test_db.current!.db.select().from(donation_messages);
    expect(msgs.length).toBe(1);
    expect(msgs[0].donor_name).toBe("Jane Donor");
    expect(msgs[0].donor_message).toBe("Great cause!");
    expect(msgs[0].npo_id).toBe(npo_id.toString());

    // verify npo_donors joins through donation_donors → user for avatar
    const page = await npo_donors(npo_id.toString());
    expect(page.items.length).toBe(1);
    expect(page.items[0].donor_name).toBe("Jane Donor");
    expect(page.items[0].donor_message).toBe("Great cause!");
    expect(page.items[0].photo).toBe("https://example.com/jane.jpg");
  });

  it("donor message without matching user shows no avatar", async () => {
    // donor email doesn't match any user
    await test_db
      .current!.db.update(donation_donors)
      .set({
        is_public: true,
        public_msg: "Keep it up!",
        email: "stranger@example.com",
      })
      .where(eq(donation_donors.donation_id, "test-order-123"));

    await fire_webhook();

    const page = await npo_donors(npo_id.toString());
    expect(page.items.length).toBe(1);
    expect(page.items[0].donor_name).toBe("Jane Donor");
    expect(page.items[0].photo).toBeUndefined();
  });

  it("returns 400 on handler error", async () => {
    const { report_error } = await import("#/errors/report");
    (report_error as any).mockClear();
    (stripe.paymentIntents.retrieve as any).mockRejectedValue(
      new Error("stripe api down")
    );

    const res = await stripe_action({
      request: new Request("http://localhost/api/stripe-webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: stripe_event(INTENT),
      }),
      params: {},
      context: {} as any,
      url: new URL("http://localhost/api/stripe-webhook"),
      pattern: "/api/stripe-webhook",
    });

    expect(res.status).toBe(400);
    expect(report_error).toHaveBeenCalled();
    expect((report_error as any).mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
