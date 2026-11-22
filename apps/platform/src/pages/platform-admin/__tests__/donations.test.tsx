import { createRoutesStub } from "react-router";
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
import { bal_txs } from "$/pg/schema/bal-tx";
import { dists } from "$/pg/schema/dist";
import {
  donation_donors,
  donation_recipients,
  donation_settlements,
  donations,
} from "$/pg/schema/donation";
import { donation_match_events } from "$/pg/schema/match";
import { npos } from "$/pg/schema/npo";
import { rev_logs } from "$/pg/schema/revenue";
import { donation_takes } from "$/pg/schema/take";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks (hoisted) ---

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

vi.mock("$/kit/stripe", () => ({
  stripe: {
    // no subscription billed the payment
    invoicePayments: { list: vi.fn(async () => ({ data: [] })) },
    // a refund of the whole $5 charge stripe accepts; the action re-reads it
    // and lists earlier ones
    refunds: {
      create: vi.fn(async () => ({
        id: "re_1",
        status: "succeeded",
        amount: 500,
        currency: "usd",
      })),
      retrieve: vi.fn(async () => ({
        id: "re_1",
        status: "succeeded",
        amount: 500,
        currency: "usd",
      })),
      list: vi.fn(async () => ({ data: [] })),
    },
    // the action sizes the refund against the expanded charge's captured amount
    paymentIntents: {
      retrieve: vi.fn(async () => ({
        latest_charge: { amount_captured: 500 },
      })),
    },
  },
}));

vi.mock("$/kit/queue", () => ({
  enqueue: vi.fn(),
}));

vi.mock("$/kit/slack", () => ({
  fiat_monitor: { send_alert: vi.fn() },
}));

vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);

vi.mock("remix-client-cache", () => ({
  CacheRoute: (C: any) => C,
  createClientLoaderCache: () => undefined,
}));

vi.mock("#/.server/toast", async () => {
  const { redirect } = await import("react-router");
  return {
    // the real helpers hand the payload back; the refund modal reads its `ok`
    dataWithSuccess: vi.fn((d: object | null, msg: string) => ({
      ...d,
      toast: msg,
    })),
    dataWithError: vi.fn((d: object | null, msg: string) => ({
      ...d,
      toast: msg,
    })),
    redirectWithSuccess: vi.fn((url: string, _msg: string) => redirect(url)),
  };
});

// --- imports (after mocks) ---

import { loader } from "#/routes/platform.donations/api";
import ListPage from "#/routes/platform.donations/route";
import {
  action as refund_action,
  loader as refund_loader,
} from "#/routes/platform.donations.$donation_id.refund/api";
import RefundPage from "#/routes/platform.donations.$donation_id.refund/route";
import { create_test_db } from "$/pg/test-utils/pglite";

// --- setup ---

const NPO_SEED: Omit<typeof npos.$inferInsert, "id"> = {
  registration_number: "EIN-REFUND-TEST",
  name: "Test NPO",
  endow_designation: "Charity",
  overview_pt: "[]",
  hq_country: "United States",
};

let counter = 0;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(donation_match_events);
  await test_db.current!.db.delete(rev_logs);
  await test_db.current!.db.delete(bal_txs);
  await test_db.current!.db.delete(dists);
  await test_db.current!.db.delete(donation_settlements);
  await test_db.current!.db.delete(donation_donors);
  await test_db.current!.db.delete(donation_recipients);
  await test_db.current!.db.delete(donation_takes);
  await test_db.current!.db.delete(donations);
  await test_db.current!.db.delete(npos);
  counter = 0;
});

// --- helpers ---

async function seed_npo(
  overrides: Partial<Omit<typeof npos.$inferInsert, "id">> = {}
) {
  counter++;
  const [row] = await test_db
    .current!.db.insert(npos)
    .values({
      ...NPO_SEED,
      registration_number: `EIN-R-${counter}`,
      ...overrides,
    })
    .returning();
  return row;
}

async function seed_donation(
  npo_id: number,
  npo_name: string,
  overrides?: {
    donation?: Partial<typeof donations.$inferInsert>;
    via?: string;
    company_name?: string;
    match?: Partial<typeof donation_match_events.$inferInsert>;
  }
) {
  counter++;
  const don_id = `don-${counter}`;
  const now = new Date().toISOString();

  await test_db.current!.db.insert(donations).values({
    id: don_id,
    upusd: 1,
    status: "settled",
    amount_base: 5,
    amount_tip: 0.75,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: overrides?.via ?? "stripe:card",
    created_at: now,
    updated_at: now,
    ...overrides?.donation,
  });

  await test_db.current!.db.insert(donation_recipients).values({
    donation_id: don_id,
    npo_id,
    name: npo_name,
    type: "npo",
    tip_allowed: true,
  });

  await test_db.current!.db.insert(donation_donors).values({
    donation_id: don_id,
    email: "donor@test.com",
    name: "Test Donor",
    company_name: overrides?.company_name,
  });

  if (overrides?.match) {
    await test_db.current!.db.insert(donation_match_events).values({
      id: `evt-${counter}`,
      donation_id: don_id,
      ...overrides.match,
    });
  }

  return don_id;
}

async function seed_dist(
  donation_id: string,
  npo_id: number,
  npo_name: string,
  overrides?: Partial<typeof dists.$inferInsert>
) {
  counter++;
  const dist_id = `dist-${counter}`;
  await test_db.current!.db.insert(dists).values({
    id: dist_id,
    donation_id,
    status: "settled",
    date_created: new Date().toISOString(),
    to_id: npo_id,
    to_name: npo_name,
    amount: 5,
    amount_usd: 5,
    amount_denom: "USD",
    net: 4.53,
    fee_base: 0.13,
    fee_fsa: 0,
    fee_processing: 0.34,
    fee_allowance: 0,
    fee_allowance_excess: 0,
    alloc: { liq: 100, lock: 0, cash: 0 },
    ...overrides,
  });
  return dist_id;
}

async function render_list(don_id?: string, search = "") {
  const Stub = createRoutesStub([
    {
      path: "/platform/refunds",
      Component: ListPage,
      HydrateFallback: () => null,
      loader,
      children: don_id
        ? [
            {
              path: ":donation_id/refund",
              Component: RefundPage,
              loader: refund_loader as any,
              action: refund_action as any,
            },
          ]
        : [],
    },
  ]);

  return await render(<Stub initialEntries={[`/platform/refunds${search}`]} />);
}

// --- tests ---

describe("refunds list — settled stripe donation", () => {
  it("shows donation, user clicks refund, confirms, sees success", async () => {
    const npo = await seed_npo({ liq: 100 });
    const don_id = await seed_donation(npo.id, npo.name);
    await seed_dist(don_id, npo.id, npo.name);
    // the payment the refund goes back through; without one the action refuses
    await test_db.current!.db.insert(donation_settlements).values({
      donation_id: don_id,
      sttl_id: `pi_${don_id}`,
      date: new Date().toISOString(),
      currency: "USD",
      net: 4.53,
      fee: 0.47,
    });

    await test_db.current!.db.insert(rev_logs).values({
      id: "rl-1",
      date: new Date().toISOString(),
      donation_id: `dist-${counter}`,
      npo_id: npo.id,
      type: "tip",
      gross: 0.75,
      commission: 0,
      revenue: 0.75,
      status: "final",
    });

    const screen = await render_list(don_id);

    // list renders with donation row
    await expect
      .element(screen.getByRole("heading", { name: /donations/i }))
      .toBeVisible();
    await expect.element(screen.getByText("Test NPO")).toBeInTheDocument();
    await expect
      .element(screen.getByText("donor@test.com"))
      .toBeInTheDocument();

    // refund link present for stripe donation
    const refund_link = screen.getByRole("link", { name: /refund/i });
    await expect.element(refund_link).toBeInTheDocument();

    // click refund → preview appears
    await refund_link.click();
    await expect
      .element(screen.getByRole("heading", { name: /refund preview/i }))
      .toBeVisible();

    // confirm refund (native click — the dialog overlay blocks playwright click)
    (
      screen
        .getByRole("button", { name: /confirm refund/i })
        .element() as HTMLElement
    ).click();
    await expect.element(screen.getByText("Refund processed")).toBeVisible();

    // after revalidation, list should show "Refunded" label
    await cleanup();
    // the default tab lists settled gifts only; the refunded one is on its tab
    const screen2 = await render_list(undefined, "?status=refunded");
    await expect
      .element(screen2.getByRole("cell", { name: "Refunded", exact: true }))
      .toBeVisible();
    await expect
      .element(screen2.getByRole("link", { name: /refund/i }))
      .not.toBeInTheDocument();
  });
});

describe("refunds list — non-stripe donation", () => {
  it("shows N/A instead of refund button for paypal donation", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, npo.name, { via: "paypal" });

    const screen = await render_list();

    await expect
      .element(screen.getByRole("heading", { name: /donations/i }))
      .toBeVisible();
    await expect.element(screen.getByText("Test NPO")).toBeInTheDocument();
    await expect.element(screen.getByText("N/A")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /refund/i }))
      .not.toBeInTheDocument();
  });
});

describe("refunds list — filtering", () => {
  const seed_three = async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, npo.name); // settled
    await seed_donation(npo.id, npo.name, {
      donation: { status: "refunded" },
    });
    await seed_donation(npo.id, npo.name, {
      donation: { status: "created" },
    });
  };

  it("lists settled donations only by default", async () => {
    await seed_three();

    const screen = await render_list();

    await expect
      .element(screen.getByRole("heading", { name: /donations/i }))
      .toBeVisible();
    // 1 header row + the settled donation
    await vi.waitFor(() =>
      expect(screen.getByRole("row").all()).toHaveLength(2)
    );
    await expect
      .element(screen.getByRole("link", { name: /refund/i }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("cell", { name: "Refunded", exact: true }))
      .not.toBeInTheDocument();
  });

  it("?status=refunded lists the refunded donation", async () => {
    await seed_three();

    const screen = await render_list(undefined, "?status=refunded");

    await vi.waitFor(() =>
      expect(screen.getByRole("row").all()).toHaveLength(2)
    );
    await expect
      .element(screen.getByRole("cell", { name: "Refunded", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /refund/i }))
      .not.toBeInTheDocument();
  });

  it("?status=unpaid lists the created donation", async () => {
    await seed_three();

    const screen = await render_list(undefined, "?status=unpaid");

    await vi.waitFor(() =>
      expect(screen.getByRole("row").all()).toHaveLength(2)
    );
    await expect
      .element(
        screen.getByRole("cell", { name: "Unpaid checkout", exact: true })
      )
      .toBeInTheDocument();
  });

  it("?status=all lists every status, each with its own tag", async () => {
    await seed_three();

    const screen = await render_list(undefined, "?status=all");

    // 1 header row + settled, refunded and created
    await vi.waitFor(() =>
      expect(screen.getByRole("row").all()).toHaveLength(4)
    );
    await expect
      .element(screen.getByRole("cell", { name: "Settled", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("cell", { name: "Refunded", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("cell", { name: "Unpaid checkout", exact: true })
      )
      .toBeInTheDocument();
    // Refund stays on the settled Stripe row alone
    expect(screen.getByRole("link", { name: /refund/i }).all()).toHaveLength(1);
  });
});

describe("donations list — the match column", () => {
  it("reads empty for a donation that never entered the workflow", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, npo.name);

    const screen = await render_list();

    await expect.element(screen.getByText("No employer")).toBeVisible();
  });

  it("shows the employer as typed, and the stamps in lifecycle order", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, npo.name, {
      company_name: "Acme Inc",
      match: {
        pack_sent_at: "2026-07-01T00:00:00.000Z",
        chased_at: "2026-07-04T00:00:00.000Z",
        submitted_at: "2026-07-05T00:00:00.000Z",
      },
    });

    const screen = await render_list();

    await expect.element(screen.getByText("Acme Inc")).toBeVisible();
    await expect
      .element(screen.getByText(/pack Jul 1 · chased Jul 4 · filed Jul 5/i))
      .toBeVisible();
  });

  it("surfaces a refused mail, which nothing else reads", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, npo.name, {
      company_name: "Acme Inc",
      match: {
        pack_sent_at: "2026-07-01T00:00:00.000Z",
        send_failed_at: "2026-07-01T00:00:01.000Z",
        send_failed_kind: "pack",
      },
    });

    const screen = await render_list();

    await expect.element(screen.getByText(/pack mail refused/i)).toBeVisible();
  });

  it("names the void reason on a refunded donation", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, npo.name, {
      donation: { status: "refunded_loss" },
      company_name: "Acme Inc",
      match: {
        pack_sent_at: "2026-07-01T00:00:00.000Z",
        voided_at: "2026-07-08T00:00:00.000Z",
        void_reason: "refunded_loss",
      },
    });

    const screen = await render_list(undefined, "?status=refunded");

    await expect
      .element(screen.getByText(/voided · refunded_loss/i))
      .toBeVisible();
  });

  it("offers no action — nothing about a match is ours to approve", async () => {
    const npo = await seed_npo();
    await seed_donation(npo.id, npo.name, {
      company_name: "Acme Inc",
      match: { pack_sent_at: "2026-07-01T00:00:00.000Z" },
    });

    const screen = await render_list();

    await expect
      .element(screen.getByRole("button", { name: /re-drive|verify/i }))
      .not.toBeInTheDocument();
  });
});

describe("refund action — already refunded", () => {
  it("rejects refund for already-refunded donation", async () => {
    const npo = await seed_npo();
    const don_id = await seed_donation(npo.id, npo.name, {
      donation: { status: "refunded" },
    });

    try {
      await (refund_action as (...args: unknown[]) => unknown)({
        params: { donation_id: don_id },
        request: new Request(`http://test/platform/refunds/${don_id}/refund`, {
          method: "POST",
        }),
        context: {},
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Response);
      expect((e as Response).status).toBe(400);
    }
  });
});
