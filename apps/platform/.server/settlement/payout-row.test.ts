// BGP-111: a settled dist with a grant part (`alloc.cash > 0`) that is not
// routed to a connected account must own a pending payout row, on every path
// that settles dists. a missing row could come from any one rail or from
// `settle_npo` itself, so each path is driven on its own.
//
// each path runs from its entry as far as node tests allow, on pglite:
//   provider webhook -> `don-sttl-dist` msg -> handle_don_sttl_dist ->
//   partition_destinations -> don_dist -> handle_npo -> settle_npo
// the queue is the one seam cut open: `enqueue` and `don_dist` capture what
// qstash would carry, and `drain` feeds it onward through a json round trip.
// not driven: `api.q-don-dist.$npo_id/route.ts` (its `verify_qstash` needs a
// signed qstash request), so `handle_npo`, the function it calls, stands in.

import { execFileSync } from "node:child_process";
import type { KeyObject } from "node:crypto";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { and, eq, isNull, notExists, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { seed_fund, seed_npo, seed_user } from "#/__tests__/fixtures/funds";
import type { IDonation } from "@/donations";
import type { IInput } from "@/types/donation-dist";
import type { DbOrTx } from "../pg/queries/helpers";
import type { TestDb } from "../pg/test-utils/pglite";

const holder = vi.hoisted(() => ({ current: null as TestDb | null }));
const flags = vi.hoisted(() => ({ routing: false }));
/** what `enqueue` was handed since the last drain */
const emitted = vi.hoisted(() => [] as { id: string; payload: any }[]);
/** the destinations `don_dist` was handed since the last drain */
const queued_dists = vi.hoisted(() => [] as any[]);
const usd_rates = vi.hoisted(
  () => ({ eth: 2000, usdc: 1 }) as Record<string, number>
);
const stripe_mock = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  paymentMethods: { retrieve: vi.fn() },
  invoicePayments: { list: vi.fn() },
}));
const paypal_mock = vi.hoisted(() => ({
  get_capture: vi.fn(),
}));
const chariot_mock = vi.hoisted(() => ({ get_grant: vi.fn() }));
const paypal_env = vi.hoisted(() => ({
  webhook_id: "wh-1",
  client_id: "c",
  client_secret: "s",
  api_url: "https://api-m.sandbox.paypal.com",
}));

vi.mock("#/errors/report", () => ({
  report_error: vi.fn(),
  report_degraded: vi.fn(),
  report_resp: (e: any) => new Response(e?.message ?? "error", { status: 500 }),
}));
vi.mock("@sentry/react-router", async (io) => ({
  ...(await io<typeof import("@sentry/react-router")>()),
  captureException: vi.fn(),
}));
vi.mock("../env", async (importOriginal) => {
  const real = await importOriginal<typeof import("../env")>();
  return {
    ...real,
    stage: "production",
    paypal: paypal_env,
    nowpayments: { ipn_secret: "ipn-secret", is_sandbox: false },
    chariot: { signing_key: "whsec-test" },
    stripe: {
      ...real.stripe,
      get connect_routing() {
        return flags.routing;
      },
    },
  };
});
vi.mock("../kit/stripe", () => ({ stripe: stripe_mock }));
vi.mock("../kit/paypal", () => ({ paypal: paypal_mock }));
vi.mock("../kit/chariot", () => ({ chariot: chariot_mock }));
vi.mock("../kit/nowpayments", () => ({
  np: {
    estimate: vi.fn(async (code: string) => ({
      usdpu: usd_rates[code.toLowerCase()],
    })),
    min_amount: vi.fn(async (code: string) => ({
      min: 0.001,
      min_usd: 0.001 * usd_rates[code.toLowerCase()]!,
    })),
  },
}));
vi.mock("../kit/queue", () => ({
  enqueue: vi.fn(async (...msgs: { id: string; payload: any }[]) => {
    emitted.push(...msgs);
  }),
  schedule: vi.fn(),
  don_dist: vi.fn(async (dests: any[]) => {
    queued_dists.push(...dests);
  }),
}));
vi.mock("../kit/slack", () => ({
  aws_monitor: { send_alert: vi.fn(async () => {}) },
  fiat_monitor: { send_alert: vi.fn(async () => {}) },
}));
vi.mock("../email", () => ({ send_email: vi.fn(async () => ({})) }));
vi.mock("../pg/db", () => ({
  db: new Proxy(
    {},
    {
      get(_, prop) {
        const real = holder.current?.db;
        if (!real) throw new Error("test_db not initialized");
        return (real as any)[prop];
      },
    }
  ),
}));

const { settle_npo, settle_unrouted } = await import("./settle-npo");
const { handle_don_sttl_dist } = await import(
  "#/routes/api.q-handler.$event/handle-don-sttl-dist"
);
const { handle_npo } = await import("#/routes/api.q-don-dist.$npo_id/npo");
const { action: stripe_action } = await import(
  "#/routes/api.stripe-webhook/route"
);
const { action: paypal_action } = await import(
  "#/routes/api.paypal-webhook/route"
);
const { action: np_action } = await import(
  "#/routes/api.nowpayments-webhook/route"
);
const { action: chariot_action } = await import("#/routes/api.chariot-webhook");
const { action: manual_settle } = await import(
  "#/routes/platform.donation-settlements.create/api"
);
const { donation_put } = await import("../pg/queries/donation");
const { create_test_db } = await import("../pg/test-utils/pglite");
const { dists } = await import("../pg/schema/dist");
const { payouts } = await import("../pg/schema/payout");
const { npos } = await import("../pg/schema/npo");
const { subscriptions } = await import("../pg/schema/subscription");
const { donation_settlements } = await import("../pg/schema/donation");

const db = () => holder.current!.db;

// --- the invariant ---------------------------------------------------------

/** settled dists with a grant part, not routed, that own no payout: the
 * defect BGP-111 found in production. a routed dist is paid by its transfer */
const dists_missing_payout = () =>
  db()
    .select({ id: dists.id })
    .from(dists)
    .where(
      and(
        eq(dists.status, "settled"),
        sql`(${dists.alloc}->>'cash')::numeric > 0`,
        isNull(dists.stripe_routed_to),
        notExists(
          db()
            .select({ one: sql`1` })
            .from(payouts)
            .where(eq(payouts.source_id, dists.id))
        )
      )
    );

// --- seeds -----------------------------------------------------------------

const CASH = 60;
const ALLOCATION = { cash: CASH, liq: 40, lock: 0 };
const NOW = "2026-01-01T00:00:00.000Z";

let npo_id: number;

beforeAll(async () => {
  holder.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await holder.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  flags.routing = false;
  emitted.length = 0;
  queued_dists.length = 0;
  await db().execute(
    sql`truncate table npos, donations, "user", funds, subscriptions, nav_logs cascade`
  );
  const npo = await seed_npo(db(), {
    registration_number: "EIN-PAYOUT-ROW",
    name: "Payout Row NPO",
    published: true,
    allocation: ALLOCATION,
  });
  npo_id = npo!.id;
});

/** a donation as its checkout recorded it; `o` overrides any field */
const seed_gift = (o: Partial<IDonation> & { id: string }) =>
  donation_put(
    db() as any,
    {
      upusd: 1,
      status: "confirmed",
      amount: { base: 100, tip: 0, fee_allowance: 0 },
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "stripe:card",
      to_id: String(npo_id),
      to_name: "Payout Row NPO",
      to_type: "npo",
      to_tip_allowed: false,
      to_members: [],
      from_email: "donor@test.com",
      from_name: "Jane Donor",
      created_at: NOW,
      updated_at: NOW,
      ...o,
    } as any
  );

const seed_subscription = (id: string) =>
  db().insert(subscriptions).values({
    id,
    interval: "month",
    interval_count: 1,
    next_billing: "2026-02-01T00:00:00.000Z",
    amount: 100,
    amount_usd: 100,
    currency: "USD",
    product_id: "prod_1",
    to_npo_id: npo_id,
    to_name: "Payout Row NPO",
    platform: "stripe",
    status: "active",
    from_id: "donor@test.com",
    created_at: "2025-12-01T00:00:00.000Z",
    updated_at: "2025-12-01T00:00:00.000Z",
  });

// --- the queue, from the settle message onward ------------------------------

const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** carries every `don-sttl-dist` the entry enqueued down to `settle_npo`, as
 * qstash would: through json, one `handle_npo` per destination */
async function drain() {
  const sttl = emitted.splice(0).filter((m) => m.id === "don-sttl-dist");
  for (const m of sttl) await handle_don_sttl_dist(wire(m.payload));
  for (const d of queued_dists.splice(0)) await handle_npo(wire(d));
}

// --- the rails' entries ------------------------------------------------------

const STRIPE_CHARGED_AT = 1767300000;
const stripe_deliver = async (intent: Record<string, unknown>) => {
  stripe_mock.webhooks.constructEvent.mockImplementation((b: string) =>
    JSON.parse(b)
  );
  stripe_mock.paymentIntents.retrieve.mockResolvedValue({
    latest_charge: {
      created: STRIPE_CHARGED_AT,
      balance_transaction: { net: 9500, fee: 500 },
    },
  });
  stripe_mock.paymentMethods.retrieve.mockResolvedValue({ type: "card" });
  const body = JSON.stringify({
    type: "payment_intent.succeeded",
    data: {
      object: {
        created: 1767225600,
        payment_method: "pm_1",
        ...intent,
      },
    },
  });
  const res = await stripe_action({
    request: new Request("http://localhost/api/stripe-webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body,
    }),
  } as any);
  expect(res.status).toBe(200);
};

const stripe_invoice = (order_id: string, subs_id: string) =>
  stripe_mock.invoicePayments.list.mockResolvedValue({
    data: [
      {
        invoice: {
          created: 1767225600,
          deleted: false,
          parent: {
            subscription_details: {
              metadata: { order_id },
              subscription: subs_id,
            },
          },
        },
      },
    ],
  });

const np_deliver = async (payload: Record<string, unknown>) => {
  const sort_deep = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort_deep)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort_deep((v as any)[k])])
          )
        : v;
  const sig = createHmac("sha512", "ipn-secret")
    .update(JSON.stringify(sort_deep(payload)))
    .digest("hex");
  const res = (await np_action({
    request: new Request("https://x/api/nowpayments-webhook", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "x-nowpayments-sig": sig },
    }),
  } as any)) as Response;
  expect(res.status).toBe(200);
};

const np_payment = (o: Record<string, unknown> = {}) => ({
  payment_id: 5001,
  parent_payment_id: null,
  invoice_id: 9,
  order_id: "don-np",
  payment_status: "finished",
  pay_amount: 0.5,
  pay_currency: "eth",
  actually_paid: 0.5,
  actually_paid_at_fiat: 1000,
  outcome_amount: 990,
  outcome_currency: "usdc",
  fee: { currency: "usdc", depositFee: 1, serviceFee: 4, withdrawalFee: 5 },
  ...o,
});

interface ISigner {
  key: KeyObject;
  pem: string;
}

/** paypal's webhook is verified against a cert fetched from `cert_url`: a
 * self-signed one, issued by the openssl cli, stands in for paypal's */
const self_signed = (): ISigner => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const dir = mkdtempSync(join(tmpdir(), "payout-row-paypal-"));
  try {
    const key_file = join(dir, "key.pem");
    writeFileSync(
      key_file,
      privateKey.export({ type: "pkcs8", format: "pem" }) as string
    );
    const pem = execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-x509",
        "-key",
        key_file,
        "-subj",
        "/O=PayPal, Inc./CN=messageverificationcerts.sandbox.paypal.com",
        "-days",
        "2",
      ],
      { encoding: "utf8" }
    );
    return { key: privateKey, pem };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

let PAYPAL: ISigner;
const PAYPAL_CERT_URL =
  "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1";

const paypal_deliver = async (ev: Record<string, unknown>) => {
  const body = JSON.stringify(ev);
  const id = "t-1";
  const time = "2026-01-01T00:00:00Z";
  const message = [id, time, "wh-1", crc32(body)].join("|");
  const res = (await paypal_action({
    request: new Request("https://x/api/paypal-webhook", {
      method: "POST",
      body,
      headers: {
        "paypal-transmission-id": id,
        "paypal-transmission-time": time,
        "paypal-cert-url": PAYPAL_CERT_URL,
        "paypal-transmission-sig": createSign("SHA256")
          .update(message)
          .sign(PAYPAL.key, "base64"),
      },
    }),
  } as any)) as Response;
  expect(res.status).toBe(200);
};

const CHARIOT_T = "2026-09-23T00:00:00.000Z";
const chariot_deliver = async (ev: Record<string, unknown>) => {
  const body = JSON.stringify(ev);
  const v1 = createHmac("sha256", "whsec-test")
    .update(`${CHARIOT_T}.${body}`)
    .digest("hex");
  const res = await chariot_action({
    request: new Request("https://x/api/chariot-webhook", {
      method: "POST",
      body,
      headers: { "chariot-webhook-signature": `t=${CHARIOT_T},v1=${v1}` },
    }),
  } as any);
  expect(res.status).toBe(200);
};

const manual_form = (o: Record<string, string>) => {
  const fd = new FormData();
  const fields = {
    npo_id: String(npo_id),
    net: "100",
    reference: "ref-1",
    idempotency_key: crypto.randomUUID(),
    ...o,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("https://x/platform/donation-settlements/create", {
    method: "POST",
    body: fd,
  });
};

// --- paths ------------------------------------------------------------------

/** a path settles its gift and returns how many dists it must have written */
type TPath = () => Promise<number>;

const stripe_one_time: TPath = async () => {
  await seed_gift({ id: "don-1" });
  await stripe_deliver({ id: "pi_1", metadata: { order_id: "don-1" } });
  await drain();
  return 1;
};

const stripe_first_recurring: TPath = async () => {
  await seed_subscription("sub_1");
  await seed_gift({ id: "don-1", frequency: "monthly" });
  stripe_invoice("don-1", "sub_1");
  await stripe_deliver({ id: "pi_1", metadata: {} });
  await drain();
  return 1;
};

const stripe_rebill: TPath = async () => {
  // the subscription's first charge settled in December; January's invoice is the rebill
  await seed_subscription("sub_1");
  await seed_gift({
    id: "don-1",
    frequency: "monthly",
    status: "settled",
    subscription_id: "sub_1",
  });
  await db().insert(donation_settlements).values({
    donation_id: "don-1",
    sttl_id: "pi_first",
    date: "2025-12-01T00:00:00.000Z",
    currency: "USD",
    net: 95,
    fee: 5,
  });
  stripe_invoice("don-1", "sub_1");
  await stripe_deliver({ id: "pi_rebill", metadata: {} });
  await drain();
  return 1;
};

const paypal_capture: TPath = async () => {
  await seed_gift({ id: "don-pp", via: "paypal", status: "intent" });
  paypal_mock.get_capture.mockResolvedValue({
    id: "capture-1",
    status: "COMPLETED",
    amount: { value: "100.00", currency_code: "USD" },
    create_time: "2026-01-02T00:00:00.000Z",
    custom_id: "don-pp",
    seller_receivable_breakdown: {
      gross_amount: { value: "100", currency_code: "USD" },
      net_amount: { value: "96.5", currency_code: "USD" },
      paypal_fee: { value: "3.5", currency_code: "USD" },
    },
  });
  await paypal_deliver({
    id: "WH-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "capture-1",
      create_time: "2026-01-02T00:00:00.000Z",
      custom_id: "don-pp",
    },
  });
  await drain();
  return 1;
};

const seed_np_gift = () =>
  seed_gift({
    id: "don-np",
    via: "crypto:eth",
    via_extra: "5001",
    upusd: 1 / 2000,
    amount: { base: 0.5, tip: 0, fee_allowance: 0 },
    currency: "ETH",
    source: "bg-widget",
  });

const nowpayments_settled: TPath = async () => {
  await seed_np_gift();
  await np_deliver(np_payment());
  await drain();
  return 1;
};

const nowpayments_repeat: TPath = async () => {
  await seed_np_gift();
  await np_deliver(np_payment());
  // a second deposit to the order's address: its own donation, its own dist
  await np_deliver(
    np_payment({
      payment_id: 5002,
      parent_payment_id: 5001,
      actually_paid: 0.2,
      outcome_amount: 396,
    })
  );
  await drain();
  return 2;
};

const chariot_daf: TPath = async () => {
  await seed_gift({
    id: "don-daf",
    via: "chariot",
    via_extra: "grant-1",
    status: "intent",
  });
  chariot_mock.get_grant.mockResolvedValue({
    id: "grant-1",
    status: "Completed",
    amount: 10_000,
    feeDetail: { total: 300 },
    metadata: { don_id: "don-daf" },
  });
  await chariot_deliver({
    id: "ev-1",
    category: "grant.updated",
    associated_object_type: "grant",
    associated_object_id: "grant-1",
  });
  await drain();
  return 1;
};

/** the admin form settles through `settle_npo` itself, with no queue hop */
const manual =
  (from: string): TPath =>
  async () => {
    const res = await manual_settle({ request: manual_form({ from }) } as any);
    expect(res).toEqual({ ok: true });
    return 1;
  };

const fund_gift: TPath = async () => {
  const second = await seed_npo(db(), {
    registration_number: "EIN-PAYOUT-ROW-2",
    name: "Payout Row NPO 2",
    published: true,
    allocation: ALLOCATION,
  });
  const creator = await seed_user(db(), "fund-owner@test.com");
  const fund = await seed_fund(db(), {
    id: "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4",
    npo_owner: null,
    creator_id: creator!.id,
    members: [npo_id, second!.id],
  });
  await seed_gift({
    id: "don-fund",
    to_id: fund.id,
    to_name: "Test Fund",
    to_type: "fund",
    to_members: [String(npo_id), String(second!.id)],
  });
  await stripe_deliver({ id: "pi_1", metadata: { order_id: "don-fund" } });
  await drain();
  return 2;
};

const PATHS: [string, TPath][] = [
  ["pooled one-time gift (stripe)", stripe_one_time],
  ["recurring first charge (stripe)", stripe_first_recurring],
  ["rebill / invoice repeat (stripe)", stripe_rebill],
  ["paypal capture", paypal_capture],
  ["nowpayments finished payment", nowpayments_settled],
  ["nowpayments repeated deposit", nowpayments_repeat],
  ["chariot daf grant", chariot_daf],
  ["admin manual settle: cheque", manual("cheque")],
  ["admin manual settle: daf", manual("daf")],
  ["admin manual settle: stocks", manual("stocks")],
  ["admin manual settle: match naming no donation", manual("match")],
  ["fund gift fan-out, one settle_npo per member", fund_gift],
];

beforeAll(() => {
  PAYPAL = self_signed();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(PAYPAL.pem))
  );
}, 30_000);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("a dist with a grant part owns its pending payout", () => {
  it.each(PATHS)("%s", async (_name, path) => {
    const expected = await path();

    const rows = await db().select().from(dists);
    expect(rows).toHaveLength(expected);
    const pays = await db().select().from(payouts);
    expect(pays).toHaveLength(expected);
    for (const d of rows) {
      expect(d.stripe_routed_to).toBeNull();
      expect(d.alloc).toEqual(ALLOCATION);
      expect(d.net).toBeGreaterThan(0);
      const own = pays.filter((p) => p.source_id === d.id);
      expect(own).toHaveLength(1);
      expect(own[0]).toMatchObject({
        npo_id: d.to_id,
        source: "donation",
        type: "pending",
      });
      // the grant share of net: the rest of it went to the npo's liquid balance
      expect(own[0]!.amount).toBeCloseTo((d.net! * CASH) / 100, 6);
    }
    expect(await dists_missing_payout()).toEqual([]);
  });

  it("flags a dist whose payout is gone, so the sweep above can fail", async () => {
    await stripe_one_time();
    expect(await dists_missing_payout()).toEqual([]);

    await db().delete(payouts);

    const [dist] = await db().select().from(dists);
    expect(await dists_missing_payout()).toEqual([{ id: dist!.id }]);
  });
});

describe("a dist with no grant part", () => {
  it("makes no payout, and the invariant leaves it alone", async () => {
    await db()
      .update(npos)
      .set({ allocation: { cash: 0, liq: 100, lock: 0 } })
      .where(eq(npos.id, npo_id));

    await stripe_one_time();

    const [dist] = await db().select().from(dists);
    expect(dist!.alloc).toEqual({ cash: 0, liq: 100, lock: 0 });
    expect(await db().select().from(payouts)).toEqual([]);
    // it booked the whole net to the liquid balance instead
    const [npo] = await db().select().from(npos).where(eq(npos.id, npo_id));
    expect(npo!.liq).toBeCloseTo(dist!.net!, 6);
    expect(await dists_missing_payout()).toEqual([]);
  });
});

describe("a dist routed to a connected account", () => {
  const ACCT = "acct_payout_row";

  it("has no payout until its refused transfer is rebooked, then has one", async () => {
    flags.routing = true;
    await db()
      .update(npos)
      .set({
        stripe_account_id: ACCT,
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
        stripe_details_submitted: true,
        stripe_requirements_due: [],
      })
      .where(eq(npos.id, npo_id));

    await stripe_one_time();

    const [routed] = await db().select().from(dists);
    expect(routed).toMatchObject({
      stripe_routed_to: ACCT,
      alloc: { cash: 100, liq: 0, lock: 0 },
    });
    expect(await db().select().from(payouts)).toEqual([]);
    // a routed dist's grant part is paid by its transfer, not by a payout row
    expect(await dists_missing_payout()).toEqual([]);

    const r = await db().transaction((tx) =>
      settle_unrouted(tx as unknown as DbOrTx, {
        id: routed!.id,
        donation_id: routed!.donation_id,
        to_id: npo_id,
        net: routed!.net!,
        settled_net: routed!.net!,
        refunds_cut_share: null,
        date_created: routed!.date_created,
      })
    );

    expect(r.status).toBe("booked");
    const [pay] = await db().select().from(payouts);
    expect(pay).toMatchObject({
      source_id: routed!.id,
      npo_id,
      type: "pending",
    });
    expect(pay!.amount).toBeCloseTo((routed!.net! * CASH) / 100, 6);
    expect(await dists_missing_payout()).toEqual([]);
  });
});

describe("settle_npo on its own", () => {
  it("writes the dist and its payout in one transaction", async () => {
    await seed_gift({ id: "don-tx" });
    await stripe_deliver({ id: "pi_tx", metadata: { order_id: "don-tx" } });
    const [sttl] = emitted.filter((m) => m.id === "don-sttl-dist");
    await handle_don_sttl_dist(wire(sttl!.payload));
    const input: IInput = wire(queued_dists[0]);

    // pglite is one connection: a payout written on the module db instead of
    // the tx would hang this test, and one that survived would outlive the rollback
    const rollback = new Error("rollback");
    await expect(
      db().transaction(async (tx) => {
        await settle_npo(tx as unknown as DbOrTx, input);
        expect(await tx.select().from(payouts)).toHaveLength(1);
        throw rollback;
      })
    ).rejects.toBe(rollback);

    expect(await db().select().from(dists)).toEqual([]);
    expect(await db().select().from(payouts)).toEqual([]);
  });
});
