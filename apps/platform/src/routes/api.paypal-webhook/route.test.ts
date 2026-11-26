// the "two deliveries race" tests run on pglite, a single connection: two
// db.transaction() calls queue rather than overlap. they prove the guard reads
// committed state under the tx, not that the order row's lock contends.

import { execFileSync } from "node:child_process";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { crc32 } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DbOrTx } from "$/pg/queries/helpers";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const enqueue_mock = vi.hoisted(() => vi.fn());
const report_error_mock = vi.hoisted(() => vi.fn());
const report_degraded_mock = vi.hoisted(() => vi.fn());
const sentry_capture_mock = vi.hoisted(() => vi.fn());
const get_order_mock = vi.hoisted(() => vi.fn());
const get_subscription_mock = vi.hoisted(() => vi.fn());
const get_plan_mock = vi.hoisted(() => vi.fn());
const capture_order_mock = vi.hoisted(() => vi.fn());
const schedule_mock = vi.hoisted(() => vi.fn());
const send_alert_mock = vi.hoisted(() => vi.fn());
const reverse_charge_mock = vi.hoisted(() => vi.fn());
const get_capture_mock = vi.hoisted(() => vi.fn());
const get_sale_mock = vi.hoisted(() => vi.fn());
/** runs on the lock's own tx just before it is taken — a write that commits
 * between the handler's first read and the lock */
const before_lock = vi.hoisted(() => ({
  current: null as null | ((tx: any, id: string) => Promise<void>),
}));

vi.mock("#/errors/report", () => ({
  report_error: report_error_mock,
  report_degraded: report_degraded_mock,
  report_resp: (e: any) => new Response(e?.message ?? "error", { status: 500 }),
}));
vi.mock("@sentry/react-router", async (io) => ({
  ...(await io<typeof import("@sentry/react-router")>()),
  captureException: sentry_capture_mock,
}));
/** read by the route once, at import — a change reaches only a fresh import */
const paypal_env = vi.hoisted(() => ({
  webhook_id: "wh-1",
  client_id: "c",
  client_secret: "s",
  api_url: "https://api-m.sandbox.paypal.com",
}));
vi.mock("$/env", () => ({
  paypal: paypal_env,
  stage: "production",
  base_url: "https://www.better.giving",
}));
vi.mock("$/kit/paypal", () => ({
  paypal: {
    get_order: get_order_mock,
    get_subscription: get_subscription_mock,
    get_plan: get_plan_mock,
    capture_order: capture_order_mock,
    get_capture: get_capture_mock,
    get_sale: get_sale_mock,
  },
}));
vi.mock("$/kit/queue", () => ({
  enqueue: enqueue_mock,
  schedule: schedule_mock,
}));
// the reversal is `reverse.test.ts`'s ground; here it is the boundary, which
// a block sizing a share on pglite hands back to the real entry
vi.mock("$/refund/reverse", async (io) => ({
  ...(await io<typeof import("$/refund/reverse")>()),
  reverse_charge: reverse_charge_mock,
}));
vi.mock("$/kit/slack", () => ({
  fiat_monitor: { send_alert: send_alert_mock },
}));
vi.mock("$/pg/queries/donation", async (io) => {
  const actual = await io<typeof import("$/pg/queries/donation")>();
  return {
    ...actual,
    donation_settle_state_locked: async (tx: any, id: string) => {
      await before_lock.current?.(tx, id);
      return actual.donation_settle_state_locked(tx, id);
    },
  };
});
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

const { action } = await import("./route");
const { PayPalApiError } = await import("@better-giving/paypal");
const { report_error: real_report_error } =
  await vi.importActual<typeof import("#/errors/report")>("#/errors/report");
const { donation_get, donation_put, donation_update } = await import(
  "$/pg/queries/donation"
);
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { dists } = await import("$/pg/schema/dist");
const {
  donation_donors,
  donation_recipients,
  donation_settlements,
  donations,
} = await import("$/pg/schema/donation");
const { npos } = await import("$/pg/schema/npo");
const { user } = await import("$/pg/schema/auth");
const { campaign_members, campaigns } = await import("$/pg/schema/campaign");
const { PLACEHOLDER_EMAIL } = await import("@/donations/schema");
const { subscriptions } = await import("$/pg/schema/subscription");
const { owed_amounts, owed_entries } = await import("$/pg/schema/owed");
const { owed_for_donation } = await import("$/pg/queries/owed");
const { loss_log_list } = await import("$/pg/queries/revenue");
const { takes_of } = await import("$/pg/queries/take");
const { taken_of } = await import("$/refund/takes");
const { payouts } = await import("$/pg/schema/payout");
const { reverse_charge: real_reverse_charge } =
  await vi.importActual<typeof import("$/refund/reverse")>("$/refund/reverse");
const { donation_disputes } = await import("$/pg/schema/dispute");
const { donation_takes } = await import("$/pg/schema/take");
const { bal_txs } = await import("$/pg/schema/bal-tx");
const { loss_logs } = await import("$/pg/schema/revenue");
const { balance_of, disputes_of, PAID_GRANT, seed_card_gift } = await import(
  "#/__tests__/fixtures/card-gift"
);

const db = () => test_db.current!.db;

const ORDER_ID = "don-pp-1";
const CAPTURE_ID = "capture-1";
const SALE_ID = "sale-1";
const SUBS_ID = "I-SUBS-1";
const CAPTURE_EV_ID = "WH-CAPTURE-1";

interface ISigner {
  key: KeyObject;
  pem: string;
}

/** a key pair and a self-signed cert for it, via the openssl cli — node can
 * parse an X.509 cert but not issue one */
const self_signed = (
  subject: string,
  type: "rsa" | "ed25519" = "rsa"
): ISigner => {
  const { privateKey } =
    type === "rsa"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : generateKeyPairSync("ed25519");
  const dir = mkdtempSync(join(tmpdir(), "paypal-webhook-test-"));
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
        subject,
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

// issued in beforeAll, under its 30s timeout: rsa keygen + openssl are slow
let PAYPAL: ISigner;
/** holds a cert whose subject claims to be paypal's — only the url stops it */
let IMPOSTOR: ISigner;
/** a well-formed cert that is not paypal's signing cert */
let STRANGER: ISigner;
/** paypal's subject on a key type the route's sha256 verifier cannot use */
let ED25519: ISigner;

const CERT_URL =
  "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d";
/** the fetch stub serves IMPOSTOR's cert here, PAYPAL's everywhere else */
const IMPOSTOR_CERT_URL =
  "https://attacker.example/v1/notifications/certs/CERT-1";

/** `headers` overrides the defaults; a null drops that header. the body is
 * signed over the final headers, as paypal does, with `signer`'s key; a string
 * `ev` is sent as the raw body */
const deliver = (
  ev: Record<string, unknown> | string,
  headers: Record<string, string | null> = {},
  signer: ISigner = PAYPAL,
  route: typeof action = action
) => {
  const body = typeof ev === "string" ? ev : JSON.stringify(ev);
  const unsigned: Record<string, string | null> = {
    "paypal-transmission-id": "t-1",
    "paypal-transmission-time": "2026-01-01T00:00:00Z",
    "paypal-cert-url": CERT_URL,
    ...headers,
  };
  const message = [
    unsigned["paypal-transmission-id"],
    unsigned["paypal-transmission-time"],
    "wh-1",
    crc32(body),
  ].join("|");
  const merged = {
    "paypal-transmission-sig": createSign("SHA256")
      .update(message)
      .sign(signer.key, "base64"),
    ...unsigned,
  };
  return route({
    request: new Request("https://x/api/paypal-webhook", {
      method: "POST",
      body,
      headers: Object.entries(merged).filter(
        (e): e is [string, string] => e[1] !== null
      ),
    }),
  } as any) as Promise<Response>;
};

/** paypal's own copy of the capture — what the route settles from */
const capture_copy = () => ({
  id: CAPTURE_ID,
  status: "COMPLETED",
  amount: { value: "100.00", currency_code: "USD" },
  create_time: "2026-01-02T00:00:00.000Z",
  custom_id: ORDER_ID,
  seller_receivable_breakdown: {
    gross_amount: { value: "100", currency_code: "USD" },
    net_amount: { value: "96.5", currency_code: "USD" },
    paypal_fee: { value: "3.5", currency_code: "USD" },
  },
});

/** the event announcing it. its amounts are decoys that disagree with
 * paypal's copy, so a settle read off the event body fails every assertion */
const capture_ev = () => ({
  id: CAPTURE_EV_ID,
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: {
    id: CAPTURE_ID,
    create_time: "2026-01-02T00:00:00.000Z",
    custom_id: ORDER_ID,
    seller_receivable_breakdown: {
      gross_amount: { value: "1", currency_code: "USD" },
      net_amount: { value: "1", currency_code: "USD" },
      paypal_fee: { value: "0", currency_code: "USD" },
    },
  },
});

/** delivers the capture event with `copy` as paypal's copy of the capture */
const deliver_capture = (copy: object) => {
  get_capture_mock.mockResolvedValue(copy);
  return deliver(capture_ev());
};

/** paypal's own copy of the sale */
const sale_copy = () => ({
  id: SALE_ID,
  state: "completed",
  create_time: "2026-01-02T00:00:00.000Z",
  billing_agreement_id: SUBS_ID,
  transaction_fee: { value: "3.5" },
  amount: { total: "100", currency: "USD" },
});

/** the event announcing it, with decoy amounts as for a capture */
const sale_ev = () => ({
  event_type: "PAYMENT.SALE.COMPLETED",
  resource: {
    id: SALE_ID,
    create_time: "2026-01-02T00:00:00.000Z",
    billing_agreement_id: SUBS_ID,
    transaction_fee: { value: "0" },
    amount: { total: "1", currency: "USD" },
  },
});

let npo_id: number;

const seed_donation = async (o: Record<string, unknown> = {}) => {
  const now = "2026-01-01T00:00:00.000Z";
  await donation_put(
    db() as any,
    {
      id: ORDER_ID,
      upusd: 1,
      status: "intent",
      amount: { base: 100, tip: 0, fee_allowance: 0 },
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via: "paypal",
      to_id: npo_id.toString(),
      to_name: "PP Test NPO",
      to_type: "npo",
      to_tip_allowed: false,
      to_members: [],
      from_email: "donor@test.com",
      from_name: "Jane Donor",
      created_at: now,
      updated_at: now,
      ...o,
    } as any
  );
};

/** the row `settle_npo` inserts once a settle's distribution message lands */
const seed_dist = async (donation_id: string) => {
  await db()
    .insert(dists)
    .values({
      id: `dist-${donation_id}`,
      donation_id,
      status: "settled",
      date_created: "2026-01-02T00:00:00.000Z",
      to_id: npo_id,
      amount_denom: "USD",
      net: 96.5,
    });
};

const settlements = () => db().select().from(donation_settlements);
/** the queue's dedupe keys of the nth enqueue — what makes a re-send a no-op */
const dedupes = (nth: number): string[] =>
  enqueue_mock.mock.calls.at(nth)!.map((m: any) => m.dedupe);
const all_kinds = () =>
  enqueue_mock.mock.calls.flat().map((m: any) => m.id as string);

beforeAll(async () => {
  test_db.current = await create_test_db();
  PAYPAL = self_signed(
    "/O=PayPal, Inc./CN=messageverificationcerts.sandbox.paypal.com"
  );
  IMPOSTOR = self_signed(
    "/O=PayPal, Inc./CN=messageverificationcerts.sandbox.paypal.com"
  );
  STRANGER = self_signed("/CN=certs.example.com");
  ED25519 = self_signed(
    "/O=PayPal, Inc./CN=messageverificationcerts.sandbox.paypal.com",
    "ed25519"
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string | URL) =>
        new Response(
          String(url) === IMPOSTOR_CERT_URL ? IMPOSTOR.pem : PAYPAL.pem
        )
    )
  );
}, 30_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  before_lock.current = null;
  enqueue_mock.mockResolvedValue(undefined);
  schedule_mock.mockResolvedValue(undefined);
  // what a reversal answers is each test's to say; the blocks on the real
  // entry judge the outcome
  reverse_charge_mock.mockResolvedValue({
    status: "reversed",
    dists: 1,
    applied: 1,
    owed_msgs: [],
    has_loss: false,
  });
  get_capture_mock.mockImplementation(async (id: string) => ({
    ...capture_copy(),
    id,
  }));
  get_sale_mock.mockImplementation(async (id: string) => ({
    ...sale_copy(),
    id,
  }));
  get_subscription_mock.mockResolvedValue({
    id: SUBS_ID,
    plan_id: "P-1",
    status: "ACTIVE",
    custom_id: ORDER_ID,
    create_time: "2026-01-01T00:00:00.000Z",
    update_time: "2026-01-01T00:00:00.000Z",
    subscriber: { email_address: "donor@test.com", name: { given_name: "J" } },
    billing_info: { next_billing_time: "2026-02-01T00:00:00.000Z" },
  });
  get_plan_mock.mockResolvedValue({
    id: "P-1",
    product_id: "PROD-1",
    billing_cycles: [
      { frequency: { interval_unit: "MONTH", interval_count: 1 } },
    ],
  });

  await db().delete(owed_amounts);
  await db().delete(bal_txs);
  await db().delete(loss_logs);
  await db().delete(donation_disputes);
  await db().delete(donation_takes);
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donation_settlements);
  await db().delete(donation_donors);
  await db().delete(donation_recipients);
  await db().delete(donations);
  await db().delete(subscriptions);
  await db().delete(campaign_members);
  await db().delete(campaigns);
  await db().delete(npos);
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-PP-TEST",
      name: "PP Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: true,
      active: true,
      allocation: { liq: 0, lock: 0, cash: 100 },
    })
    .returning();
  npo_id = npo!.id;
});

describe("PAYMENT.CAPTURE.COMPLETED", () => {
  it("settles one capture once when two deliveries race", async () => {
    await seed_donation();

    const [a, b] = await Promise.all([
      deliver(capture_ev()),
      deliver(capture_ev()),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    const bodies = [await a.text(), await b.text()];
    expect(bodies.filter((t) => t === "already processed")).toHaveLength(1);

    expect(await settlements()).toHaveLength(1);
    const don = await donation_get(ORDER_ID);
    expect(don!.status).toBe("settled");
    expect(don!.settlement!.id).toBe(CAPTURE_ID);
    // the loser recomputes the winner's messages — same dedupe keys, so qstash
    // drops the repeat
    expect(dedupes(1)).toEqual(dedupes(0));
    expect(all_kinds()).toEqual([
      "don-sttl-dist",
      "don-sttl-receipt",
      "don-sttl-dist",
      "don-sttl-receipt",
    ]);
  });

  it("re-queues a settled capture's messages on redelivery", async () => {
    await seed_donation();
    await deliver(capture_ev());
    enqueue_mock.mockClear();

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    expect(enqueue_mock).toHaveBeenCalledOnce();
    expect(all_kinds()).toEqual(["don-sttl-dist", "don-sttl-receipt"]);
  });

  it("leaves a donation refunded before the lock unsettled", async () => {
    await seed_donation();
    before_lock.current = async (tx, id) => {
      await donation_update(tx, id, { status: "refunded" });
    };

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    expect(await settlements()).toHaveLength(0);
    expect((await donation_get(ORDER_ID))!.status).toBe("refunded");
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("acknowledges a redelivered capture of a donation refunded since it settled, settling and queuing nothing more", async () => {
    await seed_donation();
    await deliver(capture_ev());
    await donation_update(db() as any, ORDER_ID, { status: "refunded" });
    enqueue_mock.mockClear();

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    expect(await settlements()).toHaveLength(1);
    expect((await donation_get(ORDER_ID))!.status).toBe("refunded");
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("re-queues the receipt when the distribution landed and it did not", async () => {
    await seed_donation();
    await deliver(capture_ev());
    await seed_dist(ORDER_ID);
    enqueue_mock.mockClear();

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    expect(all_kinds()).toContain("don-sttl-receipt");
  });

  it("settles a capture paypal charged no fee at its gross", async () => {
    await seed_donation();
    const resource = {
      ...capture_copy(),
      seller_receivable_breakdown: {
        gross_amount: { value: "100", currency_code: "USD" },
      },
    };

    const res = await deliver_capture(resource);

    expect(res.status).toBe(200);
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(await settlements()).toEqual([
      expect.objectContaining({ sttl_id: CAPTURE_ID, net: 100, fee: 0 }),
    ]);
  });

  it("takes platform fees out of a net paypal left off the capture", async () => {
    await seed_donation();
    const resource = {
      ...capture_copy(),
      seller_receivable_breakdown: {
        gross_amount: { value: "100", currency_code: "USD" },
        paypal_fee: { value: "3.5", currency_code: "USD" },
        platform_fees: [{ amount: { value: "2", currency_code: "USD" } }],
      },
    };

    const res = await deliver_capture(resource);

    expect(res.status).toBe(200);
    expect(await settlements()).toEqual([
      expect.objectContaining({ sttl_id: CAPTURE_ID, net: 94.5, fee: 3.5 }),
    ]);
  });

  it("settles at paypal's net whatever platform fees ride along", async () => {
    await seed_donation();
    const resource = {
      ...capture_copy(),
      seller_receivable_breakdown: {
        gross_amount: { value: "100", currency_code: "USD" },
        paypal_fee: { value: "3.5", currency_code: "USD" },
        platform_fees: [{ amount: { value: "1.85", currency_code: "EUR" } }],
        net_amount: { value: "94.5", currency_code: "USD" },
      },
    };

    const res = await deliver_capture(resource);

    expect(res.status).toBe(200);
    expect(await settlements()).toEqual([
      expect.objectContaining({ net: 94.5, fee: 3.5 }),
    ]);
  });

  it("derives a fallback net to the cent", async () => {
    await seed_donation();
    const resource = {
      ...capture_copy(),
      seller_receivable_breakdown: {
        gross_amount: { value: "50.00", currency_code: "USD" },
        paypal_fee: { value: "2.24", currency_code: "USD" },
        platform_fees: [{ amount: { value: "0.70", currency_code: "USD" } }],
      },
    };

    await deliver_capture(resource);

    expect(await settlements()).toEqual([
      expect.objectContaining({ net: 47.06 }),
    ]);
  });
});

describe("a capture whose donor email is still the placeholder", () => {
  const hours_ago = (h: number) =>
    new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
  const with_order = () => {
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });
  };
  const order_refused = () => {
    with_order();
    get_order_mock.mockRejectedValue(
      new PayPalApiError("get order", 404, '{"name":"RESOURCE_NOT_FOUND"}')
    );
  };

  // no redelivery changes either answer, so waiting on one only holds the
  // donation unsettled
  it.each([
    ["paypal refuses the order", order_refused, "ORDER-1"],
    [
      "the capture names no order",
      () => get_capture_mock.mockResolvedValue(capture_copy()),
      undefined,
    ],
  ])(
    "settles at once on the placeholder when %s, reporting it as a bug",
    async (_, arrange, order_id) => {
      await seed_donation({
        from_email: PLACEHOLDER_EMAIL,
        created_at: hours_ago(0.5),
      });
      arrange();

      const res = await deliver(capture_ev());

      expect(res.status).toBe(200);
      expect(await settlements()).toHaveLength(1);
      expect((await donation_get(ORDER_ID))!.status).toBe("settled");
      expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.stringContaining("placeholder email"),
        }),
        {
          don_id: ORDER_ID,
          event_id: CAPTURE_EV_ID,
          capture_id: CAPTURE_ID,
          order_id,
        }
      );
      expect(report_degraded_mock).not.toHaveBeenCalled();
    }
  );

  const withheld = () => {
    with_order();
    get_order_mock.mockResolvedValue({
      id: "ORDER-1",
      payment_source: { venmo: { name: { given_name: "Val" } } },
    });
  };

  // only the checkout's paypal and venmo buttons can fund an order here
  it("reports an order with no paypal or venmo payer as a bug, not as a withheld email", async () => {
    await seed_donation({
      from_email: PLACEHOLDER_EMAIL,
      created_at: hours_ago(0.5),
    });
    with_order();
    get_order_mock.mockResolvedValue({ id: "ORDER-1", payment_source: {} });

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.status).toBe("settled");
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: expect.stringContaining("placeholder email"),
      }),
      {
        don_id: ORDER_ID,
        event_id: CAPTURE_EV_ID,
        capture_id: CAPTURE_ID,
        order_id: "ORDER-1",
      }
    );
    expect(report_degraded_mock).not.toHaveBeenCalled();
  });

  it("reports the withheld email once when two deliveries race", async () => {
    await seed_donation({
      from_email: PLACEHOLDER_EMAIL,
      created_at: hours_ago(0.5),
    });
    withheld();

    await Promise.all([deliver(capture_ev()), deliver(capture_ev())]);

    expect(await settlements()).toHaveLength(1);
    expect(report_degraded_mock).toHaveBeenCalledOnce();
  });

  it("reports nothing on a donation refunded before the lock, which never settles", async () => {
    await seed_donation({
      from_email: PLACEHOLDER_EMAIL,
      created_at: hours_ago(0.5),
    });
    withheld();
    before_lock.current = async (tx, id) => {
      await donation_update(tx, id, { status: "refunded" });
    };

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    expect(await settlements()).toHaveLength(0);
    expect(report_degraded_mock).not.toHaveBeenCalled();
    expect(report_error_mock).not.toHaveBeenCalled();
  });

  const transient = [
    ["a 500", new PayPalApiError("get order", 500, '{"name":"INTERNAL"}')],
    ["a 429", new PayPalApiError("get order", 429, '{"name":"RATE_LIMIT"}')],
    ["a network failure", new TypeError("fetch failed")],
  ] as const;

  it.each(transient)(
    "asks for redelivery within the hour while the order read meets %s, settling and reporting nothing",
    async (_, err) => {
      await seed_donation({
        from_email: PLACEHOLDER_EMAIL,
        created_at: hours_ago(0.5),
      });
      with_order();
      get_order_mock.mockRejectedValue(err);

      const res = await deliver(capture_ev());

      expect(res.status).toBe(503);
      expect(await settlements()).toHaveLength(0);
      expect((await donation_get(ORDER_ID))!.status).toBe("intent");
      expect(enqueue_mock).not.toHaveBeenCalled();
      expect(report_error_mock).not.toHaveBeenCalled();
      expect(report_degraded_mock).not.toHaveBeenCalled();
    }
  );

  it.each(transient)(
    "settles on the placeholder after the hour while the order read meets %s, reporting it as a bug",
    async (_, err) => {
      await seed_donation({
        from_email: PLACEHOLDER_EMAIL,
        created_at: hours_ago(2),
      });
      with_order();
      get_order_mock.mockRejectedValue(err);

      const res = await deliver(capture_ev());

      expect(res.status).toBe(200);
      expect(await settlements()).toHaveLength(1);
      expect((await donation_get(ORDER_ID))!.status).toBe("settled");
      expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.stringContaining("placeholder email"),
          cause: err,
        }),
        {
          don_id: ORDER_ID,
          event_id: CAPTURE_EV_ID,
          capture_id: CAPTURE_ID,
          order_id: "ORDER-1",
        }
      );
      expect(report_degraded_mock).not.toHaveBeenCalled();
    }
  );

  it("settles at once, unreported, when the order paypal holds names the payer", async () => {
    await seed_donation({
      from_email: PLACEHOLDER_EMAIL,
      created_at: hours_ago(0.5),
    });
    with_order();
    get_order_mock.mockResolvedValue({
      id: "ORDER-1",
      payment_source: {
        paypal: { email_address: "payer@test.com", name: { given_name: "P" } },
      },
    });

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    const don = await donation_get(ORDER_ID);
    expect(don!.from_email).toBe("payer@test.com");
    expect(don!.status).toBe("settled");
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(report_degraded_mock).not.toHaveBeenCalled();
  });

  // a payer may withhold their email (venmo often does), and the order's
  // payment_source is fixed once captured: no redelivery would ever add one
  it("settles at once on the placeholder, as degraded, when the payer withheld their email, keeping the name and address they gave", async () => {
    await seed_donation({
      from_email: PLACEHOLDER_EMAIL,
      from_name: "unknown unknown",
      created_at: hours_ago(0.5),
    });
    with_order();
    get_order_mock.mockResolvedValue({
      id: "ORDER-1",
      payment_source: {
        venmo: {
          name: { given_name: "Val", surname: "Mo" },
          address: {
            address_line_1: "1 Elm St",
            admin_area_2: "Austin",
            admin_area_1: "TX",
            postal_code: "78701",
            country_code: "US",
          },
        },
      },
    });

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    expect(await settlements()).toHaveLength(1);
    const don = await donation_get(ORDER_ID);
    expect(don!.status).toBe("settled");
    expect(don!.from_email).toBe(PLACEHOLDER_EMAIL);
    expect(don).toMatchObject({
      from_name: "Val Mo",
      from_addr_street: "1 Elm St",
      from_addr_city: "Austin",
      from_addr_state: "TX",
      from_addr_zip_code: "78701",
      from_addr_country: "US",
    });
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: expect.stringContaining("placeholder email"),
      }),
      {
        don_id: ORDER_ID,
        event_id: CAPTURE_EV_ID,
        capture_id: CAPTURE_ID,
        order_id: "ORDER-1",
      }
    );
  });
});

// the order read is the webhook's one chance at a name or address the browser's
// capture failed to save: once settled, every redelivery short-circuits
describe("a capture whose order paypal fails to read, on a donor's real email", () => {
  const hours_ago = (h: number) =>
    new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
  const order_unread = (err: unknown) => {
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });
    get_order_mock.mockRejectedValue(err);
  };
  const transient = [
    ["a 500", new PayPalApiError("get order", 500, '{"name":"INTERNAL"}')],
    ["a 429", new PayPalApiError("get order", 429, '{"name":"RATE_LIMIT"}')],
    ["a network failure", new TypeError("fetch failed")],
  ] as const;

  it.each(transient)(
    "asks for redelivery within the hour while the order read meets %s, settling and reporting nothing",
    async (_, err) => {
      await seed_donation({ created_at: hours_ago(0.5) });
      order_unread(err);

      const res = await deliver(capture_ev());

      expect(res.status).toBe(503);
      expect(await settlements()).toHaveLength(0);
      expect((await donation_get(ORDER_ID))!.status).toBe("intent");
      expect(enqueue_mock).not.toHaveBeenCalled();
      expect(report_error_mock).not.toHaveBeenCalled();
      expect(report_degraded_mock).not.toHaveBeenCalled();
    }
  );

  it.each(transient)(
    "settles on the donor's email after the hour while the order read meets %s, reporting it as a bug",
    async (_, err) => {
      await seed_donation({ created_at: hours_ago(2) });
      order_unread(err);

      const res = await deliver(capture_ev());

      expect(res.status).toBe(200);
      expect(await settlements()).toHaveLength(1);
      const don = await donation_get(ORDER_ID);
      expect(don!.status).toBe("settled");
      expect(don!.from_email).toBe("donor@test.com");
      expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: expect.stringContaining("order unread"),
          cause: err,
        }),
        {
          don_id: ORDER_ID,
          event_id: CAPTURE_EV_ID,
          capture_id: CAPTURE_ID,
          order_id: "ORDER-1",
        }
      );
      expect(report_degraded_mock).not.toHaveBeenCalled();
    }
  );
});

describe("settling from paypal's copy, not the event's", () => {
  it("settles a capture onto the donation paypal names, whatever the event says", async () => {
    await seed_donation();
    await seed_donation({ id: "don-other" });
    const forged = capture_ev();
    forged.resource.custom_id = "don-other";

    const res = await deliver(forged);

    expect(res.status).toBe(200);
    expect(get_capture_mock).toHaveBeenCalledWith(CAPTURE_ID);
    expect(await settlements()).toEqual([
      expect.objectContaining({ donation_id: ORDER_ID, net: 96.5, fee: 3.5 }),
    ]);
    expect((await donation_get("don-other"))!.status).toBe("intent");
  });

  it("settles nothing on a capture paypal says is not complete", async () => {
    await seed_donation();

    const res = await deliver_capture({
      ...capture_copy(),
      status: "DECLINED",
    });

    expect(res.status).toBe(200);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await settlements()).toHaveLength(0);
  });

  it("settles a sale at what paypal says it sold", async () => {
    await seed_donation({ frequency: "monthly" });

    const res = await deliver(sale_ev());

    expect(res.status).toBe(200);
    expect(get_sale_mock).toHaveBeenCalledWith(SALE_ID);
    expect(await settlements()).toEqual([
      expect.objectContaining({ sttl_id: SALE_ID, net: 96.5, fee: 3.5 }),
    ]);
  });

  it("reports and asks for redelivery of a capture paypal says it cannot find", async () => {
    await seed_donation();
    get_capture_mock.mockRejectedValue(
      new PayPalApiError("get capture", 404, '{"name":"RESOURCE_NOT_FOUND"}')
    );

    const res = await deliver(capture_ev());

    expect(res.status).toBe(503);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await settlements()).toHaveLength(0);
  });

  it("settles a sale whose completion lands after paypal reversed it, so its reversal finds it", async () => {
    await seed_donation({ frequency: "monthly" });
    get_sale_mock.mockResolvedValue({ ...sale_copy(), state: "reversed" });

    const res = await deliver(sale_ev());

    expect(res.status).toBe(200);
    expect(await settlements()).toEqual([
      expect.objectContaining({ sttl_id: SALE_ID, net: 96.5, fee: 3.5 }),
    ]);
  });

  it("takes the subscription off the event when paypal's copy of the sale has none", async () => {
    await seed_donation({ frequency: "monthly" });
    const { billing_agreement_id: _, ...copy } = sale_copy();
    get_sale_mock.mockResolvedValue(copy);

    const res = await deliver(sale_ev());

    expect(res.status).toBe(200);
    expect(get_subscription_mock).toHaveBeenCalledWith(SUBS_ID);
    expect((await donation_get(ORDER_ID))!.settlement!.id).toBe(SALE_ID);
  });

  it("reports and asks for redelivery of a sale paypal says it cannot find", async () => {
    await seed_donation({ frequency: "monthly" });
    get_sale_mock.mockRejectedValue(
      new PayPalApiError("get sale", 404, '{"name":"INVALID_RESOURCE_ID"}')
    );

    const res = await deliver(sale_ev());

    expect(res.ok).toBe(false);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await settlements()).toHaveLength(0);
  });
});

describe("a lookup paypal refuses for good", () => {
  const not_found = (op: string) =>
    new PayPalApiError(op, 404, '{"name":"RESOURCE_NOT_FOUND"}');

  it("settles a capture whose order paypal cannot find, on the donor it has", async () => {
    await seed_donation();
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });
    get_order_mock.mockRejectedValue(not_found("get order"));

    const res = await deliver(capture_ev());

    expect(res.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.status).toBe("settled");
  });

  it.each([
    [
      "subscription",
      () =>
        get_subscription_mock.mockRejectedValue(not_found("get subscription")),
    ],
    ["plan", () => get_plan_mock.mockRejectedValue(not_found("get plan"))],
  ])(
    "acknowledges and reports a sale whose %s paypal cannot find",
    async (_, refuse) => {
      await seed_donation({ frequency: "monthly" });
      refuse();

      const res = await deliver(sale_ev());

      expect(res.status).toBe(200);
      expect(await res.text()).toMatch(/^not routable: /);
      expect(report_error_mock).toHaveBeenCalledOnce();
      expect(await settlements()).toHaveLength(0);
    }
  );
});

describe("PAYMENT.SALE.COMPLETED", () => {
  it("re-queues a settled sale's messages on redelivery", async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    enqueue_mock.mockClear();

    const res = await deliver(sale_ev());

    expect(res.status).toBe(200);
    expect(all_kinds()).toEqual(["don-sttl-dist", "don-sttl-receipt"]);
  });

  it("asks for redelivery of a settled sale while paypal's api is down", async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    enqueue_mock.mockClear();
    get_subscription_mock.mockRejectedValue(new Error("paypal 503"));

    const res = await deliver(sale_ev());

    expect(res.ok).toBe(false);
    expect(enqueue_mock).not.toHaveBeenCalled();
    expect(await settlements()).toHaveLength(1);
  });

  it("answers 200 and reports a settled sale whose subscription paypal 404s", async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    enqueue_mock.mockClear();
    get_subscription_mock.mockRejectedValue(
      new PayPalApiError(
        "get subscription",
        404,
        '{"name":"RESOURCE_NOT_FOUND"}'
      )
    );

    const res = await deliver(sale_ev());

    expect(res.status).toBe(200);
    expect(enqueue_mock).not.toHaveBeenCalled();
    // reported as ours to fix: the reporter keeps any error with a 4xx
    // `status` out of sentry
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.stringContaining(SALE_ID) }),
      { sale_id: SALE_ID, subs_id: SUBS_ID, http_status: 404 }
    );
    expect(report_error_mock.mock.calls[0]![0]).not.toHaveProperty("status");
  });

  it("asks for redelivery of a settled sale while paypal rate-limits the lookup", async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    enqueue_mock.mockClear();
    get_subscription_mock.mockRejectedValue(
      new PayPalApiError("get subscription", 429, "{}")
    );

    const res = await deliver(sale_ev());

    expect(res.ok).toBe(false);
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("answers 200 for a settled sale whose subscription has no order id", async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    enqueue_mock.mockClear();
    const { custom_id: _, ...sub } = await get_subscription_mock();
    get_subscription_mock.mockResolvedValue(sub);

    const res = await deliver(sale_ev());

    expect(res.status).toBe(200);
    expect(report_error_mock).toHaveBeenCalled();
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("asks for redelivery of a sale that lands before its subscription activates", async () => {
    await seed_donation({ frequency: "monthly" });
    const { billing_info: _, ...active } = await get_subscription_mock();
    get_subscription_mock.mockResolvedValue({ ...active, status: "APPROVED" });

    const early = await deliver(sale_ev());

    expect(early.ok).toBe(false);
    expect(await settlements()).toHaveLength(0);
    expect(enqueue_mock).not.toHaveBeenCalled();

    get_subscription_mock.mockResolvedValue({
      ...active,
      status: "ACTIVE",
      billing_info: { next_billing_time: "2026-02-01T00:00:00.000Z" },
    });
    const redelivered = await deliver(sale_ev());

    expect(redelivered.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.settlement!.id).toBe(SALE_ID);
  });

  it("settles a sale paypal charged no fee at its total", async () => {
    await seed_donation({ frequency: "monthly" });
    const { transaction_fee: _, ...resource } = sale_copy();
    get_sale_mock.mockResolvedValue(resource);

    const res = await deliver(sale_ev());

    expect(res.status).toBe(200);
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(await settlements()).toEqual([
      expect.objectContaining({ sttl_id: SALE_ID, net: 100, fee: 0 }),
    ]);
  });

  it("derives a sale's fallback net to the cent", async () => {
    await seed_donation({ frequency: "monthly" });
    get_sale_mock.mockResolvedValue({
      ...sale_copy(),
      amount: { total: "20.20", currency: "USD" },
      transaction_fee: { value: "1.10", currency: "USD" },
    });

    await deliver(sale_ev());

    expect(await settlements()).toEqual([
      expect.objectContaining({ sttl_id: SALE_ID, net: 19.1 }),
    ]);
  });

  it("settles one first-recurring sale once when two deliveries race", async () => {
    await seed_donation({ frequency: "monthly" });

    const [a, b] = await Promise.all([deliver(sale_ev()), deliver(sale_ev())]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await settlements()).toHaveLength(1);
    expect(await db().select().from(donations)).toHaveLength(1);
    const don = await donation_get(ORDER_ID);
    expect(don!.status).toBe("settled");
    expect(don!.settlement!.id).toBe(SALE_ID);
    expect(all_kinds()).toEqual([
      "don-sttl-dist",
      "don-sttl-receipt",
      "don-sttl-dist",
      "don-sttl-receipt",
    ]);
  });
});

const approved_ev = () => ({
  event_type: "CHECKOUT.ORDER.APPROVED",
  resource: {
    id: "ORDER-1",
    payment_source: { paypal: { email_address: "payer@test.com" } },
    purchase_units: [{ custom_id: ORDER_ID }],
  },
});

describe("CHECKOUT.ORDER.APPROVED", () => {
  it("writes the payer and schedules a capture check, rather than racing the browser's capture", async () => {
    await seed_donation({ from_email: "anon@x.com" });
    const before = Date.now();

    const res = await deliver(approved_ev());

    expect(res.status).toBe(200);
    expect(capture_order_mock).not.toHaveBeenCalled();
    expect(schedule_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "paypal-order-capture",
        payload: {
          order_id: "ORDER-1",
          don_id: ORDER_ID,
          scheduled_at: expect.any(String),
        },
        delay_s: expect.any(Number),
      })
    );
    // the handler tells its retries from its first attempt by this stamp
    const { scheduled_at } = schedule_mock.mock.calls[0]![0].payload;
    expect(Date.parse(scheduled_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(scheduled_at)).toBeLessThanOrEqual(Date.now());
    expect(schedule_mock.mock.calls[0]![0].delay_s).toBeGreaterThanOrEqual(60);
    expect((await donation_get(ORDER_ID))!.from_email).toBe("payer@test.com");
  });

  it.each([
    ["no payment source", {}],
    ["a payer with no email", { payment_source: { venmo: {} } }],
  ])(
    "schedules the capture check for an order approved with %s, keeping the donor it has",
    async (_, payer) => {
      await seed_donation();
      const ev = approved_ev();
      const { payment_source: __, ...rest } = ev.resource;

      const res = await deliver({ ...ev, resource: { ...rest, ...payer } });

      expect(res.status).toBe(200);
      expect(report_error_mock).not.toHaveBeenCalled();
      expect(schedule_mock).toHaveBeenCalledOnce();
      expect((await donation_get(ORDER_ID))!.from_email).toBe("donor@test.com");
    }
  );

  it("asks for redelivery while the check can't be scheduled", async () => {
    await seed_donation();
    schedule_mock.mockRejectedValue(new Error("qstash 503"));

    const res = await deliver(approved_ev());

    expect(res.ok).toBe(false);
  });
});

describe("refunds and reversals", () => {
  const capture_refund_ev = (event_type = "PAYMENT.CAPTURE.REFUNDED") => ({
    id: "WH-REF-1",
    event_type,
    resource: {
      id: "REF-1",
      status: "COMPLETED",
      amount: { value: "100", currency_code: "USD" },
      links: [
        {
          rel: "up",
          method: "GET",
          href: `https://api.sandbox.paypal.com/v2/payments/captures/${CAPTURE_ID}`,
        },
      ],
    },
  });
  const sale_refund_ev = (event_type = "PAYMENT.SALE.REFUNDED") => ({
    id: "WH-REF-2",
    event_type,
    resource: { id: "REF-2", state: "completed", sale_id: SALE_ID },
  });
  const settled_capture = async () => {
    await seed_donation();
    await deliver(capture_ev());
    await seed_dist(ORDER_ID);
  };
  const paypal_capture_is = (status: string) =>
    get_capture_mock.mockResolvedValue({ ...capture_copy(), status });
  /** the one reversal the delivery handed over */
  const reversal = () => {
    expect(reverse_charge_mock).toHaveBeenCalledOnce();
    return reverse_charge_mock.mock.calls[0]![0];
  };
  /** how much of the charge the reversal says is taken back so far */
  const taken_back = () => {
    const { taken, of } = reversal().share;
    return taken / of;
  };

  it.each([
    ["PAYMENT.CAPTURE.REFUNDED", "refund"],
    ["PAYMENT.CAPTURE.REVERSED", "dispute"],
  ])(
    "reverses a donation whose capture %s in full, as a %s",
    async (event_type, source) => {
      await settled_capture();
      paypal_capture_is("REFUNDED");

      const res = await deliver(capture_refund_ev(event_type));

      expect(res.status).toBe(200);
      expect(get_capture_mock).toHaveBeenLastCalledWith(CAPTURE_ID);
      expect(reversal()).toMatchObject({
        donation_id: ORDER_ID,
        rail: "paypal",
        source,
        source_ref: "REF-1",
      });
      expect(taken_back()).toBe(1);
      expect(reversal().notice.ids.join("\n")).toContain(CAPTURE_ID);
    }
  );

  it("sizes a partial refund by its own amount, whatever paypal says is refunded to date", async () => {
    await settled_capture();
    paypal_capture_is("PARTIALLY_REFUNDED");
    const ev = capture_refund_ev();

    const res = await deliver({
      ...ev,
      resource: {
        ...ev.resource,
        amount: { value: "15.00", currency_code: "USD" },
        seller_payable_breakdown: {
          total_refunded_amount: { value: "40.00", currency_code: "USD" },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(reversal().source).toBe("refund");
    expect(taken_back()).toBe(0.15);
  });

  it.each([
    ["PAYMENT.CAPTURE.REFUNDED", "2026-10-02T09:00:00Z"],
    ["PAYMENT.CAPTURE.REVERSED", undefined],
  ])(
    "hands over %s with the refund's time at paypal, a chargeback with none",
    async (event_type, refunded_at) => {
      await settled_capture();
      paypal_capture_is("PARTIALLY_REFUNDED");
      const ev = capture_refund_ev(event_type);

      await deliver({
        ...ev,
        resource: {
          ...ev.resource,
          create_time: "2026-10-02T09:00:00Z",
          amount: { value: "-15.00", currency_code: "USD" },
        },
      });

      expect(reversal().refunded_at).toBe(refunded_at);
    }
  );

  it("hands over a refund naming no amount of its own with what paypal says is refunded to date", async () => {
    await settled_capture();
    paypal_capture_is("PARTIALLY_REFUNDED");
    const ev = capture_refund_ev();
    const { amount: _, ...resource } = ev.resource;

    const res = await deliver({
      ...ev,
      resource: {
        ...resource,
        seller_payable_breakdown: {
          total_refunded_amount: { value: "40.00", currency_code: "USD" },
        },
      },
    });

    expect(res.status).toBe(200);
    expect(reversal().share).toBeNull();
    const { taken, of } = reversal().refunded_to_date;
    expect(taken / of).toBe(0.4);
  });

  it("reverses a chargeback of the whole capture as a dispute, whatever status paypal leaves on it", async () => {
    await settled_capture();
    paypal_capture_is("COMPLETED");

    const res = await deliver(capture_refund_ev("PAYMENT.CAPTURE.REVERSED"));

    expect(res.status).toBe(200);
    expect(reversal().source).toBe("dispute");
    expect(taken_back()).toBe(1);
  });

  it("hands a chargeback of part of the capture over as a dispute's share", async () => {
    await settled_capture();
    paypal_capture_is("COMPLETED");
    const ev = capture_refund_ev("PAYMENT.CAPTURE.REVERSED");
    ev.resource.amount.value = "-40.00";

    const res = await deliver(ev);

    expect(res.status).toBe(200);
    expect(reversal().source).toBe("dispute");
    expect(taken_back()).toBe(0.4);
    expect(reversal().notice.amount).toContain("-40.00 USD");
  });

  it("hands over a chargeback after a partial refund by its own part, without the order", async () => {
    await settled_capture();
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      status: "PARTIALLY_REFUNDED",
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });
    get_order_mock.mockClear();
    const ev = capture_refund_ev("PAYMENT.CAPTURE.REVERSED");
    ev.resource.amount.value = "-60.00";

    const res = await deliver(ev);

    expect(res.status).toBe(200);
    expect(get_order_mock).not.toHaveBeenCalled();
    expect(reversal().source).toBe("dispute");
    expect(taken_back()).toBe(0.6);
  });

  it("reverses a chargeback that alone takes the whole capture, without the order", async () => {
    await settled_capture();
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });
    get_order_mock.mockClear();
    const ev = capture_refund_ev("PAYMENT.CAPTURE.REVERSED");
    ev.resource.amount.value = "-100.00";

    const res = await deliver(ev);

    expect(res.status).toBe(200);
    expect(get_order_mock).not.toHaveBeenCalled();
    expect(reversal().source).toBe("dispute");
    expect(taken_back()).toBe(1);
  });

  it("reverses a chargeback of a capture paypal already reads refunded, without the order", async () => {
    await settled_capture();
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      status: "REFUNDED",
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });
    get_order_mock.mockRejectedValue(new Error("paypal 503"));
    get_order_mock.mockClear();

    const res = await deliver(capture_refund_ev("PAYMENT.CAPTURE.REVERSED"));

    expect(res.status).toBe(200);
    expect(get_order_mock).not.toHaveBeenCalled();
    expect(reversal().source).toBe("dispute");
    expect(taken_back()).toBe(1);
  });

  it("reverses a sale paypal reports reversed as the sale itself", async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    await seed_dist(ORDER_ID);
    get_sale_mock.mockResolvedValue({ ...sale_copy(), state: "reversed" });

    const res = await deliver({
      id: "WH-REV-3",
      event_type: "PAYMENT.SALE.REVERSED",
      resource_type: "sale",
      resource: { id: SALE_ID, state: "reversed" },
    });

    expect(res.status).toBe(200);
    expect(get_sale_mock).toHaveBeenLastCalledWith(SALE_ID);
    expect(reversal().source).toBe("dispute");
    expect(taken_back()).toBe(1);
  });

  it("hands a sale chargeback of part of the charge over by its own part", async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    await seed_dist(ORDER_ID);
    get_sale_mock.mockResolvedValue({
      ...sale_copy(),
      state: "partially_refunded",
    });

    const res = await deliver({
      id: "WH-REV-4",
      event_type: "PAYMENT.SALE.REVERSED",
      resource: {
        id: "REV-4",
        sale_id: SALE_ID,
        amount: { total: "-60.00", currency: "USD" },
      },
    });

    expect(res.status).toBe(200);
    expect(reversal().source).toBe("dispute");
    expect(taken_back()).toBe(0.6);
    expect(reversal().notice.ids.join("\n")).toContain(SALE_ID);
  });

  it("asks for redelivery when some dists failed to reverse", async () => {
    await settled_capture();
    paypal_capture_is("REFUNDED");
    reverse_charge_mock.mockResolvedValue({
      status: "failed",
      reason: "incomplete",
      dists: 1,
      applied: 0,
      failures: ["dist x: db timeout"],
    });

    const res = await deliver(capture_refund_ev());

    expect(res.ok).toBe(false);
  });

  // paypal names no unsent refunds, so no later event would lift a hold
  it("reports and acknowledges a reversal the entry holds", async () => {
    await settled_capture();
    paypal_capture_is("REFUNDED");
    reverse_charge_mock.mockResolvedValue({ status: "held" });
    report_error_mock.mockClear();

    const res = await deliver(capture_refund_ev());

    expect(res.status).toBe(200);
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.stringContaining("held") }),
      expect.objectContaining({ event_id: "WH-REF-1", donation_id: ORDER_ID })
    );
  });

  it("reports and acknowledges a refund of a charge no donation here owns", async () => {
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      status: "REFUNDED",
      custom_id: "not-ours",
    });

    const res = await deliver(capture_refund_ev());

    expect(res.status).toBe(200);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(reverse_charge_mock).not.toHaveBeenCalled();
  });

  it("reverses a subscription charge paypal refunded in full", async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    await seed_dist(ORDER_ID);
    get_sale_mock.mockResolvedValue({ ...sale_copy(), state: "refunded" });

    const res = await deliver(sale_refund_ev());

    expect(res.status).toBe(200);
    expect(get_sale_mock).toHaveBeenLastCalledWith(SALE_ID);
    expect(reversal()).toMatchObject({
      donation_id: ORDER_ID,
      source: "refund",
    });
    expect(taken_back()).toBe(1);
  });

  it("acknowledges a refund on a donation already reversed", async () => {
    await settled_capture();
    await donation_update(db() as any, ORDER_ID, { status: "refunded" });
    paypal_capture_is("REFUNDED");
    reverse_charge_mock.mockResolvedValue({
      status: "already_reversed",
      donation_status: "refunded",
    });

    const res = await deliver(capture_refund_ev());

    expect(res.status).toBe(200);
    expect(reversal()).toMatchObject({
      donation_id: ORDER_ID,
      source: "refund",
    });
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(
      enqueue_mock.mock.calls.flat().filter((m: any) => m.id === "fiat-notice")
    ).toEqual([]);
  });

  it("reports a refund that lands before its capture settles as degraded", async () => {
    await seed_donation();
    paypal_capture_is("REFUNDED");

    const res = await deliver(capture_refund_ev());

    expect(res.status).toBe(503);
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: expect.stringContaining("not settled yet"),
      }),
      expect.objectContaining({ sttl_id: CAPTURE_ID })
    );
  });

  it("asks for redelivery of a refund whose capture has not settled here yet", async () => {
    await seed_donation();
    paypal_capture_is("REFUNDED");

    const res = await deliver(capture_refund_ev());

    expect(res.ok).toBe(false);
    expect(reverse_charge_mock).not.toHaveBeenCalled();
  });

  describe("sized on the real entry, the gift's $90 grant and $3.20 card fee paid out", () => {
    /** paypal's refund of the capture, with `total` refunded off it to date */
    const refund_ev = (id: string, value: string, total: string) => {
      const ev = capture_refund_ev();
      ev.id = `WH-${id}`;
      return {
        ...ev,
        resource: {
          ...ev.resource,
          id,
          amount: { value, currency_code: "USD" },
          seller_payable_breakdown: {
            total_refunded_amount: { value: total, currency_code: "USD" },
          },
        },
      };
    };
    const grant_paid = async (charge: "capture" | "sale" = "capture") => {
      if (charge === "capture") {
        await seed_donation();
        await deliver(capture_ev());
      } else {
        await seed_donation({ frequency: "monthly" });
        await deliver(sale_ev());
      }
      await db()
        .insert(dists)
        .values({
          id: `dist-${ORDER_ID}`,
          donation_id: ORDER_ID,
          status: "settled",
          date_created: "2026-01-02T00:00:00.000Z",
          to_id: npo_id,
          to_name: "PP Test NPO",
          amount: 100,
          amount_usd: 100,
          amount_denom: "USD",
          net: 90,
          fee_base: 4.3,
          fee_fsa: 2.5,
          fee_processing: 3.2,
          alloc: { liq: 0, lock: 0, cash: 100 },
        });
      await db()
        .insert(payouts)
        .values({
          id: `payout-${ORDER_ID}`,
          source_id: `dist-${ORDER_ID}`,
          npo_id,
          source: "donation",
          date: "2026-01-02T00:00:00.000Z",
          amount: 90,
          type: "settled",
          settled_date: "2026-01-03T00:00:00.000Z",
        });
    };
    const owed_rows = () => owed_for_donation(ORDER_ID);

    beforeEach(() => {
      reverse_charge_mock.mockImplementation(real_reverse_charge);
    });

    it("records $40 of $100 as the npo's share of what it received plus its card fee, reversing nothing", async () => {
      await grant_paid();
      paypal_capture_is("PARTIALLY_REFUNDED");

      const res = await deliver(refund_ev("REF-40", "40.00", "40.00"));

      expect(res.status).toBe(200);
      expect(await owed_rows()).toEqual([
        expect.objectContaining({
          npo_id,
          source: "refund",
          source_ref: "REF-40",
          received_usd: 36,
          fee_processing_usd: 1.28,
          outstanding_usd: 37.28,
        }),
      ]);
      expect((await donation_get(ORDER_ID))?.status).toBe("settled");
    });

    it("reverses the gift on the $60 that completes the charge, the row grown to the full figure", async () => {
      await grant_paid();
      paypal_capture_is("PARTIALLY_REFUNDED");
      await deliver(refund_ev("REF-40", "40.00", "40.00"));
      paypal_capture_is("REFUNDED");

      const res = await deliver(refund_ev("REF-60", "60.00", "100.00"));

      expect(res.status).toBe(200);
      expect(await owed_rows()).toEqual([
        expect.objectContaining({
          source_ref: "REF-40",
          received_usd: 90,
          fee_processing_usd: 3.2,
          outstanding_usd: 93.2,
        }),
      ]);
      expect((await donation_get(ORDER_ID))?.status).toBe("refunded_loss");
    });

    it("records a redelivered partial refund once, its notice under one key", async () => {
      await grant_paid();
      paypal_capture_is("PARTIALLY_REFUNDED");
      await deliver(refund_ev("REF-40", "40.00", "40.00"));
      const first = dedupes(-1);

      const res = await deliver(refund_ev("REF-40", "40.00", "40.00"));

      expect(res.status).toBe(200);
      expect(await owed_rows()).toEqual([
        expect.objectContaining({
          source_ref: "REF-40",
          outstanding_usd: 37.28,
        }),
      ]);
      expect((await donation_get(ORDER_ID))?.status).toBe("settled");
      expect(dedupes(-1)).toEqual(first);
    });

    const chargeback_ev = (value: string) => {
      const ev = capture_refund_ev("PAYMENT.CAPTURE.REVERSED");
      ev.resource.amount.value = value;
      return ev;
    };
    const taken = async () =>
      taken_of(await takes_of(db() as unknown as DbOrTx, ORDER_ID));

    it("reverses the gift on a $60 chargeback after a $40 refund, together the whole charge", async () => {
      await grant_paid();
      paypal_capture_is("PARTIALLY_REFUNDED");
      await deliver(refund_ev("REF-40", "40.00", "40.00"));
      const before = await taken();

      const res = await deliver(chargeback_ev("-60.00"));

      expect(res.status).toBe(200);
      expect(before).toBe(0.4);
      expect(await taken()).toBe(1);
      expect((await donation_get(ORDER_ID))?.status).toBe("refunded_loss");
      expect(await owed_rows()).toEqual([
        expect.objectContaining({ received_usd: 90, outstanding_usd: 93.2 }),
      ]);
    });

    it.each([
      ["a chargeback", "PARTIALLY_REFUNDED", "-60.00", 0.6, "settled"],
      [
        "a chargeback of the whole capture",
        "COMPLETED",
        "-100.00",
        1,
        "refunded_loss",
      ],
    ])(
      "takes %s back by its own part",
      async (_, capture_status, value, share, status) => {
        await grant_paid();
        paypal_capture_is(capture_status);

        const res = await deliver(chargeback_ev(value));

        expect(res.status).toBe(200);
        expect(await taken()).toBe(share);
        expect((await donation_get(ORDER_ID))?.status).toBe(status);
      }
    );

    it("records $40 of a $100 v1 sale by the refund's own amount", async () => {
      await grant_paid("sale");
      get_sale_mock.mockResolvedValue({
        ...sale_copy(),
        state: "partially_refunded",
      });

      const res = await deliver({
        ...sale_refund_ev(),
        resource: {
          ...sale_refund_ev().resource,
          amount: { total: "40.00", currency: "USD" },
        },
      });

      expect(res.status).toBe(200);
      expect(await owed_rows()).toEqual([
        expect.objectContaining({
          npo_id,
          source: "refund",
          source_ref: "REF-2",
          outstanding_usd: 37.28,
        }),
      ]);
      expect((await donation_get(ORDER_ID))?.status).toBe("settled");
    });

    it("tells ops a v1 sale refund naming no amount can't be sized, saying why, and records nothing", async () => {
      await grant_paid("sale");
      get_sale_mock.mockResolvedValue({
        ...sale_copy(),
        state: "partially_refunded",
      });
      enqueue_mock.mockClear();

      const res = await deliver(sale_refund_ev());

      expect(res.status).toBe(200);
      const notices = enqueue_mock.mock.calls
        .flat()
        .filter((m: any) => m.id === "fiat-notice");
      expect(notices).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            alert: expect.objectContaining({ title: "Reversal Not Sized" }),
          }),
        }),
      ]);
      const body: string = notices[0].payload.alert.body;
      expect(body).toContain(SALE_ID);
      expect(body).toContain("names no amount of its own");
      expect(body).toContain("by hand");
      expect(await owed_rows()).toEqual([]);
      expect((await donation_get(ORDER_ID))?.status).toBe("settled");
    });
  });
});

describe("subscription lifecycle", () => {
  const sub_row = async () =>
    (
      await db()
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, SUBS_ID))
    )[0];
  const active_sub = async () => {
    await seed_donation({ frequency: "monthly" });
    await deliver(sale_ev());
    enqueue_mock.mockClear();
  };
  const paypal_sub_is = async (status: string, next_billing?: string) => {
    const { billing_info: _, ...sub } = await get_subscription_mock();
    get_subscription_mock.mockResolvedValue({
      ...sub,
      status,
      ...(next_billing && {
        billing_info: { next_billing_time: next_billing },
      }),
    });
  };
  const lifecycle_ev = (event_type: string) => ({
    id: `WH-${event_type}`,
    event_type,
    resource: { id: SUBS_ID, status: "IGNORED-read-from-paypal" },
  });

  it.each([
    ["BILLING.SUBSCRIPTION.CANCELLED", "CANCELLED"],
    ["BILLING.SUBSCRIPTION.SUSPENDED", "SUSPENDED"],
    ["BILLING.SUBSCRIPTION.EXPIRED", "EXPIRED"],
  ])(
    "marks a subscription inactive on %s, without cancelling it again",
    async (event_type, status) => {
      await active_sub();
      await paypal_sub_is(status);

      const res = await deliver(lifecycle_ev(event_type));

      expect(res.status).toBe(200);
      expect((await sub_row())!.status).toBe("inactive");
      expect(enqueue_mock).not.toHaveBeenCalled();
    }
  );

  // a suspension can still resume, so it records no end reason
  it.each([
    ["BILLING.SUBSCRIPTION.CANCELLED", "CANCELLED", "cancelled"],
    ["BILLING.SUBSCRIPTION.EXPIRED", "EXPIRED", "expired"],
    ["BILLING.SUBSCRIPTION.SUSPENDED", "SUSPENDED", null],
  ])(
    "records why paypal ended a subscription on %s",
    async (event_type, status, reason) => {
      await active_sub();
      await paypal_sub_is(status);

      await deliver(lifecycle_ev(event_type));

      expect((await sub_row())!.status_cancel_reason).toBe(reason);
    }
  );

  it("records paypal's note alongside why it ended a subscription", async () => {
    await active_sub();
    await paypal_sub_is("CANCELLED");
    get_subscription_mock.mockResolvedValue({
      ...(await get_subscription_mock()),
      status_change_note: "Item out of stock",
    });

    await deliver(lifecycle_ev("BILLING.SUBSCRIPTION.CANCELLED"));

    expect((await sub_row())!.status_cancel_reason).toBe(
      "cancelled: Item out of stock"
    );
  });

  it("keeps the donor's reason when paypal reports the cancel they made here", async () => {
    await active_sub();
    await db()
      .update(subscriptions)
      .set({ status: "inactive", status_cancel_reason: "too expensive" })
      .where(eq(subscriptions.id, SUBS_ID));
    await paypal_sub_is("CANCELLED");

    await deliver(lifecycle_ev("BILLING.SUBSCRIPTION.CANCELLED"));

    expect((await sub_row())!.status_cancel_reason).toBe("too expensive");
  });

  it("brings a suspended subscription back when paypal reactivates it", async () => {
    await active_sub();
    await paypal_sub_is("SUSPENDED");
    await deliver(lifecycle_ev("BILLING.SUBSCRIPTION.SUSPENDED"));
    await paypal_sub_is("ACTIVE", "2026-04-01T00:00:00.000Z");

    const res = await deliver(
      lifecycle_ev("BILLING.SUBSCRIPTION.RE-ACTIVATED")
    );

    expect(res.status).toBe(200);
    expect(await sub_row()).toMatchObject({
      status: "active",
      next_billing: "2026-04-01T00:00:00.000Z",
    });
  });

  it("moves next billing on after a failed payment paypal will retry", async () => {
    await active_sub();
    await paypal_sub_is("ACTIVE", "2026-02-06T00:00:00.000Z");

    const res = await deliver(
      lifecycle_ev("BILLING.SUBSCRIPTION.PAYMENT.FAILED")
    );

    expect(res.status).toBe(200);
    expect(await sub_row()).toMatchObject({
      status: "active",
      next_billing: "2026-02-06T00:00:00.000Z",
    });
  });

  it("moves next billing on with every charge", async () => {
    await active_sub();
    await paypal_sub_is("ACTIVE", "2026-03-01T00:00:00.000Z");
    const next = sale_ev();
    next.resource.id = "sale-2";

    const res = await deliver(next);

    expect(res.status).toBe(200);
    expect((await sub_row())!.next_billing).toBe("2026-03-01T00:00:00.000Z");
  });

  it("settles a rebill paypal took before the donor cancelled", async () => {
    await active_sub();
    await paypal_sub_is("CANCELLED");
    const rebill = sale_ev();
    rebill.resource.id = "sale-2";
    get_sale_mock.mockResolvedValue({ ...sale_copy(), id: "sale-2" });

    const res = await deliver(rebill);

    expect(res.status).toBe(200);
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(await settlements()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sttl_id: "sale-2", net: 96.5, fee: 3.5 }),
      ])
    );
    expect(await sub_row()).toMatchObject({
      next_billing: "2026-02-01T00:00:00.000Z",
    });
  });

  it("copies campaign_id from the prior donation, not the subscription", async () => {
    const ON_GIFT = "11111111-1111-4111-8111-111111111111";
    const ON_SUB = "22222222-2222-4222-8222-222222222222";
    await db().insert(user).values({
      id: "user-pp-rebill",
      name: "Ada Admin",
      email: "ada-pp-rebill@test.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      first_name: "Ada",
      last_name: "Admin",
    });
    await db()
      .insert(campaigns)
      .values([
        {
          id: ON_GIFT,
          owner_npo_id: npo_id,
          creator_id: "user-pp-rebill",
          name: "Gift",
          slug: "gift",
          description_pt: "[]",
        },
        {
          id: ON_SUB,
          owner_npo_id: npo_id,
          creator_id: "user-pp-rebill",
          name: "Sub",
          slug: "sub",
          description_pt: "[]",
        },
      ]);
    await db()
      .insert(campaign_members)
      .values([
        { campaign_id: ON_GIFT, npo_id },
        { campaign_id: ON_SUB, npo_id },
      ]);
    await seed_donation({ frequency: "monthly", campaign_id: ON_GIFT });
    await deliver(sale_ev());
    await db()
      .update(subscriptions)
      .set({ campaign_id: ON_SUB })
      .where(eq(subscriptions.id, SUBS_ID));
    const rebill = sale_ev();
    rebill.resource.id = "sale-campaign";
    get_sale_mock.mockResolvedValue({ ...sale_copy(), id: "sale-campaign" });

    const res = await deliver(rebill);

    expect(res.status).toBe(200);
    const rows = await db().select().from(donations);
    const clone = rows.find((r) => r.id !== ORDER_ID);
    expect(clone?.campaign_id).toBe(ON_GIFT);
    expect((await sub_row())?.campaign_id).toBe(ON_SUB);
  });

  it("settles a first sale on a subscription that has expired since, recording it inactive", async () => {
    await seed_donation({ frequency: "monthly" });
    await paypal_sub_is("EXPIRED");

    const res = await deliver(sale_ev());

    expect(res.status).toBe(200);
    expect(report_error_mock).not.toHaveBeenCalled();
    expect((await donation_get(ORDER_ID))!.settlement!.id).toBe(SALE_ID);
    expect((await sub_row())!.status).toBe("inactive");
  });

  it("reports a cancellation that lands before the subscription does as degraded", async () => {
    await seed_donation({ frequency: "monthly" });
    await paypal_sub_is("CANCELLED");

    const res = await deliver(lifecycle_ev("BILLING.SUBSCRIPTION.CANCELLED"));

    expect(res.status).toBe(503);
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: expect.stringContaining("not recorded yet"),
      }),
      expect.objectContaining({ subs_id: SUBS_ID })
    );
  });

  it("asks for redelivery of a cancellation that lands before the subscription does", async () => {
    await seed_donation({ frequency: "monthly" });
    await paypal_sub_is("CANCELLED");

    const res = await deliver(lifecycle_ev("BILLING.SUBSCRIPTION.CANCELLED"));

    expect(res.ok).toBe(false);
  });
});

describe("BILLING.SUBSCRIPTION.ACTIVATED", () => {
  const activated_ev = (resource: Record<string, unknown> = {}) => ({
    id: "WH-ACTIVATED",
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    resource: {
      id: SUBS_ID,
      plan_id: "P-1",
      custom_id: ORDER_ID,
      status: "ACTIVE",
      create_time: "2026-01-01T00:00:00.000Z",
      update_time: "2026-01-01T00:00:00.000Z",
      subscriber: {
        email_address: "subscriber@test.com",
        name: { given_name: "Sub", surname: "Scriber" },
      },
      billing_info: { next_billing_time: "2026-02-01T00:00:00.000Z" },
      ...resource,
    },
  });
  const sub_rows = () => db().select().from(subscriptions);

  it("creates the subscription row and writes the subscriber onto the placeholder donation", async () => {
    await seed_donation({
      frequency: "monthly",
      from_email: PLACEHOLDER_EMAIL,
    });

    const res = await deliver(activated_ev());

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`created subscription record ${SUBS_ID}`);
    expect(await sub_rows()).toEqual([
      expect.objectContaining({
        id: SUBS_ID,
        platform: "paypal",
        status: "active",
        interval: "month",
        interval_count: 1,
        amount: 100,
        product_id: "PROD-1",
        to_npo_id: npo_id,
        from_id: "subscriber@test.com",
        next_billing: "2026-02-01T00:00:00.000Z",
      }),
    ]);
    expect((await donation_get(ORDER_ID))!.from_email).toBe(
      "subscriber@test.com"
    );
    expect(report_error_mock).not.toHaveBeenCalled();
  });

  it("leaves a second delivery of the same activation as one row", async () => {
    await seed_donation({ frequency: "monthly" });

    await deliver(activated_ev());
    const res = await deliver(activated_ev());

    expect(res.status).toBe(200);
    expect(await sub_rows()).toHaveLength(1);
  });

  it("asks for redelivery when the donation is not there yet, writing no row", async () => {
    const res = await deliver(activated_ev());

    expect(res.status).toBe(500);
    expect(await sub_rows()).toHaveLength(0);
  });

  // defensive guard, not a paypal case: an ACTIVE subscription's subscriber
  // carries the payer's paypal account email; the spec only marks it optional
  it("guard: acknowledges and reports an activation with no subscriber email, writing no row", async () => {
    await seed_donation({ frequency: "monthly" });

    const res = await deliver(activated_ev({ subscriber: {} }));

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^not routable: /);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await sub_rows()).toHaveLength(0);
  });
});

describe("PAYMENT.CAPTURE.DENIED", () => {
  const denied_ev = () => ({
    id: "WH-DEN-1",
    event_type: "PAYMENT.CAPTURE.DENIED",
    resource: { id: CAPTURE_ID, status: "DECLINED", custom_id: ORDER_ID },
  });
  const notices = () =>
    enqueue_mock.mock.calls.flat().filter((m: any) => m.id === "fiat-notice");

  it("fails the donation and alerts ops once, however often it is delivered", async () => {
    await seed_donation();

    const first = await deliver(denied_ev());
    const again = await deliver(denied_ev());

    expect([first.status, again.status]).toEqual([200, 200]);
    expect((await donation_get(ORDER_ID))!.status).toBe("failed");
    const [notice, ...rest] = notices();
    expect(rest).toEqual([]);
    expect(notice.payload.alert.title).toBe("PayPal Capture Denied");
    expect(notice.payload.alert.body).toContain(CAPTURE_ID);
  });

  // the queue drops a second message under a dedupe key it already holds;
  // that drop is the queue's and is mocked here, so this pins the key alone
  it("keys every delivery's denial notice to the capture", async () => {
    await seed_donation();

    const res = await Promise.all([deliver(denied_ev()), deliver(denied_ev())]);

    expect(res.map((r) => r.status)).toEqual([200, 200]);
    expect(send_alert_mock).not.toHaveBeenCalled();
    const keys = new Set(notices().map((m: any) => m.dedupe));
    expect([...keys]).toEqual([`fiat.notice_paypal-denied_${CAPTURE_ID}`]);
  });

  it("acknowledges and reports a denial naming no donation here", async () => {
    const res = await deliver(denied_ev());

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^not routable: /);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(send_alert_mock).not.toHaveBeenCalled();
  });

  it("leaves a settled donation settled", async () => {
    await seed_donation();
    await deliver(capture_ev());

    const res = await deliver(denied_ev());

    expect(res.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.status).toBe("settled");
  });
});

describe("PAYMENT.CAPTURE.PENDING", () => {
  it("reports why paypal is holding the capture and leaves the donation as it was", async () => {
    await seed_donation();

    const res = await deliver({
      event_type: "PAYMENT.CAPTURE.PENDING",
      resource: {
        id: CAPTURE_ID,
        status: "PENDING",
        custom_id: ORDER_ID,
        status_details: {
          reason: "RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION",
        },
      },
    });

    expect(res.status).toBe(200);
    expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: expect.stringContaining("pending") }),
      {
        capture_id: CAPTURE_ID,
        don_id: ORDER_ID,
        reason: "RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION",
      }
    );
    expect((await donation_get(ORDER_ID))!.status).toBe("intent");
  });
});

describe("CUSTOMER.DISPUTE.CREATED", () => {
  const dispute_ev = () => ({
    id: "WH-DSP-1",
    event_type: "CUSTOMER.DISPUTE.CREATED",
    resource_type: "dispute",
    resource: {
      dispute_id: "PP-D-1",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      dispute_amount: { currency_code: "USD", value: "100.00" },
      disputed_transactions: [
        {
          seller_transaction_id: CAPTURE_ID,
          buyer: { email: "buyer@example.com", name: "Bea Buyer" },
        },
      ],
    },
  });

  it("alerts ops once per event, naming the charge and leaving the payer out", async () => {
    const res = await deliver(dispute_ev());

    expect(res.status).toBe(200);
    const [notice] = enqueue_mock.mock.calls.at(-1)!;
    expect(notice).toMatchObject({
      id: "fiat-notice",
      dedupe: "fiat.notice_paypal-dispute_WH-DSP-1",
    });
    const { alert } = notice.payload;
    expect(alert).toMatchObject({
      title: "PayPal dispute opened · $100.00 to unknown nonprofit",
      fields: [
        { name: "Disputed", value: "100.00 USD" },
        { name: "Reason", value: "Merchandise or service not received" },
      ],
      note: "No donation was settled by this charge, so nothing is recorded as owed.",
      action: { text: "Respond in the PayPal Resolution Center." },
      context: [`dispute PP-D-1 · charge ${CAPTURE_ID} · event WH-DSP-1`],
    });
    expect(alert).not.toHaveProperty("table");
    const sent = JSON.stringify(alert);
    expect(sent).not.toContain("buyer@example.com");
    expect(sent).not.toContain("Bea Buyer");
  });

  it("leaves out what paypal left off", async () => {
    const res = await deliver({
      id: "WH-DSP-2",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {},
    });

    expect(res.status).toBe(200);
    const [notice] = enqueue_mock.mock.calls.at(-1)!;
    const { alert } = notice.payload;
    expect(JSON.stringify(alert)).not.toContain("undefined");
    expect(alert).toMatchObject({
      title: "PayPal dispute opened · unknown amount to unknown nonprofit",
      fields: [],
      context: ["event WH-DSP-2"],
    });
  });
});

describe("a dispute on a paid-grant $100 gift, on the real entry", () => {
  const DISPUTE_ID = "PP-D000-000-001";

  /** Jane Doe's settled paypal gift to Save the Kids on Sep 15: $90 granted
   * and paid out, $3.20 card fee. `payout` pending leaves the grant in the
   * npo's balances */
  const paypal_gift = async (payout: "settled" | "pending" = "settled") => {
    const gift = await seed_card_gift(db(), { ...PAID_GRANT, payout });
    const npo_id = gift.npo_ids[0]!;
    await db()
      .update(donations)
      .set({ via: "paypal", created_at: "2026-09-15T10:00:00.000Z" })
      .where(eq(donations.id, gift.id));
    await db()
      .update(npos)
      .set({ name: "Save the Kids" })
      .where(eq(npos.id, npo_id));
    await db()
      .update(donation_recipients)
      .set({ name: "Save the Kids" })
      .where(eq(donation_recipients.donation_id, gift.id));
    await db().insert(donation_donors).values({
      donation_id: gift.id,
      email: "jane@example.com",
      name: "Jane Doe",
    });
    return { ...gift, npo_id };
  };

  /** the alert's parties, named off the gift */
  const names_parties = (npo_id: number) => [
    expect.objectContaining({
      name: "Nonprofit",
      value: `Save the Kids (#${npo_id})`,
    }),
    expect.objectContaining({ name: "Donor", value: "Jane Doe" }),
  ];

  /** the dispute resource as paypal sends it on every dispute event */
  const dispute_resource = (
    charge: string,
    o: Record<string, unknown> = {}
  ) => ({
    dispute_id: DISPUTE_ID,
    create_time: "2026-10-01T12:00:00.000Z",
    update_time: "2026-10-01T12:00:00.000Z",
    disputed_transactions: [
      {
        seller_transaction_id: charge,
        transaction_status: "COMPLETED",
        gross_amount: { currency_code: "USD", value: "100.00" },
        seller: { merchant_id: "MERCHANT-1" },
        buyer: { name: "Bea Buyer" },
      },
    ],
    reason: "UNAUTHORISED",
    status: "OPEN",
    dispute_amount: { currency_code: "USD", value: "100.00" },
    dispute_life_cycle_stage: "CHARGEBACK",
    dispute_channel: "EXTERNAL",
    ...o,
  });

  const created_ev = (charge: string, o: Record<string, unknown> = {}) => ({
    id: "WH-DSP-CREATED",
    event_version: "1.0",
    create_time: "2026-10-01T12:00:05.000Z",
    resource_type: "dispute",
    event_type: "CUSTOMER.DISPUTE.CREATED",
    resource: dispute_resource(charge, o),
  });

  /** each owed row on any gift seeded, by the columns the tests read */
  const owed_rows = async () => {
    const gifts = await db().select({ id: donations.id }).from(donations);
    const rows = (
      await Promise.all(gifts.map((g) => owed_for_donation(g.id)))
    ).flat();
    return rows.map((o) => ({
      npo_id: o.npo_id,
      source: o.source,
      source_ref: o.source_ref,
      received_usd: o.received_usd,
      fee_processing_usd: o.fee_processing_usd,
      fee_dispute_usd: o.fee_dispute_usd,
      outstanding_usd: o.outstanding_usd,
    }));
  };

  beforeEach(() => {
    reverse_charge_mock.mockImplementation(real_reverse_charge);
  });

  it("records at filing what the npo received plus its card fee as owed, and the dispute open", async () => {
    const { id, sttl_id, npo_id } = await paypal_gift();

    const res = await deliver(created_ev(sttl_id));

    expect(res.status).toBe(200);
    expect(await owed_rows()).toEqual([
      {
        npo_id,
        source: "dispute",
        source_ref: DISPUTE_ID,
        received_usd: 90,
        fee_processing_usd: 3.2,
        fee_dispute_usd: 0,
        outstanding_usd: 93.2,
      },
    ]);
    expect(await disputes_of(db(), id)).toMatchObject([
      { id: DISPUTE_ID, status: "open", opened_at: "2026-10-01T12:00:00.000Z" },
    ]);
    expect((await donation_get(id))?.status).toBe("settled");
  });

  it("adds the chargeback fee paypal reports debiting the seller", async () => {
    const { sttl_id } = await paypal_gift();

    await deliver(
      created_ev(sttl_id, {
        fund_movements: [
          {
            party: "SELLER",
            type: "DEBIT",
            reason: "DISPUTE_SETTLEMENT",
            amount: { currency_code: "USD", value: "100.00" },
          },
          {
            party: "SELLER",
            type: "DEBIT",
            reason: "CHARGEBACK_FEE",
            amount: { currency_code: "USD", value: "20.00" },
          },
        ],
      })
    );

    expect(await owed_rows()).toMatchObject([
      { fee_dispute_usd: 20, outstanding_usd: 113.2 },
    ]);
  });

  it("records that share of what the npo received and its card fee for a dispute over $30 of the $100 capture", async () => {
    const { sttl_id } = await paypal_gift();

    await deliver(
      created_ev(sttl_id, {
        dispute_amount: { currency_code: "USD", value: "30.00" },
      })
    );

    expect(await owed_rows()).toMatchObject([
      { received_usd: 27, fee_processing_usd: 0.96, outstanding_usd: 27.96 },
    ]);
  });

  /** the ops notices the deliveries so far enqueued */
  const notices = () =>
    enqueue_mock.mock.calls
      .flat()
      .filter((m: any) => m.id === "fiat-notice")
      .map((m: any) => m.payload.alert);

  it("tells ops who the gift is from and to, what is recorded as owed, when to respond, and nothing of the payer", async () => {
    const { id, sttl_id, npo_id } = await paypal_gift();
    enqueue_mock.mockClear();

    await deliver(
      created_ev(sttl_id, { seller_response_due_date: "2026-10-21T07:00:00Z" })
    );

    expect(notices()).toEqual([
      expect.objectContaining({
        title: "PayPal dispute opened · $100.00 to Save the Kids",
      }),
    ]);
    const [alert] = notices();
    expect(alert.fields).toEqual([
      ...names_parties(npo_id),
      expect.objectContaining({
        name: "Disputed",
        value: "100.00 of 100.00 USD",
      }),
      expect.objectContaining({ name: "Reason", value: "Unauthorised" }),
      expect.objectContaining({ name: "Donated", value: "Sep 15, 2026" }),
      expect.objectContaining({
        name: "Respond by",
        value: "Oct 21, 2026, 07:00 UTC",
      }),
    ]);
    expect(alert.table.rows).toEqual([
      [`Save the Kids (#${npo_id})`, "90.00", "3.20", "0.00", "93.20"],
      ["Total", "—", "—", "—", "93.20"],
    ]);
    expect(alert.note).toContain("PayPal reported no chargeback fee.");
    expect(alert.action.text).toBe(
      "Respond in the PayPal Resolution Center by Oct 21, 2026, 07:00 UTC."
    );
    expect(alert.context).toEqual([
      `donation ${id} · dispute ${DISPUTE_ID} · charge ${sttl_id} · event WH-DSP-CREATED`,
    ]);
    expect(JSON.stringify(alert)).not.toContain("Bea Buyer");
  });

  it("names no respond-by date paypal didn't send", async () => {
    const { sttl_id } = await paypal_gift();
    enqueue_mock.mockClear();

    await deliver(created_ev(sttl_id));

    const [alert] = notices();
    expect(alert.fields.map((f: { name: string }) => f.name)).not.toContain(
      "Respond by"
    );
    expect(alert.action.text).toBe("Respond in the PayPal Resolution Center.");
  });

  describe("the opened alert, for a $6 gift to Save the Kids", () => {
    const DON = "98bc019c-3f2a-4d1e-9b7c-5e0a1f2d3c4b";
    const CHARGE = "8MC02395TT1228219";
    const EV = "WH-5GV39823K0583441R-0BC27474SJ0418034";

    /** Jane Doe's $6 gift on Nov 20, settled to npo #4: $4.40 granted and
     * paid out, $0.51 card fee */
    const seed_example = async () => {
      // npos.id is GENERATED ALWAYS: the example's #4 needs the override
      await db().execute(
        sql`insert into npos (id, registration_number, name, endow_designation, overview_pt, hq_country, published, active) overriding system value values (4, 'EIN-SAVE-THE-KIDS', 'Save the Kids', 'Charity', '[]', 'United States', true, true)`
      );
      await db().insert(donations).values({
        id: DON,
        upusd: 1,
        status: "settled",
        amount_base: 6,
        amount_tip: 0,
        amount_fee_allowance: 0,
        currency: "USD",
        frequency: "one-time",
        source: "bg-marketplace",
        via: "paypal",
        created_at: "2026-11-20T15:04:00.000Z",
      });
      await db().insert(donation_settlements).values({
        donation_id: DON,
        sttl_id: CHARGE,
        date: "2026-11-20T15:05:00.000Z",
        currency: "USD",
        net: 5.49,
        fee: 0.51,
      });
      await db()
        .insert(dists)
        .values({
          id: `dist-${DON}`,
          donation_id: DON,
          status: "settled",
          date_created: "2026-11-20T15:05:00.000Z",
          to_id: 4,
          to_name: "Save the Kids",
          amount: 6,
          amount_usd: 6,
          amount_denom: "USD",
          net: 4.4,
          fee_base: 1.09,
          fee_fsa: 0,
          fee_processing: 0.51,
          alloc: { liq: 0, lock: 0, cash: 100 },
        });
      await db()
        .insert(payouts)
        .values({
          id: `payout-dist-${DON}`,
          source_id: `dist-${DON}`,
          npo_id: 4,
          source: "donation",
          date: "2026-11-21T00:00:00.000Z",
          amount: 4.4,
          type: "settled",
          settled_date: "2026-11-22T00:00:00.000Z",
        });
      await db().insert(donation_recipients).values({
        donation_id: DON,
        npo_id: 4,
        name: "Save the Kids",
        type: "npo",
      });
      await db().insert(donation_donors).values({
        donation_id: DON,
        email: "jane@example.com",
        name: "Jane Doe",
      });
    };

    it("is every part of the alert, built from the donation and the dispute", async () => {
      await seed_example();
      enqueue_mock.mockClear();

      await deliver({
        ...created_ev(CHARGE, {
          dispute_id: "PP-R-YCD-654975725",
          dispute_amount: { currency_code: "USD", value: "6.00" },
          seller_response_due_date: "2026-12-10T23:59:59.000Z",
          disputed_transactions: [
            {
              seller_transaction_id: CHARGE,
              gross_amount: { currency_code: "USD", value: "6.00" },
              buyer: { name: "Bea Buyer" },
            },
          ],
        }),
        id: EV,
      });

      expect(notices()).toEqual([
        {
          type: "NOTICE",
          from: "paypal-webhook-production",
          title: "PayPal dispute opened · $6.00 to Save the Kids",
          summary: "PayPal dispute opened: $6.00 to Save the Kids",
          fields: [
            {
              name: "Nonprofit",
              value: "Save the Kids (#4)",
              inline: true,
              url: "https://www.better.giving/admin/4",
            },
            { name: "Donor", value: "Jane Doe", inline: true },
            { name: "Disputed", value: "6.00 of 6.00 USD", inline: true },
            { name: "Reason", value: "Unauthorised", inline: true },
            { name: "Donated", value: "Nov 20, 2026", inline: true },
            {
              name: "Respond by",
              value: "Dec 10, 2026, 23:59 UTC",
              inline: true,
            },
          ],
          table: {
            columns: [
              { name: "Party" },
              { name: "Received (USD)", align: "right" },
              { name: "Card fee (USD)", align: "right" },
              { name: "Dispute fee (USD)", align: "right" },
              { name: "Owed (USD)", align: "right" },
            ],
            rows: [
              ["Save the Kids (#4)", "4.40", "0.51", "0.00", "4.91"],
              ["Total", "—", "—", "—", "4.91"],
            ],
          },
          note: "PayPal reported no chargeback fee.\nDonation stays settled until a chargeback reverses it; what's owed comes out of next grants and is credited back if we win.",
          action: {
            text: "Respond in the PayPal Resolution Center by Dec 10, 2026, 23:59 UTC.",
            url: "https://www.paypal.com/resolutioncenter/",
          },
          context: [
            `donation 98bc019c… · dispute PP-R-YCD-654975725 · charge ${CHARGE} · event ${EV}`,
          ],
        },
      ]);
    });
  });

  it.each([
    ["the whole charge", "100.00", "settled until a chargeback reverses it"],
    ["$30 of it", "30.00", "settled even if PayPal charges this part back"],
  ])("tells ops what a reversal of %s will do", async (_, value, says) => {
    const { sttl_id } = await paypal_gift();
    enqueue_mock.mockClear();

    await deliver(
      created_ev(sttl_id, {
        dispute_amount: { currency_code: "USD", value },
      })
    );

    expect(notices()[0].note).toContain(`Donation stays ${says};`);
  });

  it("changes nothing further on a redelivered filing, and tells ops nothing again", async () => {
    const { sttl_id } = await paypal_gift();
    await deliver(created_ev(sttl_id));
    const recorded = await owed_rows();
    enqueue_mock.mockClear();

    const res = await deliver(created_ev(sttl_id));

    expect(res.status).toBe(200);
    expect(await owed_rows()).toEqual(recorded);
    expect(notices()).toEqual([]);
  });

  /** paypal's chargeback of the whole capture: a refund resource, its
   * amount negative */
  const reversed_ev = (charge: string) => ({
    id: "WH-REVERSED-1",
    event_version: "1.0",
    create_time: "2026-10-01T12:00:10.000Z",
    resource_type: "refund",
    event_type: "PAYMENT.CAPTURE.REVERSED",
    resource: {
      id: "REV-1",
      status: "COMPLETED",
      amount: { value: "-100.00", currency_code: "USD" },
      links: [
        {
          rel: "up",
          method: "GET",
          href: `https://api.paypal.com/v2/payments/captures/${charge}`,
        },
      ],
    },
  });

  /** what the npo has given back so far: what left its balances, plus what
   * it owes */
  const npo_debit = async (npo_id: number, before: number) => {
    const [row] = await owed_rows();
    return (
      before - (await balance_of(db(), npo_id)) + (row?.outstanding_usd ?? 0)
    );
  };

  const deliver_in = async (sttl_id: string, order: readonly string[]) => {
    for (const e of order) {
      const res = await deliver(
        e === "created" ? created_ev(sttl_id) : reversed_ev(sttl_id)
      );
      expect(res.status).toBe(200);
    }
  };

  it.each([
    ["filed first", ["created", "reversed"]],
    ["reversed first", ["reversed", "created"]],
  ] as const)(
    "%s, owes the npo's $93.20 once, reverses the gift and books no loss",
    async (_, order) => {
      const { id, sttl_id, npo_id } = await paypal_gift();

      await deliver_in(sttl_id, order);

      expect(await owed_rows()).toMatchObject([
        {
          npo_id,
          received_usd: 90,
          fee_processing_usd: 3.2,
          outstanding_usd: 93.2,
        },
      ]);
      expect((await donation_get(id))?.status).toBe("refunded_loss");
      expect((await loss_log_list({ limit: 100 })).items).toEqual([]);
    }
  );

  it("filed after paypal reversed the gift, tells ops it is on record and nothing more is owed", async () => {
    const { sttl_id } = await paypal_gift();
    await deliver(reversed_ev(sttl_id));
    enqueue_mock.mockClear();

    await deliver(created_ev(sttl_id));

    expect(notices()).toEqual([
      expect.objectContaining({
        title: "PayPal dispute opened · $100.00 to Save the Kids",
        note: "The donation was already refunded_loss, so nothing more is recorded as owed.",
      }),
    ]);
    expect(notices()[0]).not.toHaveProperty("table");
  });

  it("filed with the grant still in the npo's balances, then reversed, debits the npo its $93.20 once", async () => {
    const { sttl_id, npo_id } = await paypal_gift("pending");
    const before = await balance_of(db(), npo_id);

    await deliver_in(sttl_id, ["created", "reversed"]);

    expect(await npo_debit(npo_id, before)).toBeCloseTo(93.2, 10);
    expect((await loss_log_list({ limit: 100 })).items).toEqual([]);
  });

  const resolved_ev = (
    charge: string,
    outcome_code: string,
    o: Record<string, unknown> = {}
  ) => ({
    id: `WH-DSP-RESOLVED-${outcome_code}`,
    event_version: "1.0",
    create_time: "2026-11-01T12:00:05.000Z",
    resource_type: "dispute",
    event_type: "CUSTOMER.DISPUTE.RESOLVED",
    resource: dispute_resource(charge, {
      update_time: "2026-11-01T12:00:00.000Z",
      status: "RESOLVED",
      dispute_outcome: { outcome_code },
      ...o,
    }),
  });

  describe("a second dispute on the payment, the first closed with no decision", () => {
    const SECOND = "PP-D000-000-002";
    /** the first dispute filed, then closed NONE and the second filed, in
     * `order` */
    const second_filed = async (order: "none first" | "second first") => {
      const gift = await paypal_gift();
      await deliver(created_ev(gift.sttl_id));
      const none = resolved_ev(gift.sttl_id, "NONE");
      const second = created_ev(gift.sttl_id, { dispute_id: SECOND });
      for (const ev of order === "none first" ? [none, second] : [second, none])
        await deliver(ev);
      enqueue_mock.mockClear();
      return gift;
    };

    it("closed NONE, undoes the first's take, tells ops nothing, and changes nothing on redelivery", async () => {
      const { sttl_id } = await paypal_gift();
      await deliver(created_ev(sttl_id));
      enqueue_mock.mockClear();

      const none = resolved_ev(sttl_id, "NONE");
      await deliver(none);
      const closed = await owed_rows();
      const entries = await db().select().from(owed_entries);
      const res = await deliver(none);

      expect(res.status).toBe(200);
      expect(closed).toMatchObject([{ outstanding_usd: 0 }]);
      expect(await owed_rows()).toEqual(closed);
      expect(await db().select().from(owed_entries)).toEqual(entries);
      expect(notices()).toEqual([]);
    });

    it.each(["none first", "second first"] as const)(
      "%s, the second owes the whole charge, and its win leaves nothing owed",
      async (order) => {
        const { sttl_id } = await second_filed(order);
        const filed = await owed_rows();

        await deliver(
          resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR", {
            dispute_id: SECOND,
          })
        );

        expect(filed).toMatchObject([{ outstanding_usd: 93.2 }]);
        expect(await owed_rows()).toMatchObject([{ outstanding_usd: 0 }]);
        expect(notices()).toEqual([]);
      }
    );
  });

  /** paypal's refund of `value` off the capture, `total` refunded to date */
  const refunded_ev = (
    charge: string,
    id: string,
    value: string,
    total: string
  ) => ({
    id: `WH-${id}`,
    event_version: "1.0",
    create_time: "2026-10-01T11:00:00.000Z",
    resource_type: "refund",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: {
      id,
      status: "COMPLETED",
      amount: { value, currency_code: "USD" },
      seller_payable_breakdown: {
        total_refunded_amount: { value: total, currency_code: "USD" },
      },
      links: [
        {
          rel: "up",
          method: "GET",
          href: `https://api.paypal.com/v2/payments/captures/${charge}`,
        },
      ],
    },
  });

  /** paypal's copy of the capture, `refunds` taken off it before */
  const capture_refunded = (charge: string, refunds: [string, string][]) => {
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      id: charge,
      status: "PARTIALLY_REFUNDED",
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });
    get_order_mock.mockResolvedValue({
      id: "ORDER-1",
      purchase_units: [
        {
          payments: {
            captures: [{ id: charge }],
            refunds: refunds.map(([id, value]) => ({
              id,
              status: "COMPLETED",
              amount: { value, currency_code: "USD" },
            })),
          },
        },
      ],
    });
  };

  it("a $30 refund, then a dispute over the other $70 won, leaves the refund's share owed", async () => {
    const { sttl_id } = await paypal_gift();
    capture_refunded(sttl_id, [["REF-30", "30.00"]]);
    await deliver(refunded_ev(sttl_id, "REF-30", "30.00", "30.00"));

    await deliver(
      created_ev(sttl_id, {
        dispute_amount: { currency_code: "USD", value: "70.00" },
      })
    );
    const filed = await owed_rows();
    await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

    expect(filed).toMatchObject([{ outstanding_usd: 93.2 }]);
    expect(await owed_rows()).toMatchObject([
      { received_usd: 90, outstanding_usd: 27.96 },
    ]);
  });

  it.each(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"])(
    "a $30 dispute won, then %s of $40, owes the $40's share",
    async (event_type) => {
      const { sttl_id } = await paypal_gift();
      await deliver(
        created_ev(sttl_id, {
          dispute_amount: { currency_code: "USD", value: "30.00" },
        })
      );
      await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));
      const ev = refunded_ev(sttl_id, "REF-40", "40.00", "40.00");

      const res = await deliver(
        event_type === "PAYMENT.CAPTURE.REFUNDED"
          ? ev
          : {
              ...ev,
              event_type,
              resource: {
                ...ev.resource,
                amount: { value: "-40.00", currency_code: "USD" },
              },
            }
      );

      expect(res.status).toBe(200);
      expect(await owed_rows()).toMatchObject([{ outstanding_usd: 37.28 }]);
    }
  );

  it("a $30 chargeback won before paypal delivers its filing credits it back, and the late filing records nothing", async () => {
    const { sttl_id } = await paypal_gift();
    const ev = refunded_ev(sttl_id, "REV-30", "30.00", "30.00");
    await deliver({
      ...ev,
      event_type: "PAYMENT.CAPTURE.REVERSED",
      resource: {
        ...ev.resource,
        amount: { value: "-30.00", currency_code: "USD" },
      },
    });
    const reversed = await owed_rows();
    const thirty = { dispute_amount: { currency_code: "USD", value: "30.00" } };

    await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR", thirty));
    await deliver(created_ev(sttl_id, thirty));

    expect(reversed).toMatchObject([{ outstanding_usd: 27.96 }]);
    expect(await owed_rows()).toMatchObject([{ outstanding_usd: 0 }]);
  });

  it("resolved NONE after a refund and a dispute grew the refund's row, undoes the dispute's take and tells ops nothing", async () => {
    const { sttl_id } = await paypal_gift();
    capture_refunded(sttl_id, [["REF-30", "30.00"]]);
    await deliver(refunded_ev(sttl_id, "REF-30", "30.00", "30.00"));
    await deliver(
      created_ev(sttl_id, {
        dispute_amount: { currency_code: "USD", value: "70.00" },
      })
    );
    enqueue_mock.mockClear();

    await deliver(resolved_ev(sttl_id, "NONE"));

    expect(await owed_rows()).toMatchObject([{ outstanding_usd: 27.96 }]);
    expect(notices()).toEqual([]);
  });

  it("resolved NONE on a dispute that recorded nothing, tells ops nothing", async () => {
    const { sttl_id } = await paypal_gift();
    capture_refunded(sttl_id, [["REF-30", "30.00"]]);
    await deliver(refunded_ev(sttl_id, "REF-30", "30.00", "30.00"));
    enqueue_mock.mockClear();

    await deliver(resolved_ev(sttl_id, "NONE"));

    expect(notices()).toEqual([]);
  });

  /** paypal's chargeback of `value` off the capture */
  const chargeback_ev = (charge: string, value: string) => {
    const ev = reversed_ev(charge);
    return {
      ...ev,
      resource: {
        ...ev.resource,
        amount: { value: `-${value}`, currency_code: "USD" },
      },
    };
  };

  /** dispute `dispute_id` filed over `value`, charged back and lost */
  const lost_dispute = async (
    charge: string,
    dispute_id: string,
    value: string
  ) => {
    await deliver(
      created_ev(charge, {
        dispute_id,
        dispute_amount: { currency_code: "USD", value },
        // filed after any refund already delivered: a dispute of its own,
        // not the claim that refund paid
        create_time: new Date().toISOString(),
      })
    );
    await deliver(chargeback_ev(charge, value));
    await deliver(resolved_ev(charge, "RESOLVED_BUYER_FAVOUR", { dispute_id }));
  };

  it("a $30 refund, then a $70 dispute whose order paypal refuses to show, won, leaves the refund's share owed", async () => {
    const { sttl_id } = await paypal_gift();
    capture_refunded(sttl_id, [["REF-30", "30.00"]]);
    await deliver(refunded_ev(sttl_id, "REF-30", "30.00", "30.00"));
    get_order_mock.mockRejectedValue(
      new PayPalApiError("get order", 403, '{"name":"NOT_AUTHORIZED"}')
    );

    await deliver(
      created_ev(sttl_id, {
        dispute_amount: { currency_code: "USD", value: "70.00" },
      })
    );
    await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

    expect(await owed_rows()).toMatchObject([{ outstanding_usd: 27.96 }]);
  });

  it("a $30 refund, then a dispute paypal states no amount for, owes the whole charge and a win leaves the refund's share", async () => {
    const { sttl_id } = await paypal_gift();
    capture_refunded(sttl_id, [["REF-30", "30.00"]]);
    await deliver(refunded_ev(sttl_id, "REF-30", "30.00", "30.00"));

    await deliver(created_ev(sttl_id, { dispute_amount: undefined }));
    const filed = await owed_rows();
    await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

    expect(filed).toMatchObject([{ outstanding_usd: 93.2 }]);
    expect(await owed_rows()).toMatchObject([{ outstanding_usd: 27.96 }]);
  });

  it("a $40 dispute lost, then a refund of the other $60, reverses the gift owing the npo's whole $93.20", async () => {
    const { id, sttl_id } = await paypal_gift();
    await lost_dispute(sttl_id, DISPUTE_ID, "40.00");
    capture_refunded(sttl_id, [["REF-60", "60.00"]]);

    const res = await deliver(refunded_ev(sttl_id, "REF-60", "60.00", "60.00"));

    expect(res.status).toBe(200);
    expect(await owed_rows()).toMatchObject([{ outstanding_usd: 93.2 }]);
    expect((await donation_get(id))?.status).toBe("refunded_loss");
  });

  it("a $30 dispute lost, then a $20 refund, records half the charge", async () => {
    const { id, sttl_id } = await paypal_gift();
    await lost_dispute(sttl_id, DISPUTE_ID, "30.00");
    capture_refunded(sttl_id, [["REF-20", "20.00"]]);

    await deliver(refunded_ev(sttl_id, "REF-20", "20.00", "20.00"));

    expect(await owed_rows()).toMatchObject([
      { received_usd: 45, fee_processing_usd: 1.6, outstanding_usd: 46.6 },
    ]);
    expect((await donation_get(id))?.status).toBe("settled");
  });

  it("T1: a $10 refund, a $30 dispute lost, then a $60 dispute won, leaves the $40 taken owed", async () => {
    const { sttl_id } = await paypal_gift();
    capture_refunded(sttl_id, [["REF-10", "10.00"]]);
    await deliver(refunded_ev(sttl_id, "REF-10", "10.00", "10.00"));
    await lost_dispute(sttl_id, "PP-D0", "30.00");
    get_order_mock.mockRejectedValue(
      new PayPalApiError("get order", 403, '{"name":"NOT_AUTHORIZED"}')
    );

    await deliver(
      created_ev(sttl_id, {
        dispute_amount: { currency_code: "USD", value: "60.00" },
      })
    );
    await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

    expect(await owed_rows()).toMatchObject([{ outstanding_usd: 37.28 }]);
  });

  it("T2: a $30 refund, a $30 dispute lost, then a refund of the last $40, reverses the gift owing $93.20", async () => {
    const { id, sttl_id } = await paypal_gift();
    capture_refunded(sttl_id, [["REF-30", "30.00"]]);
    await deliver(refunded_ev(sttl_id, "REF-30", "30.00", "30.00"));
    await lost_dispute(sttl_id, "PP-D0", "30.00");
    capture_refunded(sttl_id, [
      ["REF-30", "30.00"],
      ["REF-40", "40.00"],
    ]);

    await deliver(refunded_ev(sttl_id, "REF-40", "40.00", "70.00"));

    expect(await owed_rows()).toMatchObject([{ outstanding_usd: 93.2 }]);
    expect((await donation_get(id))?.status).toBe("refunded_loss");
  });

  it.each([
    ["the order read", false],
    ["the order refused", true],
  ])(
    "T3: on a grant still pending, a $30 refund then a $70 dispute, %s, owes the dispute's own $65.24",
    async (_, refused) => {
      const { sttl_id } = await paypal_gift("pending");
      capture_refunded(sttl_id, [["REF-30", "30.00"]]);
      await deliver(refunded_ev(sttl_id, "REF-30", "30.00", "30.00"));
      if (refused) {
        get_order_mock.mockRejectedValue(
          new PayPalApiError("get order", 403, '{"name":"NOT_AUTHORIZED"}')
        );
      }

      await deliver(
        created_ev(sttl_id, {
          dispute_amount: { currency_code: "USD", value: "70.00" },
        })
      );

      expect(await owed_rows()).toMatchObject([
        { received_usd: 63, fee_processing_usd: 2.24, outstanding_usd: 65.24 },
      ]);
    }
  );

  it.each([
    ["30.00", 27.96],
    ["50.00", 46.6],
  ])(
    "T4: a $%s refund, then a dispute over the same amount won, leaves the refund's share to the cent",
    async (value, left) => {
      const { sttl_id } = await paypal_gift();
      capture_refunded(sttl_id, [["REF-1", value]]);
      await deliver(refunded_ev(sttl_id, "REF-1", value, value));
      get_order_mock.mockRejectedValue(
        new PayPalApiError("get order", 403, '{"name":"NOT_AUTHORIZED"}')
      );

      await deliver(
        created_ev(sttl_id, {
          dispute_amount: { currency_code: "USD", value },
        })
      );
      await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

      expect(await owed_rows()).toMatchObject([{ outstanding_usd: left }]);
    }
  );

  it("T5: a $30 dispute lost, then a $70 dispute won, leaves the lost $30's share", async () => {
    const { sttl_id } = await paypal_gift();
    await lost_dispute(sttl_id, "PP-D0", "30.00");

    await deliver(
      created_ev(sttl_id, {
        dispute_amount: { currency_code: "USD", value: "70.00" },
      })
    );
    await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

    expect(await owed_rows()).toMatchObject([{ outstanding_usd: 27.96 }]);
  });

  it("won with no filing on record while a refund's share is owed, tells ops once that nothing was credited", async () => {
    const { sttl_id, npo_id } = await paypal_gift();
    capture_refunded(sttl_id, [["REF-40", "40.00"]]);
    await deliver(refunded_ev(sttl_id, "REF-40", "40.00", "40.00"));
    const owed = await owed_rows();
    enqueue_mock.mockClear();

    const won = resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR");
    await deliver(won);
    const res = await deliver(won);

    expect(res.status).toBe(200);
    expect(await owed_rows()).toEqual(owed);
    expect(notices()).toEqual([
      expect.objectContaining({
        title:
          "PayPal dispute won, nothing credited · $100.00 to Save the Kids",
      }),
    ]);
    const [alert] = notices();
    expect(alert.fields).toEqual(expect.arrayContaining(names_parties(npo_id)));
    expect(alert.table.rows).toEqual([
      [`Save the Kids (#${npo_id})`, "36.00", "1.28", "0.00", "37.28"],
      ["Total", "—", "—", "—", "37.28"],
    ]);
    expect(alert.note).toContain("credit it by hand on Amounts owed");
    expect(alert).not.toHaveProperty("action");
  });

  it("credits what the filing recorded back to nothing outstanding on a seller win", async () => {
    const { id, sttl_id } = await paypal_gift();
    await deliver(created_ev(sttl_id));

    const res = await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

    expect(res.status).toBe(200);
    expect(await owed_rows()).toMatchObject([
      { received_usd: 90, outstanding_usd: 0 },
    ]);
    expect(await disputes_of(db(), id)).toMatchObject([
      { id: DISPUTE_ID, status: "won", closed_at: "2026-11-01T12:00:00.000Z" },
    ]);
    expect((await donation_get(id))?.status).toBe("settled");
  });

  it("won after paypal reversed the gift, tells ops once to restore it by hand", async () => {
    const { id, sttl_id, npo_id } = await paypal_gift();
    await deliver_in(sttl_id, ["created", "reversed"]);
    const owed = await owed_rows();
    enqueue_mock.mockClear();

    await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));
    const res = await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

    expect(res.status).toBe(200);
    expect(notices()).toEqual([
      expect.objectContaining({
        title:
          "PayPal dispute won on a reversed donation · $100.00 to Save the Kids",
      }),
    ]);
    const [alert] = notices();
    expect(alert.fields).toEqual(expect.arrayContaining(names_parties(npo_id)));
    expect(alert.context[0]).toContain(`donation ${id}`);
    expect(alert.note).toContain("already refunded_loss");
    expect(alert.note).toContain("by hand");
    expect(alert).not.toHaveProperty("table");
    expect(await owed_rows()).toEqual(owed);
  });

  it.each(["CANCELED_BY_BUYER", "DENIED", "RESOLVED_WITH_PAYOUT"])(
    "credits what the filing recorded back to nothing outstanding when resolved %s, the money kept",
    async (outcome) => {
      const { id, sttl_id } = await paypal_gift();
      await deliver(created_ev(sttl_id));

      const res = await deliver(resolved_ev(sttl_id, outcome));

      expect(res.status).toBe(200);
      expect(await owed_rows()).toMatchObject([
        { received_usd: 90, outstanding_usd: 0 },
      ]);
      expect((await donation_get(id))?.status).toBe("settled");
    }
  );

  it("changes nothing further on a redelivered resolution that credited back", async () => {
    const { sttl_id } = await paypal_gift();
    await deliver(created_ev(sttl_id));
    await deliver(resolved_ev(sttl_id, "CANCELED_BY_BUYER"));
    const credited = await owed_rows();
    const entries = await db().select().from(owed_entries);
    enqueue_mock.mockClear();

    const res = await deliver(resolved_ev(sttl_id, "CANCELED_BY_BUYER"));

    expect(res.status).toBe(200);
    expect(await owed_rows()).toEqual(credited);
    expect(await db().select().from(owed_entries)).toEqual(entries);
    expect(notices()).toEqual([]);
  });

  it.each([
    [
      "an outcome it doesn't know",
      { outcome_code: "SOMETHING_NEW" },
      "SOMETHING_NEW",
    ],
    ["no outcome", undefined, "with no outcome"],
  ])(
    "resolved with %s, keeps what is owed and tells ops to settle it by hand",
    async (_, dispute_outcome, says) => {
      const { sttl_id, npo_id } = await paypal_gift();
      await deliver(created_ev(sttl_id));
      const owed = await owed_rows();
      enqueue_mock.mockClear();

      const res = await deliver(
        resolved_ev(sttl_id, "UNUSED", { dispute_outcome })
      );

      expect(res.status).toBe(200);
      expect(await owed_rows()).toEqual(owed);
      expect(notices()).toEqual([
        expect.objectContaining({
          title: "PayPal dispute resolved · $100.00 to Save the Kids",
        }),
      ]);
      const [alert] = notices();
      expect(alert.fields).toEqual(
        expect.arrayContaining(names_parties(npo_id))
      );
      expect(alert.table.rows).toEqual([
        [`Save the Kids (#${npo_id})`, "90.00", "3.20", "0.00", "93.20"],
        ["Total", "—", "—", "—", "93.20"],
      ]);
      expect(alert.note).toContain(`Resolved ${says}`);
      expect(alert).not.toHaveProperty("action");
    }
  );

  it("reports a win it can't credit, on a charge settling a gift paid on another rail, and acknowledges it", async () => {
    const { sttl_id } = await seed_card_gift(db(), PAID_GRANT);

    const res = await deliver(resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR"));

    expect(res.status).toBe(200);
    expect(report_error_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("wrong_rail"),
      }),
      expect.objectContaining({ dispute_id: DISPUTE_ID })
    );
  });

  it("resolved RESOLVED_BUYER_FAVOUR, records the dispute lost, leaves the reversal to paypal's own event and tells ops nothing", async () => {
    const { id, sttl_id } = await paypal_gift();
    await deliver(created_ev(sttl_id));
    const owed = await owed_rows();
    enqueue_mock.mockClear();

    const res = await deliver(resolved_ev(sttl_id, "RESOLVED_BUYER_FAVOUR"));

    expect(res.status).toBe(200);
    expect(await owed_rows()).toEqual(owed);
    expect(await disputes_of(db(), id)).toMatchObject([
      { id: DISPUTE_ID, status: "lost", closed_at: "2026-11-01T12:00:00.000Z" },
    ]);
    expect(notices()).toEqual([]);
  });

  describe("an outcome after another was recorded, the first standing", () => {
    const APPEAL = "2026-11-05T12:00:00.000Z";
    const thirty = { dispute_amount: { currency_code: "USD", value: "30.00" } };
    const won_ev = (sttl_id: string, at?: string) =>
      resolved_ev(sttl_id, "RESOLVED_SELLER_FAVOUR", {
        ...thirty,
        // paypal may keep sending the old deadline: only an opened alert shows it
        seller_response_due_date: "2026-10-21T07:00:00Z",
        ...(at && { update_time: at }),
      });
    const lost_ev = (sttl_id: string, at?: string) =>
      resolved_ev(sttl_id, "RESOLVED_BUYER_FAVOUR", {
        ...thirty,
        ...(at && { update_time: at }),
      });
    /** paypal's REVERSED of the dispute's $30 */
    const reversed_thirty = (sttl_id: string) => {
      const ev = refunded_ev(sttl_id, "REV-30", "30.00", "30.00");
      return {
        ...ev,
        event_type: "PAYMENT.CAPTURE.REVERSED",
        resource: {
          ...ev.resource,
          amount: { value: "-30.00", currency_code: "USD" },
        },
      };
    };
    /** the ops alerts of an outcome that changed, by their dedupe id */
    const changed = () =>
      enqueue_mock.mock.calls
        .flat()
        .filter(
          (m: any) =>
            m.id === "fiat-notice" &&
            m.payload.alert.title.startsWith("PayPal dispute outcome changed")
        )
        .map((m: any) => ({ id: m.payload.id, alert: m.payload.alert }));

    it("won after it was lost, credits nothing, keeps its chargeback owed once, and tells ops per event", async () => {
      const { id, sttl_id, npo_id } = await paypal_gift();
      await deliver(created_ev(sttl_id, thirty));
      await deliver(lost_ev(sttl_id));
      expect(await owed_rows()).toMatchObject([{ outstanding_usd: 27.96 }]);

      await deliver(won_ev(sttl_id, APPEAL));
      await deliver(won_ev(sttl_id, APPEAL));
      await deliver(reversed_thirty(sttl_id));
      await deliver(reversed_thirty(sttl_id));

      expect(await owed_rows()).toMatchObject([{ outstanding_usd: 27.96 }]);
      expect(await disputes_of(db(), id)).toMatchObject([
        { id: DISPUTE_ID, status: "lost" },
      ]);
      const alerts = changed();
      expect(new Set(alerts.map((a) => a.id)).size).toBe(1);
      expect(alerts[0]!.alert).toMatchObject({
        title: "PayPal dispute outcome changed · $30.00 to Save the Kids",
        fields: expect.arrayContaining(names_parties(npo_id)),
        note: "Won after it was recorded lost. The chargeback stays owed; credit it by hand if PayPal returned the money.",
      });
      expect(alerts[0]!.alert).not.toHaveProperty("table");
      expect(
        alerts[0]!.alert.fields.map((f: { name: string }) => f.name)
      ).not.toContain("Respond by");
    });

    it("lost on appeal after it was won, re-owes nothing, stays won, and tells ops", async () => {
      const { id, sttl_id } = await paypal_gift();
      await deliver(created_ev(sttl_id, thirty));
      await deliver(won_ev(sttl_id));
      expect(await owed_rows()).toMatchObject([{ outstanding_usd: 0 }]);

      await deliver(lost_ev(sttl_id, APPEAL));
      await deliver(lost_ev(sttl_id, APPEAL));

      expect(await owed_rows()).toMatchObject([{ outstanding_usd: 0 }]);
      expect(await disputes_of(db(), id)).toMatchObject([
        { id: DISPUTE_ID, status: "won" },
      ]);
      const alerts = changed();
      expect(new Set(alerts.map((a) => a.id)).size).toBe(1);
      expect(alerts[0]!.alert.note).toBe(
        "Lost on appeal after it was recorded won. Nothing is owed again; recover it by hand."
      );
    });
  });

  // an accepted claim is paid through a refund, which is its own take
  it("resolved ACCEPTED, records the dispute accepted and credits its part back for the refund that pays it to record again", async () => {
    const { id, sttl_id } = await paypal_gift();
    await deliver(created_ev(sttl_id));
    const owed = await owed_rows();
    enqueue_mock.mockClear();

    const res = await deliver(resolved_ev(sttl_id, "ACCEPTED"));

    expect(res.status).toBe(200);
    expect(await disputes_of(db(), id)).toMatchObject([
      {
        id: DISPUTE_ID,
        status: "accepted",
        closed_at: "2026-11-01T12:00:00.000Z",
      },
    ]);
    expect(await owed_rows()).toMatchObject([
      { received_usd: 90, outstanding_usd: 0 },
    ]);
    expect(notices()).toEqual([]);

    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      id: sttl_id,
      status: "REFUNDED",
    });
    await deliver(refunded_ev(sttl_id, "REF-ACC", "100.00", "100.00"));

    // the credit back stays on the row, so its figures carry it twice
    expect(await owed_rows()).toMatchObject(
      owed.map(({ outstanding_usd }) => ({ outstanding_usd }))
    );
    expect((await donation_get(id))?.status).toBe("refunded_loss");
  });
});

// the route caches each cert by url for the life of the module, so a case that
// needs the download to run takes a url no other case has fetched
describe("signature verification", () => {
  it("reports paypal's cert host erroring as degraded, naming the delivery, then settles the redelivery", async () => {
    await seed_donation();
    const ev = { ...capture_ev(), id: "WH-5XX" };
    const cert_url = { "paypal-cert-url": `${CERT_URL}-5xx` };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("unavailable", { status: 503 })
    );

    const down = await deliver(ev, cert_url);

    expect(down.status).toBe(503);
    expect(await down.text()).toBe("signature unverifiable");
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "CertHostUnreachable",
        message:
          "[paypal webhook] cert host api.sandbox.paypal.com answered 503",
      }),
      {
        unverified: {
          transmission_id: "t-1",
          event_id: "WH-5XX",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          cert_host: "api.sandbox.paypal.com",
        },
      }
    );
    expect(await settlements()).toHaveLength(0);

    const redelivered = await deliver(ev, cert_url);

    expect(redelivered.status).toBe(200);
    expect(await settlements()).toHaveLength(1);
  });

  it("reports paypal's cert host rate-limiting as degraded, and asks for redelivery", async () => {
    await seed_donation();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("slow down", { status: 429 })
    );

    const res = await deliver(capture_ev(), {
      "paypal-cert-url": `${CERT_URL}-429`,
    });

    expect(res.status).toBe(503);
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "CertHostUnreachable",
        message:
          "[paypal webhook] cert host api.sandbox.paypal.com answered 429",
      }),
      { unverified: expect.objectContaining({ transmission_id: "t-1" }) }
    );
  });

  // a 4xx is not the host shedding load, so it is triaged as a bug; the 503
  // holds the event while someone looks
  it("reports a 4xx from paypal's cert host to sentry as a bug, naming the status and host, and asks for redelivery", async () => {
    await seed_donation();
    report_error_mock.mockImplementationOnce(real_report_error);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<html>cert body</html>", { status: 404 })
    );

    const res = await deliver(capture_ev(), {
      "paypal-cert-url": `${CERT_URL}-404`,
    });

    expect(res.status).toBe(503);
    expect(report_degraded_mock).not.toHaveBeenCalled();
    expect(sentry_capture_mock).toHaveBeenCalledOnce();
    const [reported, hint] = sentry_capture_mock.mock.calls[0]!;
    expect(hint).toMatchObject({
      level: "error",
      tags: { report: "bug" },
      extra: {
        unverified: expect.objectContaining({ transmission_id: "t-1" }),
      },
    });
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toMatch(/404/);
    expect(reported.message).toContain("api.sandbox.paypal.com");
    expect(reported.message).not.toContain("/v1/notifications/certs/");
    expect(reported.message).not.toContain("cert body");
    expect(await settlements()).toHaveLength(0);
  });

  it("does not follow a redirect off paypal's cert url, reports it as a bug, and asks for redelivery", async () => {
    await seed_donation();
    // a followed redirect lands on IMPOSTOR's cert
    vi.mocked(fetch).mockImplementationOnce(async (_, init) => {
      if (init?.redirect === "manual")
        return new Response(null, {
          status: 302,
          headers: { location: IMPOSTOR_CERT_URL },
        });
      if (init?.redirect === "error")
        throw new TypeError("fetch failed", {
          cause: new Error("unexpected redirect"),
        });
      return new Response(IMPOSTOR.pem);
    });

    const res = await deliver(
      capture_ev(),
      { "paypal-cert-url": `${CERT_URL}-redirect` },
      IMPOSTOR
    );

    expect(res.status).toBe(503);
    expect(report_degraded_mock).not.toHaveBeenCalled();
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          "[paypal webhook] cert host api.sandbox.paypal.com answered 302",
      }),
      { unverified: expect.objectContaining({ transmission_id: "t-1" }) }
    );
    expect(await settlements()).toHaveLength(0);
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("reports a cert download that fails on the network as degraded, naming the delivery as unverified, and asks for redelivery", async () => {
    await seed_donation();
    const network = new TypeError("fetch failed");
    vi.mocked(fetch).mockRejectedValueOnce(network);

    const res = await deliver(
      { ...capture_ev(), id: "WH-UNREACHABLE" },
      {
        "paypal-cert-url": `${CERT_URL}-unreachable`,
        "paypal-transmission-id": "t-unreachable",
      }
    );

    expect(res.status).toBe(503);
    expect(await res.text()).toBe("signature unverifiable");
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          "[paypal webhook] cert host api.sandbox.paypal.com unreachable",
        cause: network,
      }),
      {
        unverified: {
          transmission_id: "t-unreachable",
          event_id: "WH-UNREACHABLE",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          cert_host: "api.sandbox.paypal.com",
        },
      }
    );
    expect(await settlements()).toHaveLength(0);
  });

  // the fetch's timeout signal also covers the body stream, so a host that
  // sends headers and stalls times out in the read
  it.each([
    ["connecting", (timeout: DOMException) => Promise.reject(timeout)],
    [
      "reading the body",
      async (timeout: DOMException) =>
        new Response(new ReadableStream({ start: (c) => c.error(timeout) })),
    ],
  ])(
    "reports paypal's cert host timing out while %s as degraded, and asks for redelivery",
    async (when, respond) => {
      await seed_donation();
      const timeout = new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError"
      );
      vi.mocked(fetch).mockImplementationOnce(() => respond(timeout));

      const res = await deliver(capture_ev(), {
        "paypal-cert-url": `${CERT_URL}-timeout-${when.replaceAll(" ", "-")}`,
      });

      expect(res.status).toBe(503);
      expect(report_error_mock).not.toHaveBeenCalled();
      expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          name: "CertHostUnreachable",
          message:
            "[paypal webhook] cert host api.sandbox.paypal.com unreachable",
          cause: timeout,
        }),
        { unverified: expect.objectContaining({ transmission_id: "t-1" }) }
      );
      expect(await settlements()).toHaveLength(0);
    }
  );

  it("reports a cert outage on a body that does not parse as degraded, naming the transmission", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("unavailable", { status: 502 })
    );

    const res = await deliver("{not json", {
      "paypal-cert-url": `${CERT_URL}-garbled-body`,
      "paypal-transmission-id": "t-garbled",
    });

    expect(res.status).toBe(503);
    expect(await res.text()).toBe("signature unverifiable");
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(report_degraded_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message:
          "[paypal webhook] cert host api.sandbox.paypal.com answered 502",
      }),
      {
        unverified: {
          transmission_id: "t-garbled",
          event_id: null,
          event_type: null,
          cert_host: "api.sandbox.paypal.com",
        },
      }
    );
  });

  it("rejects a cert hosted off paypal without fetching it, even when it verifies", async () => {
    await seed_donation();

    const res = await deliver(
      capture_ev(),
      { "paypal-cert-url": IMPOSTOR_CERT_URL },
      IMPOSTOR
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("invalid signature");
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "[paypal webhook] cert url is not paypal's",
      }),
      {
        unverified: {
          transmission_id: "t-1",
          event_id: CAPTURE_EV_ID,
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          cert_host: "attacker.example",
        },
      }
    );
    expect(await settlements()).toHaveLength(0);
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "over http",
      "http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "api.sandbox.paypal.com",
    ],
    [
      "off the certs path",
      "https://api.sandbox.paypal.com/v1/uploads/cert.pem",
      "api.sandbox.paypal.com",
    ],
    [
      "climbing out of the certs path",
      "https://api.sandbox.paypal.com/v1/notifications/certs/../../uploads/c",
      "api.sandbox.paypal.com",
    ],
    [
      "on live's host from sandbox",
      "https://api.paypal.com/v1/notifications/certs/CERT-1",
      "api.paypal.com",
    ],
    [
      "on the rest client's api-m host",
      "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "api-m.sandbox.paypal.com",
    ],
    [
      "on a non-default port",
      "https://api.sandbox.paypal.com:8443/v1/notifications/certs/CERT-1",
      "api.sandbox.paypal.com:8443",
    ],
    [
      "carrying credentials",
      "https://user:pass@api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "api.sandbox.paypal.com",
    ],
    [
      "carrying only a password",
      "https://:pass@api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "api.sandbox.paypal.com",
    ],
    [
      "carrying a query",
      "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1?x=1",
      "api.sandbox.paypal.com",
    ],
    [
      "carrying a fragment",
      "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1#f",
      "api.sandbox.paypal.com",
    ],
    ["that does not parse", "not a url", null],
  ])(
    "rejects a cert url %s without fetching it",
    async (_, cert_url, cert_host) => {
      await seed_donation();

      const res = await deliver(capture_ev(), { "paypal-cert-url": cert_url });

      expect(fetch).not.toHaveBeenCalled();
      expect(res.status).toBe(201);
      expect(await res.text()).toBe("invalid signature");
      expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "[paypal webhook] cert url is not paypal's",
        }),
        {
          unverified: {
            transmission_id: "t-1",
            event_id: CAPTURE_EV_ID,
            event_type: "PAYMENT.CAPTURE.COMPLETED",
            cert_host,
          },
        }
      );
      expect(await settlements()).toHaveLength(0);
    }
  );

  it("asks for redelivery, reporting once, while PAYPAL_API_URL maps to no cert host", async () => {
    await seed_donation();
    const configured = paypal_env.api_url;
    paypal_env.api_url = "https://api.example.com";
    vi.resetModules();
    const { action: misconfigured } = await import("./route");
    paypal_env.api_url = configured;

    const res = await deliver(capture_ev(), {}, PAYPAL, misconfigured);

    expect(fetch).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "[paypal webhook] cert host is not configured",
      }),
      { api_host: "api.example.com" }
    );
    expect(await settlements()).toHaveLength(0);
  });

  // a 200 that isn't a cert is not the host shedding load: triaged as a bug
  it("reports paypal's cert url answering 200 with no certificate as a bug, asks for redelivery, and caches nothing", async () => {
    await seed_donation();
    const cert_url = `${CERT_URL}-not-a-cert`;
    vi.mocked(fetch).mockResolvedValueOnce(new Response("<html>ok</html>"));

    const garbled = await deliver(capture_ev(), {
      "paypal-cert-url": cert_url,
    });

    expect(garbled.status).toBe(503);
    expect(report_degraded_mock).not.toHaveBeenCalled();
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ code: "ERR_OSSL_PEM_NO_START_LINE" }),
      { unverified: expect.objectContaining({ transmission_id: "t-1" }) }
    );
    expect(await settlements()).toHaveLength(0);

    const redelivered = await deliver(capture_ev(), {
      "paypal-cert-url": cert_url,
    });

    expect(redelivered.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map(([u]) => String(u))).toEqual([
      cert_url,
      cert_url,
    ]);
    expect(await settlements()).toHaveLength(1);
  });

  it("reports paypal's cert url serving a cert not issued to paypal's signer as a bug, naming the delivery, and asks for redelivery", async () => {
    await seed_donation();
    const cert_url = `${CERT_URL}-stranger`;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(STRANGER.pem));

    const res = await deliver(
      { ...capture_ev(), id: "WH-STRANGER" },
      { "paypal-cert-url": cert_url },
      STRANGER
    );

    expect(res.status).toBe(503);
    expect(await res.text()).toBe("signature unverifiable");
    expect(report_degraded_mock).not.toHaveBeenCalled();
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "[paypal webhook] cert is not paypal's signing cert",
      }),
      {
        unverified: {
          transmission_id: "t-1",
          event_id: "WH-STRANGER",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          cert_host: "api.sandbox.paypal.com",
        },
      }
    );
    expect(await settlements()).toHaveLength(0);
  });

  it("asks for redelivery once paypal's cert has expired, cached or not", async () => {
    await seed_donation();
    // prime the cache with the cert while it is current
    await deliver({ event_type: "PING" });
    // the test certs are issued for 2 days
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * 24 * 60 * 60 * 1000);

    try {
      const res = await deliver(capture_ev());

      expect(res.status).toBe(503);
      expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "[paypal webhook] paypal's signing cert is not current",
        }),
        { unverified: expect.objectContaining({ transmission_id: "t-1" }) }
      );
      expect(await settlements()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for redelivery and reports when verifying throws rather than fails", async () => {
    await seed_donation();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(ED25519.pem));

    const res = await deliver(capture_ev(), {
      "paypal-cert-url": `${CERT_URL}-ed25519`,
    });

    expect(res.status).toBe(503);
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ code: "ERR_CRYPTO_UNSUPPORTED_OPERATION" }),
      { unverified: expect.objectContaining({ transmission_id: "t-1" }) }
    );
    expect(await settlements()).toHaveLength(0);
  });

  // a redelivery repeats the same headers and signature, so neither case below
  // can come right on retry
  it("acknowledges and reports a delivery whose signature does not verify", async () => {
    await seed_donation();

    const res = await deliver({ ...capture_ev(), id: "WH-BAD" }, {}, STRANGER);

    expect(res.status).toBe(201);
    expect(await res.text()).toBe("invalid signature");
    // were the fault ours (a wrong PAYPAL_WEBHOOK_ID), every event lands here
    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "[paypal webhook] signature does not verify",
      }),
      {
        unverified: {
          transmission_id: "t-1",
          event_id: "WH-BAD",
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          cert_host: "api.sandbox.paypal.com",
        },
      }
    );
    expect(await settlements()).toHaveLength(0);
  });

  it("cuts each unverified id it reports to 128 characters", async () => {
    const long = (c: string) => c.repeat(4096);

    await deliver(
      { id: long("e"), event_type: long("y") },
      { "paypal-transmission-id": long("t") },
      STRANGER
    );

    expect(report_error_mock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "[paypal webhook] signature does not verify",
      }),
      {
        unverified: {
          transmission_id: "t".repeat(128),
          event_id: "e".repeat(128),
          event_type: "y".repeat(128),
          cert_host: "api.sandbox.paypal.com",
        },
      }
    );
  });

  it("acknowledges a delivery missing a signature header, unreported", async () => {
    await seed_donation();

    const res = await deliver(capture_ev(), {
      "paypal-transmission-sig": null,
    });

    expect(res.status).toBe(201);
    expect(await res.text()).toBe("missing paypal-transmission-sig");
    expect(report_error_mock).not.toHaveBeenCalled();
    expect(await settlements()).toHaveLength(0);
  });
});

// a non-2xx buys up to 25 redeliveries over 3 days; a payload missing what the
// route needs arrives identical every time, so it is reported and acknowledged
describe("an event no redelivery can route", () => {
  it("acknowledges and reports a capture with no donation id", async () => {
    await seed_donation();
    const { custom_id: _, ...resource } = capture_copy();

    const res = await deliver_capture(resource);

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^not routable: /);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await settlements()).toHaveLength(0);
  });

  it("acknowledges and reports a capture with no gross amount", async () => {
    await seed_donation();
    const resource = {
      ...capture_copy(),
      seller_receivable_breakdown: {
        net_amount: { value: "96.5", currency_code: "USD" },
        paypal_fee: { value: "3.5", currency_code: "USD" },
      },
    };

    const res = await deliver_capture(resource);

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^not routable: /);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await settlements()).toHaveLength(0);
  });

  it("acknowledges and reports a capture with no net and a platform fee in another currency", async () => {
    await seed_donation();
    const resource = {
      ...capture_copy(),
      seller_receivable_breakdown: {
        gross_amount: { value: "100", currency_code: "USD" },
        paypal_fee: { value: "3.5", currency_code: "USD" },
        platform_fees: [{ amount: { value: "2", currency_code: "EUR" } }],
      },
    };

    const res = await deliver_capture(resource);

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^not routable: /);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await settlements()).toHaveLength(0);
  });

  it("acknowledges and reports an approved order with no donation id", async () => {
    await seed_donation();

    const res = await deliver({
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: {
        id: "ORDER-1",
        payment_source: { paypal: { email_address: "payer@test.com" } },
        purchase_units: [{}],
      },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^not routable: /);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect((await donation_get(ORDER_ID))!.from_email).toBe("donor@test.com");
  });

  it("acknowledges and reports an activated subscription with no donation id", async () => {
    await seed_donation({ frequency: "monthly" });

    const res = await deliver({
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      resource: {
        id: SUBS_ID,
        plan_id: "P-1",
        subscriber: { email_address: "subscriber@test.com" },
        billing_info: { next_billing_time: "2026-02-01T00:00:00.000Z" },
      },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^not routable: /);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await db().select().from(subscriptions)).toHaveLength(0);
  });

  it("acknowledges and reports a sale with no subscription id", async () => {
    await seed_donation({ frequency: "monthly" });
    const { billing_agreement_id: _, ...copy } = sale_copy();
    get_sale_mock.mockResolvedValue(copy);
    const { billing_agreement_id: __, ...resource } = sale_ev().resource;

    const res = await deliver({ ...sale_ev(), resource });

    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^not routable: /);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect(await settlements()).toHaveLength(0);
  });

  it("asks for redelivery of a capture whose donation row is not there yet", async () => {
    const res = await deliver(capture_ev());

    expect(res.ok).toBe(false);
    expect(await settlements()).toHaveLength(0);
  });
});

describe("logging", () => {
  const DONOR = {
    email: "payer-pii@example.com",
    given_name: "Janepii",
    surname: "Payerpii",
    line_1: "742 Piistreet Ave",
  };
  const donor_name = { given_name: DONOR.given_name, surname: DONOR.surname };
  const donor_address = {
    address_line_1: DONOR.line_1,
    admin_area_2: "Springfield",
    postal_code: "12345",
    country_code: "US",
  };
  const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

  let spies: { mock: { calls: unknown[][] } }[];
  beforeEach(() => {
    spies = CONSOLE_METHODS.map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    );
  });

  /** every console call's and report's arguments, deeply rendered — inspect
   * reaches an Error's message, cause and own props where JSON drops them */
  const logged_text = () =>
    [...spies, report_error_mock, report_degraded_mock]
      .flatMap((s) => s.mock.calls.flat())
      .map((a) => (typeof a === "string" ? a : inspect(a, { depth: null })))
      .join("\n");

  const expect_no_donor_pii = () => {
    const text = logged_text();
    expect(text).not.toBe("");
    for (const v of Object.values(DONOR)) expect(text).not.toContain(v);
  };

  it("keeps the payer out of the log of an approved order", async () => {
    await seed_donation();

    const res = await deliver({
      id: "WH-1",
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: {
        id: "ORDER-1",
        payment_source: {
          paypal: {
            email_address: DONOR.email,
            name: donor_name,
            address: donor_address,
          },
        },
        purchase_units: [{ custom_id: ORDER_ID }],
      },
    });

    expect(res.status).toBe(200);
    expect_no_donor_pii();
  });

  it("keeps the payer out of the log of a completed capture", async () => {
    await seed_donation();
    get_order_mock.mockResolvedValue({
      id: "ORDER-1",
      payment_source: {
        paypal: {
          email_address: DONOR.email,
          name: donor_name,
          address: donor_address,
        },
      },
    });
    get_capture_mock.mockResolvedValue({
      ...capture_copy(),
      supplementary_data: { related_ids: { order_id: "ORDER-1" } },
    });

    const res = await deliver({ ...capture_ev(), id: "WH-4" });

    expect(res.status).toBe(200);
    expect(get_order_mock).toHaveBeenCalledWith("ORDER-1");
    expect((await donation_get(ORDER_ID))!.from_email).toBe(DONOR.email);
    expect_no_donor_pii();
  });

  it("keeps the subscriber out of the log of an activated subscription", async () => {
    await seed_donation({ frequency: "monthly" });

    const res = await deliver({
      id: "WH-3",
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      resource: {
        id: SUBS_ID,
        plan_id: "P-1",
        custom_id: ORDER_ID,
        subscriber: {
          email_address: DONOR.email,
          name: donor_name,
          shipping_address: { address: donor_address },
        },
        billing_info: { next_billing_time: "2026-02-01T00:00:00.000Z" },
      },
    });

    expect(res.status).toBe(200);
    expect_no_donor_pii();
  });

  const payer_capture_ev = () => {
    const ev = capture_ev();
    return {
      ...ev,
      id: "WH-5",
      resource: {
        ...ev.resource,
        payer: {
          email_address: DONOR.email,
          name: donor_name,
          address: donor_address,
        },
      },
    };
  };

  it("keeps the payer out of the report of a delivery whose signature does not verify", async () => {
    const res = await deliver(payer_capture_ev(), {}, STRANGER);

    expect(res.status).toBe(201);
    expect(report_error_mock).toHaveBeenCalledOnce();
    expect_no_donor_pii();
  });

  it("keeps the payer out of the report of a cert outage", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("unavailable", { status: 503 })
    );

    const res = await deliver(payer_capture_ev(), {
      "paypal-cert-url": `${CERT_URL}-pii-outage`,
    });

    expect(res.status).toBe(503);
    expect(report_degraded_mock).toHaveBeenCalledOnce();
    expect_no_donor_pii();
  });

  it("keeps the payer out of the log of an unhandled event", async () => {
    const res = await deliver({
      id: "WH-2",
      event_type: "PAYMENT.AUTHORIZATION.CREATED",
      resource: {
        id: "REFUND-1",
        payer: {
          email_address: DONOR.email,
          name: donor_name,
          address: donor_address,
        },
      },
    });

    expect(res.status).toBe(201);
    expect(await res.text()).toContain("event type not handled");
    expect_no_donor_pii();
  });
});
