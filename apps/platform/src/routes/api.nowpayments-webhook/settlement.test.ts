import crypto from "node:crypto";
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
const send_alert_mock = vi.hoisted(() => vi.fn());
const send_email_mock = vi.hoisted(() =>
  vi.fn(async () => ({ data: { id: "email-1" } }))
);
/** usd per unit, keyed by lowercase nowpayments code; a missing code rejects.
 * `zzzusd` has a rate but no entry in `@better-giving/crypto`'s token map */
const usd_rates = vi.hoisted(
  () =>
    ({ eth: 2000, usdc: 1, btc: 50_000, zzzusd: 1 }) as Record<string, number>
);

vi.mock("@sentry/react-router", () => ({ captureException: vi.fn() }));
vi.mock("$/env", () => ({
  nowpayments: { ipn_secret: "ipn-secret", is_sandbox: false },
  stage: "production",
}));
vi.mock("$/kit/slack", () => ({
  aws_monitor: { send_alert: send_alert_mock },
  fiat_monitor: { send_alert: vi.fn() },
}));
vi.mock("$/kit/queue", () => ({ enqueue: enqueue_mock }));
vi.mock("$/email", () => ({ send_email: send_email_mock }));
// the reversal is `reverse.test.ts`'s ground; here it is the boundary
vi.mock("$/refund/reverse", async () => ({
  WHOLE: (
    await vi.importActual<typeof import("$/refund/share")>("$/refund/share")
  ).WHOLE,
  reverse_charge: vi.fn(async () => ({
    status: "reversed",
    dists: 1,
    applied: 1,
    owed_msgs: [],
    has_loss: false,
  })),
}));
vi.mock("$/kit/nowpayments", () => ({
  np: {
    estimate: vi.fn(async (code: string) => {
      const usdpu = usd_rates[code.toLowerCase()];
      if (!usdpu) throw new Error(`no rate: ${code}`);
      return { usdpu };
    }),
    min_amount: vi.fn(async (code: string) => {
      const usdpu = usd_rates[code.toLowerCase()];
      if (!usdpu) throw new Error(`no rate: ${code}`);
      return { min: 0.001, min_usd: 0.001 * usdpu };
    }),
  },
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

// wrapped, not replaced: a test that stubs it can model a concurrent delivery
// that passed the read guard before this one's write committed
vi.mock("$/pg/queries/donation", async (importOriginal) => {
  const m = await importOriginal<typeof import("$/pg/queries/donation")>();
  return { ...m, donation_by_sttl_id: vi.fn(m.donation_by_sttl_id) };
});

const { action } = await import("./route");
const { handle_settled } = await import("./handlers/settled");
const { handle_confirming } = await import("./handlers/confirming");
const { handle_failed } = await import("./handlers/failed");
const { np } = await import("$/kit/nowpayments");
const { reverse_charge } = await import("$/refund/reverse");
const { reverse_charge: real_reverse_charge } =
  await vi.importActual<typeof import("$/refund/reverse")>("$/refund/reverse");
const { fraction_of } = await import("$/refund/share");
const { taken_of } = await import("$/refund/takes");
const { takes_of } = await import("$/pg/queries/take");
const { dists } = await import("$/pg/schema/dist");
const { owed_amounts } = await import("$/pg/schema/owed");
const { bal_txs } = await import("$/pg/schema/bal-tx");
const { loss_logs } = await import("$/pg/schema/revenue");
const { donation_takes } = await import("$/pg/schema/take");
const {
  donation_by_sttl_id,
  donation_get,
  donation_hold_mark,
  donation_put,
  donation_update,
} = await import("$/pg/queries/donation");
const {
  donation_donors,
  donation_recipients,
  donation_settlements,
  donations,
} = await import("$/pg/schema/donation");
const { npos } = await import("$/pg/schema/npo");
const { create_test_db } = await import("$/pg/test-utils/pglite");

const db = () => test_db.current!.db;

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

const deliver = async (payload: Record<string, unknown>) => {
  const body = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha512", "ipn-secret")
    .update(JSON.stringify(sort_deep(payload)))
    .digest("hex");
  const request = new Request("https://x/api/nowpayments-webhook", {
    method: "POST",
    body,
    headers: { "x-nowpayments-sig": sig },
  });
  return (await action({ request } as any)) as Response;
};

const ORDER_ID = "don-np-1";

const payment = (o: Record<string, unknown> = {}) => ({
  payment_id: 5001,
  parent_payment_id: null,
  invoice_id: 9,
  order_id: ORDER_ID,
  payment_status: "finished",
  pay_amount: 0.5,
  pay_currency: "eth",
  actually_paid: 0.5,
  actually_paid_at_fiat: 1000,
  outcome_amount: 990,
  outcome_currency: "usdc",
  fee: {
    currency: "usdc",
    depositFee: 1,
    serviceFee: 4,
    withdrawalFee: 5,
  },
  ...o,
});

let npo_id: number;

const seed_donation = async (o: Record<string, unknown> = {}) => {
  const now = new Date().toISOString();
  await donation_put(
    db() as any,
    {
      id: ORDER_ID,
      upusd: 1 / 2000,
      status: "confirmed",
      amount: { base: 0.5, tip: 0, fee_allowance: 0 },
      currency: "ETH",
      frequency: "one-time",
      source: "bg-widget",
      via: "crypto:eth",
      via_extra: "5001",
      to_id: npo_id.toString(),
      to_name: "NP Test NPO",
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
      date_created: new Date().toISOString(),
      to_id: npo_id,
      amount_denom: "USD",
      net: 990,
    });
};

const settlements = () => db().select().from(donation_settlements);
/** the queue's dedupe keys of the nth enqueue — what makes a re-send a no-op */
const dedupes = (nth: number): string[] =>
  enqueue_mock.mock.calls.at(nth)!.map((m: any) => m.dedupe);
/** fiat notices as the queue delivers them: one per dedupe key, first wins */
const notices = () => {
  const by_key = new Map<string, any>();
  for (const m of enqueue_mock.mock.calls.flat() as any[]) {
    if (m.id === "fiat-notice" && !by_key.has(m.dedupe)) {
      by_key.set(m.dedupe, m.payload.alert);
    }
  }
  return [...by_key.values()];
};
const alert_titles = () =>
  send_alert_mock.mock.calls.map(([a]) => a.title as string);

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  send_alert_mock.mockReset();
  // rows the real reversal writes against a donation
  await db().delete(owed_amounts);
  await db().delete(bal_txs);
  await db().delete(loss_logs);
  await db().delete(donation_takes);
  await db().delete(dists);
  await db().delete(donation_settlements);
  await db().delete(donation_donors);
  await db().delete(donation_recipients);
  await db().delete(donations);
  await db().delete(npos);
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-NP-TEST",
      name: "NP Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      published: true,
      active: true,
      fiscal_sponsored: true,
      hide_bg_tip: true,
      allocation: { liq: 50, lock: 30, cash: 20 },
      target_smart: true,
    })
    .returning();
  npo_id = npo.id;
});

describe("donation_settlements.sttl_id", () => {
  it("rejects a second donation settled under the same sttl_id", async () => {
    await seed_donation({
      status: "settled",
      settlement: {
        id: "5001",
        date: new Date().toISOString(),
        currency: "USDC",
        net: 1,
        fee: 0,
      },
    });

    const err = await seed_donation({
      id: "don-np-2",
      status: "settled",
      settlement: {
        id: "5001",
        date: new Date().toISOString(),
        currency: "USDC",
        net: 1,
        fee: 0,
      },
    }).catch((e) => e);

    expect(err?.cause?.code).toBe("23505");
    expect(await settlements()).toHaveLength(1);
  });
});

describe("nowpayments ipn settlement", () => {
  // the first delivery's enqueue can fail after its commit; the redelivery is
  // what's left to send them, and the queue absorbs a repeat
  it("settles a redelivered finished payment once, queueing its messages again", async () => {
    await seed_donation();

    const first = await deliver(payment());
    const { updated_at } = (await donation_get(ORDER_ID))!;
    const second = await deliver(payment());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await settlements()).toHaveLength(1);
    expect((await donation_get(ORDER_ID))!.updated_at).toBe(updated_at);
    expect(enqueue_mock).toHaveBeenCalledTimes(2);
    expect(dedupes(1)).toEqual(dedupes(0));
    expect(alert_titles()).toEqual(["Donation settled"]);
  });

  it("re-sends the dist for a redelivered finished payment whose first enqueue failed", async () => {
    await seed_donation();
    enqueue_mock.mockRejectedValueOnce(new Error("queue down"));
    const first = await deliver(payment());
    enqueue_mock.mockClear();

    const res = await deliver(payment());

    expect(first.status).toBe(500);
    expect(res.status).toBe(200);
    expect(enqueue_mock).toHaveBeenCalledOnce();
    expect(enqueue_mock.mock.calls[0].map((m: any) => m.id)).toEqual([
      "don-sttl-dist",
      "don-sttl-receipt",
    ]);
  });

  // the enqueue sends one message at a time, dist first: a delivery that failed
  // on the receipt leaves dist rows and an unsent receipt. the dist is held
  // back — a re-run recomputes a fund's split and would over-distribute
  it("re-sends the receipt and match, not the dist, for a redelivered finished payment that already distributed", async () => {
    await seed_donation({ from_company_name: "Acme Corp" });
    await deliver(payment());
    await seed_dist(ORDER_ID);
    enqueue_mock.mockClear();

    const res = await deliver(payment());

    expect(res.status).toBe(200);
    expect(enqueue_mock).toHaveBeenCalledOnce();
    expect(enqueue_mock.mock.calls[0].map((m: any) => m.id)).toEqual([
      "don-sttl-receipt",
      "don-match",
    ]);
  });

  it("settles once when two deliveries read the donation before either wrote", async () => {
    await seed_donation();
    const stale = (await donation_get(ORDER_ID))!;

    const first = await handle_settled(payment() as any, stale);
    const second = await handle_settled(payment() as any, stale);

    expect(first.op).toBe("settled");
    expect(second.op).toBe("duplicate");
    expect(await settlements()).toHaveLength(1);
  });

  it("settles an underpayment once at what arrived when two deliveries read before either wrote", async () => {
    await seed_donation();
    const stale = (await donation_get(ORDER_ID))!;
    const partial = payment({
      payment_status: "partially_paid",
      actually_paid: 0.4,
    }) as any;

    const first = await handle_settled(partial, stale);
    const second = await handle_settled(partial, stale);

    expect(first.op).toBe("settled");
    expect(second.op).toBe("duplicate");
    expect(await settlements()).toHaveLength(1);
    const don = (await donation_get(ORDER_ID))!;
    expect(don.status).toBe("settled");
    expect(don.amount.base).toBeCloseTo(0.4);
  });

  // a lost confirming, or a dashboard resend of finished alone, leaves the
  // intent's quoted amount on the row
  it("settles a finished payment at what it actually paid, with no confirming before it", async () => {
    await seed_donation({ status: "intent" });

    const res = await deliver(payment({ actually_paid: 0.6 }));

    expect(res.status).toBe(200);
    const don = (await donation_get(ORDER_ID))!;
    expect(don.status).toBe("settled");
    expect(don.amount.base).toBeCloseTo(0.6);
    expect(don.upusd).toBeCloseTo(1 / 2000);
  });

  it("settles a finished payment at the intent's rate and alerts when the pay-coin estimate fails", async () => {
    await seed_donation({ status: "intent", upusd: 1 / 1800 });
    vi.mocked(np.estimate).mockRejectedValueOnce(
      new Error("currency disabled")
    );

    const res = await deliver(payment());

    expect(res.status).toBe(200);

    const don = (await donation_get(ORDER_ID))!;
    expect(don.status).toBe("settled");
    expect(don.upusd).toBeCloseTo(1 / 1800);
    expect(await settlements()).toHaveLength(1);
    expect(enqueue_mock).toHaveBeenCalledOnce();
    expect(alert_titles()).toContainEqual(
      expect.stringMatching(/intent's rate/i)
    );
  });

  it("keeps a settled donation when a confirming read before the settle writes after it", async () => {
    await seed_donation();
    const stale = (await donation_get(ORDER_ID))!;
    await deliver(payment());

    await handle_confirming(
      payment({ payment_status: "confirming", actually_paid: 0.1 }) as any,
      stale
    );

    const don = (await donation_get(ORDER_ID))!;
    expect(don.status).toBe("settled");
    expect(don.amount.base).toBe(0.5);
  });

  it("sends no failure email when a failed read before the settle writes after it", async () => {
    await seed_donation();
    const stale = (await donation_get(ORDER_ID))!;
    await deliver(payment());

    await handle_failed(
      payment({
        payment_status: "failed",
        actually_paid: 0.0001,
        actually_paid_at_fiat: 0,
        fee: null,
      }) as any,
      stale
    );

    expect((await donation_get(ORDER_ID))!.status).toBe("settled");
    expect(send_email_mock).not.toHaveBeenCalled();
  });

  it("settles while slack is down", async () => {
    await seed_donation();
    send_alert_mock.mockRejectedValue(new Error("slack down"));

    const res = await deliver(
      payment({
        fee: {
          currency: "zzz",
          depositFee: 1,
          serviceFee: 1,
          withdrawalFee: 1,
        },
      })
    );

    expect(res.status).toBe(200);
    expect(await settlements()).toHaveLength(1);
    expect(enqueue_mock).toHaveBeenCalledOnce();
  });

  it("leaves the donation open for redelivery when the minimum lookup fails", async () => {
    await seed_donation();
    const failed = payment({
      payment_status: "failed",
      actually_paid: 0.0001,
      actually_paid_at_fiat: 0,
      fee: null,
    });
    vi.mocked(np.min_amount).mockRejectedValueOnce(new Error("np down"));

    const first = await deliver(failed);
    expect(first.status).toBe(500);
    expect((await donation_get(ORDER_ID))!.status).toBe("confirmed");

    await deliver(failed);
    expect((await donation_get(ORDER_ID))!.status).toBe("failed");
    expect(send_email_mock).toHaveBeenCalledOnce();
  });

  it.each(["refunded_loss", "cancelled"])(
    "keeps a %s donation's status when refunded arrives",
    async (status) => {
      await seed_donation({ status });

      const res = await deliver(payment({ payment_status: "refunded" }));

      expect(res.status).toBe(200);
      expect((await donation_get(ORDER_ID))!.status).toBe(status);
      expect(send_alert_mock).not.toHaveBeenCalled();
    }
  );

  it("reverses a settled donation's distributions when refunded, and alerts", async () => {
    await seed_donation();
    await deliver(payment());
    await seed_dist(ORDER_ID);
    send_alert_mock.mockClear();

    const res = await deliver(payment({ payment_status: "refunded" }));

    expect(res.status).toBe(200);
    expect(reverse_charge).toHaveBeenCalledExactlyOnceWith({
      donation_id: ORDER_ID,
      rail: "crypto",
      source: "refund",
      share: expect.any(Object),
      alert_from: "nowpayments-refunded",
      notice: {
        id: "nowpayments-refunded_5001",
        lines: [expect.stringContaining("payment:5001")],
      },
    });
    // nowpayments refunds the whole payment: the entry reverses the gift
    const { share } = vi.mocked(reverse_charge).mock.calls[0][0];
    expect(fraction_of(share!)).toBe(1);
    expect(send_alert_mock).toHaveBeenCalledOnce();
    expect(send_alert_mock.mock.calls[0][0].body).toContain("payment:5001");
  });

  it("takes the whole payment back on the real entry, the donation ending reversed", async () => {
    await seed_donation();
    await deliver(payment());
    // a dist the real entry can read: credited whole to the npo's savings
    await db()
      .insert(dists)
      .values({
        id: `dist-${ORDER_ID}`,
        donation_id: ORDER_ID,
        status: "settled",
        date_created: new Date().toISOString(),
        to_id: npo_id,
        amount: 100,
        amount_usd: 100,
        amount_denom: "USD",
        net: 100,
        fee_base: 0,
        fee_fsa: 0,
        fee_processing: 0,
        alloc: { liq: 100, lock: 0, cash: 0 },
      });
    vi.mocked(reverse_charge).mockImplementationOnce(real_reverse_charge);

    const res = await deliver(payment({ payment_status: "refunded" }));

    expect(res.status).toBe(200);
    expect(["refunded", "refunded_loss"]).toContain(
      (await donation_get(ORDER_ID))!.status
    );
    expect(taken_of(await takes_of(db() as unknown as DbOrTx, ORDER_ID))).toBe(
      1
    );
  });

  it("answers 500 to a refund whose reversal left a dist failed, so it is redelivered", async () => {
    await seed_donation();
    await deliver(payment());
    await seed_dist(ORDER_ID);
    send_alert_mock.mockClear();
    vi.mocked(reverse_charge).mockResolvedValueOnce({
      status: "failed",
      reason: "incomplete",
      dists: 1,
      applied: 0,
      failures: [`dist-${ORDER_ID}`],
    });

    const res = await deliver(payment({ payment_status: "refunded" }));

    expect(res.status).toBe(500);
    expect(send_alert_mock).not.toHaveBeenCalled();
  });

  it("marks a never-settled donation refunded without reversing anything", async () => {
    await seed_donation();

    const res = await deliver(payment({ payment_status: "refunded" }));

    expect(res.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.status).toBe("refunded");
    expect(reverse_charge).not.toHaveBeenCalled();
    expect(send_alert_mock).not.toHaveBeenCalled();
  });

  it("acknowledges a finished redelivered after its refund without alerting", async () => {
    await seed_donation();
    await deliver(payment());
    // what reverse_charge writes once every dist is reversed
    await db().update(donations).set({ status: "refunded" });
    enqueue_mock.mockClear();
    send_alert_mock.mockClear();

    const res = await deliver(payment());

    expect(res.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.status).toBe("refunded");
    expect(enqueue_mock).not.toHaveBeenCalled();
    expect(send_alert_mock).not.toHaveBeenCalled();
  });

  it("keeps a settled donation's status and amount when confirming arrives late", async () => {
    await seed_donation();
    await deliver(payment());

    const res = await deliver(
      payment({ payment_status: "confirming", actually_paid: 0.1 })
    );

    expect(res.status).toBe(200);
    const don = await donation_get(ORDER_ID);
    expect(don!.status).toBe("settled");
    expect(don!.amount.base).toBe(0.5);
  });

  const child = (o: Record<string, unknown> = {}) =>
    payment({
      payment_id: 5002,
      parent_payment_id: 5001,
      actually_paid: 0.2,
      outcome_amount: 396,
      ...o,
    });

  it("a settled coin donation and its repeated deposit stay in the coin, at its rate, never usdc at 1", async () => {
    await seed_donation();
    await deliver(payment());
    await deliver(child());

    const rows = await settlements();
    const parent = (await donation_get(ORDER_ID))!;
    const clone = (await donation_get(
      rows.find((r) => r.sttl_id === "5002")!.donation_id
    ))!;
    for (const don of [parent, clone]) {
      expect(don.currency).toBe("ETH");
      expect(don.upusd).toBeCloseTo(1 / usd_rates.eth);
      expect(don.upusd).not.toBe(1);
    }
    expect(clone.amount.base).toBeCloseTo(0.2);
  });

  it("settles a repeated deposit as its own donation, leaving the parent intact", async () => {
    await seed_donation();
    await deliver(payment());

    await deliver(child());
    const redelivered = await deliver(child());

    expect(redelivered.status).toBe(200);
    const parent = await donation_get(ORDER_ID);
    expect(parent!.settlement!.id).toBe("5001");
    expect(parent!.amount.base).toBe(0.5);

    const rows = await settlements();
    expect(rows).toHaveLength(2);
    const child_row = rows.find((r) => r.sttl_id === "5002")!;
    const clone = await donation_get(child_row.donation_id);
    expect(clone!.id).not.toBe(ORDER_ID);
    expect(clone!.status).toBe("settled");
    expect(clone!.amount.base).toBeCloseTo(0.2);
    expect(clone!.settlement!.net).toBeCloseTo(396);
    expect(clone!.to_id).toBe(parent!.to_id);
    // parent, child, and the child's redelivery queueing the clone's again
    expect(enqueue_mock).toHaveBeenCalledTimes(3);
    expect(dedupes(2)).toEqual(dedupes(1));
  });

  it("re-sends the receipt, not the dist, for a redelivered repeated deposit that already distributed", async () => {
    await seed_donation();
    await deliver(payment());
    await deliver(child());
    const [child_row] = (await settlements()).filter(
      (r) => r.sttl_id === "5002"
    );
    await seed_dist(child_row.donation_id);
    enqueue_mock.mockClear();

    const res = await deliver(child());

    expect(res.status).toBe(200);
    expect(enqueue_mock).toHaveBeenCalledOnce();
    expect(enqueue_mock.mock.calls[0].map((m: any) => m.id)).toEqual([
      "don-sttl-receipt",
    ]);
  });

  it("treats a repeated deposit a concurrent delivery already cloned as a duplicate", async () => {
    await seed_donation();
    await deliver(payment());
    await deliver(child());
    const cloned = dedupes(-1);
    enqueue_mock.mockClear();
    send_alert_mock.mockClear();
    // the guard misses, as it does for two deliveries racing past it
    vi.mocked(donation_by_sttl_id).mockResolvedValueOnce(undefined);

    const res = await deliver(child());

    expect(res.status).toBe(200);
    expect(
      (await settlements()).filter((r) => r.sttl_id === "5002")
    ).toHaveLength(1);
    expect(enqueue_mock).toHaveBeenCalledOnce();
    expect(dedupes(0)).toEqual(cloned);
    expect(send_alert_mock).not.toHaveBeenCalled();
  });

  it("queues nothing for a repeated deposit a concurrent delivery cloned and a refund reversed", async () => {
    await seed_donation();
    await deliver(payment());
    await deliver(child());
    const [child_row] = (await settlements()).filter(
      (r) => r.sttl_id === "5002"
    );
    // what the refund plan leaves once it reverses the clone's dist
    await donation_update(db() as any, child_row.donation_id, {
      status: "refunded",
    });
    enqueue_mock.mockClear();
    // the guard misses, so the clone is re-read after the put instead
    vi.mocked(donation_by_sttl_id).mockResolvedValueOnce(undefined);

    const res = await deliver(child());

    expect(res.status).toBe(200);
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it.each(["confirming", "waiting"])(
    "writes nothing for a repeated deposit still %s",
    async (payment_status) => {
      await seed_donation({ status: "intent" });

      const res = await deliver(child({ payment_status }));

      expect(res.status).toBe(200);
      const parent = await donation_get(ORDER_ID);
      expect(parent!.status).toBe("intent");
      expect(parent!.via_extra).toBe("5001");
    }
  );

  it.each(["failed", "expired"])(
    "alerts on a %s repeated deposit without writing or emailing",
    async (payment_status) => {
      await seed_donation();
      await deliver(payment());
      send_alert_mock.mockClear();

      const res = await deliver(child({ payment_status }));

      expect(res.status).toBe(200);
      expect((await donation_get(ORDER_ID))!.status).toBe("settled");
      expect(await settlements()).toHaveLength(1);
      expect(send_email_mock).not.toHaveBeenCalled();
      expect(send_alert_mock).toHaveBeenCalledOnce();
      expect(send_alert_mock.mock.calls[0][0].body).toContain("parent:5001");
    }
  );

  it.each(["confirming", "finished", "partially_paid"])(
    "holds a %s deposit in another asset than the order's",
    async (payment_status) => {
      await seed_donation();

      const res = await deliver(
        payment({
          payment_status,
          pay_currency: "usdterc20",
          actually_paid: 50,
        })
      );

      expect(res.status).toBe(200);
      const don = await donation_get(ORDER_ID);
      expect(don!.status).toBe("confirmed");
      expect(don!.amount.base).toBe(0.5);
      expect(await settlements()).toHaveLength(0);
      const [a, ...rest] = notices();
      expect(rest).toHaveLength(0);
      expect(`${a.title} ${a.body}`).toMatch(/USDTERC20.*ETH|ETH.*USDTERC20/);
      expect(a.body).toContain("payment:5001");
    }
  );

  it("marks a deposit in another asset as held on the donation", async () => {
    await seed_donation();

    await deliver(payment({ pay_currency: "usdterc20", actually_paid: 50 }));

    const don = await donation_get(ORDER_ID);
    expect(don!.hold?.asset).toBe("USDTERC20");
    expect(don!.hold?.at).toBeTruthy();
  });

  it("notices a held deposit once across redeliveries", async () => {
    await seed_donation();
    const held = payment({ pay_currency: "usdterc20", actually_paid: 50 });

    await deliver(held);
    const res = await deliver(held);

    expect(res.status).toBe(200);
    expect(notices()).toHaveLength(1);
    expect(send_alert_mock).not.toHaveBeenCalled();
  });

  // the mark commits before the notice is queued; a queue refusal 500s, and
  // the redelivery finds the row already held
  it("queues the held notice again when its first enqueue failed", async () => {
    await seed_donation();
    const held = payment({ pay_currency: "usdterc20", actually_paid: 50 });
    enqueue_mock.mockRejectedValueOnce(new Error("qstash down"));

    expect((await deliver(held)).status).toBe(500);
    expect((await deliver(held)).status).toBe(200);

    const [first, second] = enqueue_mock.mock.calls.map(([m]) => m.dedupe);
    expect(second).toBe(first);
  });

  // what a wrong-asset deposit reports back once ops process it is unknown, so
  // no later ipn settles a hold — the alert is the whole handoff
  it("tells ops the held deposit settles only by hand", async () => {
    await seed_donation();

    await deliver(payment({ pay_currency: "usdterc20", actually_paid: 50 }));
    await deliver(payment({ pay_currency: "usdterc20", actually_paid: 50 }));

    expect((await donation_get(ORDER_ID))!.status).toBe("confirmed");
    const [a] = notices();
    expect(a.body).toMatch(/never settle/i);
    expect(a.body).toMatch(/reconcile by hand/i);
    expect(a.body).toContain("held_at");
    expect(a.body).toContain("outcome:990 USDC");
  });

  it("leaves a held donation unsettled when a payment in the order's asset finishes", async () => {
    await seed_donation();
    await deliver(
      payment({
        payment_id: 5003,
        pay_currency: "usdterc20",
        actually_paid: 50,
      })
    );

    const res = await deliver(payment());

    expect(res.status).toBe(200);
    const don = (await donation_get(ORDER_ID))!;
    expect(don.status).toBe("confirmed");
    expect(don.hold?.asset).toBe("USDTERC20");
    expect(await settlements()).toHaveLength(0);
  });

  it("notices a held payment once while confirming and once more at its final amounts", async () => {
    await seed_donation();
    const held = (o: Record<string, unknown>) =>
      payment({ pay_currency: "usdterc20", ...o });

    await deliver(
      held({
        payment_status: "confirming",
        actually_paid: 40,
        outcome_amount: 0,
      })
    );
    const marked = (await donation_get(ORDER_ID))!.hold!.at;
    await deliver(
      held({
        payment_status: "confirming",
        actually_paid: 40,
        outcome_amount: 0,
      })
    );
    await deliver(held({ actually_paid: 50 }));
    await deliver(held({ actually_paid: 50 }));

    expect((await donation_get(ORDER_ID))!.hold!.at).toBe(marked);
    const sent = notices();
    expect(sent).toHaveLength(2);
    expect(sent[0].body).toMatch(/provisional/i);
    expect(sent[1].body).not.toMatch(/provisional/i);
    expect(sent[1].body).toContain("paid:50 USDTERC20");
    expect(sent[1].body).toContain("outcome:990 USDC");
  });

  it("records a repeated deposit in the order's asset on a held order as its own donation, leaving the held parent unsettled", async () => {
    await seed_donation();
    await deliver(payment({ pay_currency: "usdterc20", actually_paid: 50 }));

    const res = await deliver(child());

    expect(res.status).toBe(200);
    const rows = await settlements();
    expect(rows).toHaveLength(1);
    expect(rows[0].sttl_id).toBe("5002");
    const clone = (await donation_get(rows[0].donation_id))!;
    expect(clone.id).not.toBe(ORDER_ID);
    expect(clone.status).toBe("settled");
    expect(clone.amount.base).toBeCloseTo(0.2);
    expect(clone.hold).toBeUndefined();
    const parent = (await donation_get(ORDER_ID))!;
    expect(parent.status).toBe("confirmed");
    expect(parent.hold?.asset).toBe("USDTERC20");
  });

  it("applies none of the held payment's own later ipns, a finished in the order's asset included", async () => {
    await seed_donation();
    await deliver(payment({ pay_currency: "usdterc20", actually_paid: 50 }));

    const res = await deliver(payment());

    expect(res.status).toBe(200);
    expect(await settlements()).toHaveLength(0);
    const parent = (await donation_get(ORDER_ID))!;
    expect(parent.status).toBe("confirmed");
    expect(parent.hold?.asset).toBe("USDTERC20");
  });

  it("leaves a donation a concurrent delivery held after this one read it unsettled", async () => {
    await seed_donation();
    const prior = (await donation_get(ORDER_ID))!;
    await donation_hold_mark(ORDER_ID, "usdterc20");

    const res = await handle_settled(payment() as any, prior);

    expect(res.op).toBe("ignored");
    expect((await donation_get(ORDER_ID))!.status).toBe("confirmed");
    expect(await settlements()).toHaveLength(0);
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("notices a deposit in another asset on a settled donation once across redeliveries and statuses", async () => {
    await seed_donation({ status: "settled" });
    const late = (payment_status: string) =>
      payment({ payment_status, pay_currency: "usdterc20", actually_paid: 50 });

    await deliver(late("confirming"));
    await deliver(late("finished"));
    const res = await deliver(late("finished"));

    expect(res.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.hold).toBeUndefined();
    const [a, ...rest] = notices();
    expect(rest).toHaveLength(0);
    expect(a.body).toContain("prior:settled");
  });

  it("holds and notices a deposit in another asset with no outcome currency yet", async () => {
    await seed_donation();

    const res = await deliver(
      payment({
        payment_status: "confirming",
        pay_currency: "usdterc20",
        actually_paid: 50,
        outcome_currency: null,
      })
    );

    expect(res.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.hold?.asset).toBe("USDTERC20");
    expect(notices()[0].body).toContain("paid:50 USDTERC20");
  });

  // the estimate carries nowpayments' conversion spread; usdc is a dollar
  it.each(["usdc", "usdcmatic"])(
    "records a %s outcome and fee at a dollar a unit, whatever the live estimate says",
    async (usdc) => {
      await seed_donation();
      usd_rates[usdc] = 1.03;
      try {
        await deliver(
          payment({
            outcome_currency: usdc,
            fee: { ...payment().fee, currency: usdc },
          })
        );
      } finally {
        usd_rates.usdc = 1;
        delete usd_rates.usdcmatic;
      }

      const [row] = await settlements();
      expect(row.net).toBe(990);
      expect(row.fee).toBe(10);
    }
  );

  it.each([
    ["usdc", "a dollar a unit", 1],
    ["maticusdce", "the live estimate", 1 / 1.03],
  ])(
    "values a finished %s payment's donation at %s",
    async (code, _, upusd) => {
      await seed_donation({ currency: code.toUpperCase(), upusd: 1 });
      usd_rates[code] = 1.03;
      try {
        await deliver(payment({ pay_currency: code, actually_paid: 100 }));
      } finally {
        usd_rates.usdc = 1;
        delete usd_rates.maticusdce;
      }

      const don = (await donation_get(ORDER_ID))!;
      expect(don.status).toBe("settled");
      expect(don.upusd).toBeCloseTo(upusd, 10);
    }
  );

  it("records a fee charged in another currency at that currency's usd rate", async () => {
    await seed_donation();

    await deliver(
      payment({
        fee: {
          currency: "btc",
          depositFee: 0.00002,
          serviceFee: 0.00003,
          withdrawalFee: 0.00005,
        },
      })
    );

    const [row] = await settlements();
    expect(row.fee).toBeCloseTo(5);
    expect(row.net).toBeCloseTo(990);
  });

  it("settles with a zero fee and alerts when the fee currency has no rate", async () => {
    await seed_donation();

    const res = await deliver(
      payment({
        fee: {
          currency: "zzz",
          depositFee: 1,
          serviceFee: 1,
          withdrawalFee: 1,
        },
      })
    );

    expect(res.status).toBe(200);
    const [row] = await settlements();
    expect(row.fee).toBe(0);
    expect(alert_titles()).toContainEqual(expect.stringMatching(/fee/i));
  });

  it("settles an outcome token missing from the token map under its own code", async () => {
    await seed_donation();

    const res = await deliver(payment({ outcome_currency: "zzzusd" }));

    expect(res.status).toBe(200);
    const [row] = await settlements();
    expect(row.currency).toBe("ZZZUSD");
    expect(alert_titles()).toContainEqual(expect.stringMatching(/token map/i));
  });

  it("alerts on a reprocessable failure without emailing the donor", async () => {
    await seed_donation();

    const res = await deliver(payment({ payment_status: "failed" }));

    expect(res.status).toBe(200);
    expect(send_email_mock).not.toHaveBeenCalled();
    expect((await donation_get(ORDER_ID))!.status).toBe("confirmed");
    expect(alert_titles()).toEqual([expect.stringMatching(/reprocess/i)]);
  });

  it("emails the donor once for a final failure delivered twice", async () => {
    await seed_donation();
    const failed = payment({
      payment_status: "failed",
      actually_paid: 0.0001,
      actually_paid_at_fiat: 0,
      fee: null,
    });

    await deliver(failed);
    const second = await deliver(failed);

    expect(second.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.status).toBe("failed");
    expect(send_email_mock).toHaveBeenCalledOnce();
  });

  it.each([
    ["finished", "failed"],
    ["finished", "expired"],
    ["partially_paid", "expired"],
  ])(
    "settles a late %s on a %s donation and alerts",
    async (payment_status, status) => {
      await seed_donation({ status });

      const res = await deliver(
        payment({ payment_status, actually_paid: 0.4 })
      );

      expect(res.status).toBe(200);
      const don = await donation_get(ORDER_ID);
      expect(don!.status).toBe("settled");
      expect(don!.settlement!.id).toBe("5001");
      expect(enqueue_mock).toHaveBeenCalledOnce();
      expect(alert_titles()).toContainEqual(expect.stringMatching(/late/i));
    }
  );

  it("refuses a finished payment on a refunded donation", async () => {
    await seed_donation({ status: "refunded" });

    const res = await deliver(payment());

    expect(res.status).toBe(200);
    expect(await settlements()).toHaveLength(0);
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("reverses a settled repeated deposit's own donation, leaving the parent", async () => {
    await seed_donation();
    await deliver(payment());
    await deliver(child());
    const [child_row] = (await settlements()).filter(
      (r) => r.sttl_id === "5002"
    );
    await seed_dist(ORDER_ID);
    await seed_dist(child_row.donation_id);
    send_alert_mock.mockClear();

    const res = await deliver(child({ payment_status: "refunded" }));

    expect(res.status).toBe(200);
    expect(reverse_charge).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        donation_id: child_row.donation_id,
        notice: expect.objectContaining({ id: "nowpayments-refunded_5002" }),
      })
    );
    expect((await donation_get(ORDER_ID))!.status).toBe("settled");
    expect(send_alert_mock).toHaveBeenCalledOnce();
    expect(send_alert_mock.mock.calls[0][0].body).toContain("payment:5002");
  });

  it("acknowledges a refunded repeated deposit that never settled", async () => {
    await seed_donation();
    await deliver(payment());
    send_alert_mock.mockClear();

    const res = await deliver(child({ payment_status: "refunded" }));

    expect(res.status).toBe(200);
    expect((await donation_get(ORDER_ID))!.status).toBe("settled");
    expect(send_alert_mock).not.toHaveBeenCalled();
  });

  it.each(["failed", "expired"])(
    "ignores %s after the donation settled",
    async (payment_status) => {
      await seed_donation();
      await deliver(payment());

      const res = await deliver(payment({ payment_status }));

      expect(res.status).toBe(200);
      expect((await donation_get(ORDER_ID))!.status).toBe("settled");
      expect(send_email_mock).not.toHaveBeenCalled();
    }
  );
});
