import { eq } from "drizzle-orm";
import Stripe from "stripe";
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

// the refund action with the real reversal over pglite; stripe's api and the
// queue are the boundary. the modal around it is `refund.test.tsx`'s
const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const refunds_create = vi.hoisted(() => vi.fn());
const refunds_list = vi.hoisted(() => vi.fn());
const refunds_retrieve = vi.hoisted(() => vi.fn());
const intents_retrieve = vi.hoisted(() => vi.fn());
const invoice_payments_list = vi.hoisted(() => vi.fn());
const transfers = vi.hoisted(() => ({
  retrieve: vi.fn(),
  update: vi.fn(),
  listReversals: vi.fn(),
  createReversal: vi.fn(),
}));
const enqueue = vi.hoisted(() => vi.fn());
const report_error = vi.hoisted(() => vi.fn());

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
vi.mock("#/.server/toast", () => ({
  // merged, not wrapped: the real helper hands the payload straight back and
  // carries the message in a cookie header, so `fetcher.data` has this shape
  dataWithSuccess: vi.fn((data, toast) => ({ ...data, toast })),
  dataWithError: vi.fn((data, toast) => ({ ...data, toast })),
}));
vi.mock("$/kit/stripe", () => ({
  stripe: {
    refunds: {
      create: refunds_create,
      list: refunds_list,
      retrieve: refunds_retrieve,
    },
    paymentIntents: { retrieve: intents_retrieve },
    invoicePayments: { list: invoice_payments_list },
    // the transfer's charge has no dispute lost: its reversal reads them
    disputes: { list: vi.fn(async () => ({ data: [] })) },
    transfers,
  },
}));
vi.mock("$/kit/queue", () => ({ enqueue }));
vi.mock("$/kit/slack", () => ({ fiat_monitor: { send_alert: vi.fn() } }));
vi.mock("#/errors/report", () => ({ report_error }));

const { action, loader } = await import("../api");
const { owed_for_donation } = await import("$/pg/queries/owed");
const { takes_of } = await import("$/pg/queries/take");
const { taken_of } = await import("$/refund/takes");
const { donations, donation_settlements } = await import(
  "$/pg/schema/donation"
);
const { dists } = await import("$/pg/schema/dist");
const { payouts } = await import("$/pg/schema/payout");
const { owed_amounts } = await import("$/pg/schema/owed");
const { subscriptions } = await import("$/pg/schema/subscription");
const {
  PAID_GRANT,
  ROUTED,
  balance_of,
  clear_card_gifts,
  seed_card_gift,
  transfer_of,
} = await import("#/__tests__/fixtures/card-gift");
const { seed_npo } = await import("#/__tests__/fixtures/funds");
const { create_test_db } = await import("$/pg/test-utils/pglite");

const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.resetAllMocks();
  enqueue.mockResolvedValue(undefined);
  refunds_list.mockResolvedValue({ data: [] });
  invoice_payments_list.mockResolvedValue({ data: [] });
  // no refunded total: the share is summed off the refund list
  intents_retrieve.mockResolvedValue({
    latest_charge: { amount_captured: 10000 },
  });
  // unless a test says otherwise, the refund stands as stripe created it
  refunds_retrieve.mockImplementation(async (id: string) => ({
    ...refunds_create.mock.settledResults.at(-1)?.value,
    id,
  }));
  await db().delete(owed_amounts);
  await db().delete(subscriptions);
  await clear_card_gifts(db());
});

/** a settled stripe card gift with a paid $90 grant, `pi_*` its payment */
const seed_gift = () => seed_card_gift(db(), PAID_GRANT);

const args_of = (id: string) => ({ params: { donation_id: id } }) as any;

/** the gift's status, and what its active takes take back */
const gift_of = async (id: string) => {
  const [row] = await db()
    .select({ status: donations.status })
    .from(donations)
    .where(eq(donations.id, id));
  return {
    status: row?.status,
    taken: taken_of(await takes_of(db() as unknown as DbOrTx, id)),
  };
};

/** an active stripe subscription that billed `payment_intent` */
async function seed_subscription(payment_intent: string) {
  const npo = await seed_npo(db(), { registration_number: "EIN-REFUND-SUB" });
  const id = "sub_refund";
  await db().insert(subscriptions).values({
    id,
    interval: "month",
    interval_count: 1,
    next_billing: "2026-11-01T00:00:00.000Z",
    amount: 100,
    amount_usd: 100,
    currency: "usd",
    product_id: "prod_1",
    to_npo_id: npo!.id,
    to_name: "Fund Test NPO",
    platform: "stripe",
    status: "active",
    from_id: "donor@example.com",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });
  invoice_payments_list.mockImplementation(async (p: any) => ({
    data:
      p.payment.payment_intent === payment_intent
        ? [
            {
              invoice: {
                parent: { subscription_details: { subscription: id } },
              },
            },
          ]
        : [],
  }));
  return id;
}

const sub_status = async (id: string) => {
  const [row] = await db()
    .select({
      status: subscriptions.status,
      reason: subscriptions.status_cancel_reason,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, id));
  return row;
};

const untouched = { status: "settled", taken: 0 };

describe("a refund the stripe call did not complete", () => {
  it("leaves every dist unreversed when the Stripe refund errors", async () => {
    refunds_create.mockRejectedValue(new Error("stripe timed out"));
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res.ok).toBe(false);
    expect(res.failures).toEqual([
      "Stripe refund not issued: stripe timed out",
    ]);
    expect(await gift_of(gift.id)).toEqual(untouched);
  });

  it.each([
    [
      "a lost connection",
      () =>
        new Stripe.errors.StripeConnectionError({
          message: "socket hang up",
        }),
    ],
    [
      "a 5xx",
      () =>
        new Stripe.errors.StripeAPIError({
          type: "api_error",
          message: "internal error",
          statusCode: 500,
        }),
    ],
  ])("calls the refund unknown, not unissued, after %s", async (_, error) => {
    refunds_create.mockRejectedValue(error());
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({ ok: false, refund: "unknown", reversed: 0 });
    expect(await gift_of(gift.id)).toEqual(untouched);
  });

  it("tells the admin the refund went out when the reversal throws after it", async () => {
    refunds_create.mockResolvedValue({ id: "re_1", status: "succeeded" });
    refunds_list
      .mockResolvedValueOnce({ data: [] }) // keying the refund
      .mockRejectedValueOnce(new Error("stripe list timed out"));
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({
      ok: false,
      refund_issued: true,
      refund: "issued",
      reversed: null,
    });
    expect(res.failures).toEqual([
      "Stripe refund re_1 issued, reversal stopped: stripe list timed out",
    ]);
    expect(await gift_of(gift.id)).toEqual(untouched);
  });

  it("issues a replacement refund when a retry follows a failed one", async () => {
    // stripe's side: a repeated key replays its first refund, and the
    // charge's refunds are listed newest first
    const by_key = new Map<string, object>();
    refunds_create.mockImplementation(
      async (_p: unknown, opts: { idempotencyKey: string }) => {
        const r = by_key.get(opts.idempotencyKey) ?? {
          id: `re_${by_key.size + 1}`,
          status: by_key.size === 0 ? "failed" : "succeeded",
          amount: 10000,
          currency: "usd",
        };
        by_key.set(opts.idempotencyKey, r);
        return r;
      }
    );
    refunds_list.mockImplementation(async () => ({
      data: [...by_key.values()].reverse(),
    }));
    const gift = await seed_gift();

    const first: any = await action(args_of(gift.id));
    const retry: any = await action(args_of(gift.id));

    expect(first).toMatchObject({ ok: false, refund: "not_issued" });
    expect(by_key.size).toBe(2);
    expect(retry).toMatchObject({ ok: true, stripe_refund: "succeeded" });
    expect((await gift_of(gift.id)).status).toBe("refunded_loss");
  });

  it("sends one idempotency key for two submits racing before any failure", async () => {
    // pending keeps the reversal held, so the second submit finds the gift open
    refunds_create.mockResolvedValue({
      id: "re_1",
      status: "pending",
      amount: 10000,
    });
    const gift = await seed_gift();

    await Promise.all([action(args_of(gift.id)), action(args_of(gift.id))]);

    const [[, a], [, b]] = refunds_create.mock.calls as any;
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  it("refunds the donor once across a retried submit", async () => {
    // stripe's idempotency: a repeated key replays the first result
    const issued = new Map<string, object>();
    refunds_create.mockImplementation(
      async (_p: unknown, opts?: { idempotencyKey?: string }) => {
        const key = opts?.idempotencyKey ?? crypto.randomUUID();
        const r = issued.get(key) ?? {
          id: `re_${issued.size}`,
          status: "pending",
          amount: 10000,
        };
        issued.set(key, r);
        return r;
      }
    );
    const gift = await seed_gift();

    await action(args_of(gift.id));
    await action(args_of(gift.id));

    expect(issued.size).toBe(1);
  });
});

describe("a refund that completes the charge", () => {
  it("reverses a succeeded card refund at once, the paid grant owed back", async () => {
    refunds_create.mockResolvedValue({
      id: "re_full",
      status: "succeeded",
      amount: 10000,
      currency: "usd",
    });
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({
      ok: true,
      stripe_refund: "succeeded",
      reversal: "done",
    });
    expect(await gift_of(gift.id)).toEqual({
      status: "refunded_loss",
      taken: 1,
    });
    expect(await owed_for_donation(gift.id)).toMatchObject([
      {
        npo_id: gift.npo_ids[0],
        source_ref: "re_full",
        received_usd: 90,
        fee_processing_usd: 3.2,
        outstanding_usd: 93.2,
      },
    ]);
  });

  it("reverses a replacement refund after a failed one, the failed one neither holding nor counting", async () => {
    const failed = {
      id: "re_failed",
      status: "failed",
      amount: 10000,
      currency: "usd",
      created: 1_700_000_000,
    };
    const ours = {
      ...failed,
      id: "re_full",
      status: "succeeded",
      created: 1_700_000_060,
    };
    refunds_create.mockResolvedValue(ours);
    refunds_list.mockResolvedValue({ data: [ours, failed] });
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({ ok: true, reversal: "done" });
    expect(await gift_of(gift.id)).toEqual({
      status: "refunded_loss",
      taken: 1,
    });
  });

  it("sizes a refund after an earlier partial at the charge's full figure, not its own remainder", async () => {
    const ours = {
      id: "re_full",
      status: "succeeded",
      amount: 9500,
      currency: "usd",
    };
    const partial = {
      id: "re_part",
      status: "succeeded",
      amount: 500,
      currency: "usd",
    };
    refunds_create.mockResolvedValue(ours);
    refunds_list.mockResolvedValue({ data: [ours, partial] });
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({ ok: true, reversal: "done" });
    expect(await gift_of(gift.id)).toEqual({
      status: "refunded_loss",
      taken: 1,
    });
    expect(await owed_for_donation(gift.id)).toMatchObject([
      { outstanding_usd: 93.2 },
    ]);
  });

  it("reverses a donation whose charge an earlier attempt already refunded", async () => {
    // past stripe's idempotency window a retry meets the refund it made before
    refunds_create.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        code: "charge_already_refunded",
        message: "Charge ch_1 has already been refunded.",
      })
    );
    refunds_list.mockResolvedValue({
      data: [
        {
          id: "re_earlier",
          status: "succeeded",
          amount: 10000,
          currency: "usd",
        },
      ],
    });
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({ ok: true, stripe_refund: "succeeded" });
    expect((await gift_of(gift.id)).status).toBe("refunded_loss");
  });

  it("reports the refund processed when its own charge.refunded webhook reversed the gift first", async () => {
    const gift = await seed_gift();
    // the webhook backstop lands between the refund and this request's reversal
    refunds_create.mockImplementation(async () => {
      await db()
        .update(donations)
        .set({ status: "refunded" })
        .where(eq(donations.id, gift.id));
      return { id: "re_1", status: "succeeded", amount: 10000 };
    });

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({
      ok: true,
      stripe_refund: "succeeded",
      reversal: "done",
    });
  });

  it("ends a recurring gift's billing once the refund succeeds, queuing its stripe cancel once", async () => {
    refunds_create.mockResolvedValue({
      id: "re_1",
      status: "succeeded",
      amount: 10000,
    });
    const gift = await seed_gift();
    const sub_id = await seed_subscription(gift.sttl_id);

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({ ok: true, reversal: "done" });
    expect(await sub_status(sub_id)).toEqual({
      status: "inactive",
      reason: "refunded",
    });
    expect(
      enqueue.mock.calls.flat().filter((m) => m.id === "sub-deactivated")
    ).toHaveLength(1);
  });
});

describe("a refund the bank has not sent", () => {
  it("tells the admin the reversal waits on a pending bank refund", async () => {
    refunds_create.mockResolvedValue({
      id: "re_1",
      status: "pending",
      amount: 10000,
    });
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({
      ok: true,
      stripe_refund: "pending",
      reversal: "held",
    });
    expect(await gift_of(gift.id)).toEqual(untouched);
    expect(await owed_for_donation(gift.id)).toEqual([]);
  });

  // the entry ends the recurring gift on a whole share, held or not
  it("counts a pending full refund toward the whole, so the held reversal still ends the recurring gift", async () => {
    refunds_create.mockResolvedValue({
      id: "re_1",
      status: "pending",
      amount: 10000,
    });
    // a refunded total that leaves the pending refund out
    intents_retrieve.mockResolvedValue({
      latest_charge: { amount_captured: 10000, amount_refunded: 0 },
    });
    const gift = await seed_gift();
    const sub_id = await seed_subscription(gift.sttl_id);

    await action(args_of(gift.id));

    expect(await sub_status(sub_id)).toEqual({
      status: "inactive",
      reason: "refunded",
    });
    expect((await gift_of(gift.id)).status).toBe("settled");
  });

  it("holds the reversal when its own refund succeeded but an earlier one on the charge is pending", async () => {
    refunds_create.mockResolvedValue({ id: "re_1", status: "succeeded" });
    refunds_list.mockResolvedValue({
      data: [
        { id: "re_1", status: "succeeded", amount: 500 },
        { id: "re_earlier", status: "pending", amount: 9500 },
      ],
    });
    const gift = await seed_gift();

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({ ok: true, reversal: "held" });
    expect(await gift_of(gift.id)).toEqual(untouched);
  });
});

describe("a gift the action refuses", () => {
  it("refuses a stripe donation with no payment on record, reversing nothing", async () => {
    const gift = await seed_gift();
    await db()
      .delete(donation_settlements)
      .where(eq(donation_settlements.donation_id, gift.id));

    const res = await action(args_of(gift.id)).catch((r: unknown) => r);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    expect(refunds_create).not.toHaveBeenCalled();
    expect(await gift_of(gift.id)).toEqual(untouched);
  });

  it("answers already refunded for a gift reversed before its refund, issuing none", async () => {
    const gift = await seed_gift();
    await db()
      .update(donations)
      .set({ status: "refunded" })
      .where(eq(donations.id, gift.id));

    const res = await action(args_of(gift.id)).catch((r: unknown) => r);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    expect(await (res as Response).text()).toBe("already refunded");
    expect(refunds_create).not.toHaveBeenCalled();
  });

  it("refuses a gift with no settled dists, issuing no refund", async () => {
    const gift = await seed_gift();
    await db().delete(payouts);
    await db().delete(dists).where(eq(dists.donation_id, gift.id));

    const res = await action(args_of(gift.id)).catch((r: unknown) => r);

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    expect(await (res as Response).text()).toBe("no settled dists");
    expect(refunds_create).not.toHaveBeenCalled();
    expect(await gift_of(gift.id)).toEqual(untouched);
  });

  it.each(["nowpayments:crypto", "paypal:paypal", "chariot:daf"])(
    "refuses a %s donation in loader and action, reversing nothing",
    async (via) => {
      const gift = await seed_gift();
      await db()
        .update(donations)
        .set({ via })
        .where(eq(donations.id, gift.id));

      const from_loader = await loader(args_of(gift.id)).catch(
        (r: unknown) => r
      );
      const from_action = await action(args_of(gift.id)).catch(
        (r: unknown) => r
      );

      expect(from_loader).toBeInstanceOf(Response);
      expect((from_loader as Response).status).toBe(400);
      expect(from_action).toBeInstanceOf(Response);
      expect((from_action as Response).status).toBe(400);
      expect(refunds_create).not.toHaveBeenCalled();
      expect(await gift_of(gift.id)).toEqual(untouched);
    }
  );
});

describe("a gift routed to the nonprofit's connected account", () => {
  it("refunds the donor as for a pooled gift, then reverses the transfer once", async () => {
    refunds_create.mockResolvedValue({
      id: "re_1",
      status: "succeeded",
      amount: 10000,
      created: 1_790_000_000,
    });
    transfers.retrieve.mockResolvedValue({
      amount: 9000,
      amount_reversed: 0,
      source_transaction: "ch_1",
      metadata: {},
    });
    transfers.listReversals.mockResolvedValue({ data: [] });
    transfers.createReversal.mockResolvedValue({ id: "trr_1" });
    const gift = await seed_card_gift(db(), ROUTED);

    const res: any = await action(args_of(gift.id));

    expect(res).toMatchObject({ ok: true, reversal: "done" });
    // reverse_transfer reverses a destination charge's transfer only, and
    // this charge has none: the refund call is the pooled one
    expect(refunds_create.mock.calls).toEqual([
      [
        { payment_intent: gift.sttl_id },
        { idempotencyKey: `refund_${gift.id}_0` },
      ],
    ]);
    expect(transfers.createReversal.mock.calls).toEqual([
      [
        transfer_of(gift),
        {
          amount: 9000,
          metadata: {
            refund_id: "re_1",
            dist_id: `dist-${gift.id}-0`,
            donation_id: gift.id,
          },
        },
        { idempotencyKey: `connect-reversal:re_1:dist-${gift.id}-0` },
      ],
    ]);
    expect((await gift_of(gift.id)).status).toBe("refunded");
    expect(await balance_of(db(), gift.npo_ids[0]!)).toBe(0);
    expect(await owed_for_donation(gift.id)).toEqual([]);
  });
});
