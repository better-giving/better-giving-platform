import { eq } from "drizzle-orm";
import Stripe from "stripe";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { seed_npo } from "#/__tests__/fixtures/funds";
import type { IConnectTransferPayload } from "@/queue";
import type { IInput, IParts } from "@/types/donation-dist";
import type { DbOrTx } from "../pg/queries/helpers";
import { bal_txs } from "../pg/schema/bal-tx";
import { donation_disputes } from "../pg/schema/dispute";
import { dists } from "../pg/schema/dist";
import { donations } from "../pg/schema/donation";
import { npos } from "../pg/schema/npo";
import { owed_amounts } from "../pg/schema/owed";
import { payouts } from "../pg/schema/payout";
import { donation_takes } from "../pg/schema/take";
import type { TestDb } from "../pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const stripe = vi.hoisted(() => ({
  paymentIntents: { retrieve: vi.fn() },
  charges: { retrieve: vi.fn() },
  refunds: { list: vi.fn() },
  disputes: { list: vi.fn() },
  transfers: {
    create: vi.fn(),
    list: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    listReversals: vi.fn(),
    createReversal: vi.fn(),
  },
}));
const report_error = vi.hoisted(() => vi.fn());
const enqueue = vi.hoisted(() => vi.fn(async (..._msgs: unknown[]) => {}));

vi.mock("../pg/db", () => ({
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
vi.mock("../kit/stripe", () => ({ stripe }));
// passed through, so a test can run a delivery between a refund's unlocked
// plan read and its apply
vi.mock("../pg/queries/npo", async (importOriginal) => {
  const real = await importOriginal<typeof import("../pg/queries/npo")>();
  return { ...real, npo_get: vi.fn(real.npo_get) };
});
// passed through, so a test can make storing the transfer fail
vi.mock("../pg/queries/dist", async (importOriginal) => {
  const real = await importOriginal<typeof import("../pg/queries/dist")>();
  return {
    ...real,
    dist_stripe_transfer_set: vi.fn(real.dist_stripe_transfer_set),
  };
});
vi.mock("../kit/queue", () => ({ enqueue }));
vi.mock("../kit/slack", () => ({ fiat_monitor: { send_alert: vi.fn() } }));
vi.mock("#/errors/report", () => ({ report_error }));
vi.mock("../env", async (importOriginal) => {
  const real = await importOriginal<typeof import("../env")>();
  return { ...real, stripe: { ...real.stripe, connect_routing: true } };
});

const { create_test_db } = await import("../pg/test-utils/pglite");
const { settle_npo } = await import("../settlement/settle-npo");
const { transfer_routed_dist } = await import("./transfer");
const { release_held_transfers } = await import("./release");
const { calc_settlement_plan } = await import("@/settlement/plan");
const { payout_total } = await import("../payouts/transfer");
const { reversed_statuses } = await import("@/donations/settle");
const { reverse_charge } = await import("../refund/reverse");
const { dist_stripe_transfer_set } = await import("../pg/queries/dist");
const { refund_failed } = await import("../refund/failed");
const { npo_get } = await import("../pg/queries/npo");

const db = () => test_db.current!.db;

const ACCT = "acct_transfer_1";
const DON_ID = "don-transfer-1";
const INTENT = "pi_transfer_1";
const CHARGE = "ch_transfer_1";
/** the group stripe gives a transfer from a charge that has none */
const GROUP = `group_${INTENT}`;
/** when stripe created the transfer these tests make */
const TRANSFER_CREATED_AT = "2026-07-01T00:00:00.000Z";
const TRANSFER_CREATED = Date.parse(TRANSFER_CREATED_AT) / 1000;

/** the transfers stripe has made, as `transfers.list` finds them */
let made: { id: string; transfer_group: string; metadata: object }[] = [];
/** a delivery qstash retries if it throws */
const RETRY = { last: false };

const amt = (base: number, tip = 0, fee_allowance = 0) => ({
  base,
  tip,
  fee_allowance,
});

const parts = (net: number): IParts => ({
  amnt: amt(net),
  amnt_usd: amt(net),
  fa: amt(0),
  sttl: amt(net),
  sttl_fee: amt(0),
  sttl_fa: amt(0),
});

const make_input = (npo_id: number, net = 100): IInput => ({
  id: npo_id,
  ps: parts(net),
  sttl: { id: INTENT, date: "2026-01-01T00:00:00.000Z", currency: "USD" },
  prnt: {
    id: DON_ID,
    to_id: String(npo_id),
    to_name: "Routed NPO",
    to_members: [],
    type: "npo",
  },
  source: undefined,
  program: undefined,
  nav_price: 1,
  tx: {
    currency: "USD",
    upusd: 1,
    frequency: "one-time",
    status: "settled",
    source: "bg-marketplace",
    via: "stripe:card",
    from_email: "d@e.com",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
});

/** settles a routed share and returns the transfer msg the plan carried
 * @param allocation - the npo's stored split, which routing overrides */
async function settle_routed(
  net = 100,
  allocation = { cash: 100, liq: 0, lock: 0 }
) {
  const npo = await seed_npo(db(), {
    registration_number: "EIN-TRANSFER-1",
    name: "Routed NPO",
    hq_country: "United States",
    allocation,
    stripe_account_id: ACCT,
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_details_submitted: true,
    stripe_requirements_due: [],
  });
  await db().insert(donations).values({
    id: DON_ID,
    upusd: 1,
    status: "settled",
    amount_base: net,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
    created_at: "2026-10-23T16:00:00.000Z",
  });
  const { msgs } = await db().transaction((tx) =>
    settle_npo(tx as unknown as DbOrTx, make_input(npo!.id, net))
  );
  const m = msgs.find((x) => x.id === "connect-transfer");
  if (!m) throw new Error("settled pooled");
  return { npo: npo!, payload: m.payload as IConnectTransferPayload };
}

const store_fails_once = () =>
  vi
    .mocked(dist_stripe_transfer_set)
    .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));

const stored = async (dist_id: string) => {
  const [d] = await db().select().from(dists).where(eq(dists.id, dist_id));
  return d?.stripe_transfer_id;
};

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  made = [];
  stripe.paymentIntents.retrieve.mockImplementation(async () => ({
    id: INTENT,
    latest_charge: {
      id: CHARGE,
      transfer_group: made.length > 0 ? GROUP : null,
    },
  }));
  // one transfer, which a create under the same key replays
  stripe.transfers.create.mockImplementation(async (params) => {
    const t = {
      id: "tr_1",
      created: TRANSFER_CREATED,
      ...params,
      transfer_group: GROUP,
    };
    if (!made.some((x) => x.id === t.id)) made.push(t);
    return t;
  });
  stripe.transfers.list.mockImplementation(async function* (q: {
    transfer_group?: string;
  }) {
    yield* made.filter((t) => t.transfer_group === q.transfer_group);
  });
  // no refund on the charge unless a test says so
  stripe.refunds.list.mockResolvedValue({ data: [] });
  stripe.charges.retrieve.mockResolvedValue({
    id: CHARGE,
    amount_captured: 10_000,
  });
  // no dispute lost on the charge unless a test says so
  stripe.disputes.list.mockResolvedValue({ data: [] });
  stripe.transfers.retrieve.mockResolvedValue({
    id: "tr_1",
    amount: 10_000,
    amount_reversed: 0,
    source_transaction: CHARGE,
    metadata: {},
  });
  stripe.transfers.listReversals.mockResolvedValue({ data: [] });
  stripe.transfers.createReversal.mockResolvedValue({ id: "trr_1" });
  await db().delete(owed_amounts);
  await db().delete(donation_disputes);
  await db().delete(donation_takes);
  await db().delete(payouts);
  await db().delete(bal_txs);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(npos);
});

describe("transfer_routed_dist", () => {
  test("pays the routed net to the account from the donation's charge, and stores it", async () => {
    const { payload } = await settle_routed();

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.paymentIntents.retrieve.mock.calls[0]![0]).toBe(INTENT);
    expect(stripe.transfers.create).toHaveBeenCalledExactlyOnceWith(
      {
        amount: 10000,
        currency: "usd",
        destination: ACCT,
        source_transaction: CHARGE,
        metadata: { donation_id: DON_ID, dist_id: payload.dist_id },
      },
      { idempotencyKey: `connect-transfer:${payload.dist_id}` }
    );
    expect(await stored(payload.dist_id)).toBe("tr_1");
    const [paid] = await db()
      .select({ at: dists.stripe_transfer_created_at })
      .from(dists)
      .where(eq(dists.id, payload.dist_id));
    expect(paid?.at).toBe(TRANSFER_CREATED_AT);
  });

  test("a redelivery after the transfer is stored never transfers again", async () => {
    const { payload } = await settle_routed();
    await transfer_routed_dist(payload, RETRY);

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(await stored(payload.dist_id)).toBe("tr_1");
  });

  // neither sees the other's store, so stripe's idempotency key is what holds
  test("two deliveries racing ask stripe for one transfer under one key", async () => {
    const { payload } = await settle_routed();

    await Promise.all([
      transfer_routed_dist(payload, RETRY),
      transfer_routed_dist(payload, RETRY),
    ]);

    const keys = stripe.transfers.create.mock.calls.map(
      (c) => (c[1] as { idempotencyKey: string }).idempotencyKey
    );
    expect(keys).toEqual([
      `connect-transfer:${payload.dist_id}`,
      `connect-transfer:${payload.dist_id}`,
    ]);
    expect(await stored(payload.dist_id)).toBe("tr_1");
    expect(report_error).not.toHaveBeenCalled();
  });

  test("reports a dist already paid by a different transfer", async () => {
    const { payload } = await settle_routed();
    // another transfer is stored while this one is in flight
    stripe.transfers.create.mockImplementationOnce(async () => {
      await db()
        .update(dists)
        .set({ stripe_transfer_id: "tr_other" })
        .where(eq(dists.id, payload.dist_id));
      return { id: "tr_1", created: TRANSFER_CREATED };
    });

    await transfer_routed_dist(payload, RETRY);

    expect(await stored(payload.dist_id)).toBe("tr_other");
    expect(report_error).toHaveBeenCalledOnce();
    expect(report_error.mock.calls[0]![1]).toMatchObject({
      donation_id: DON_ID,
      dist_id: payload.dist_id,
      transfer_id: "tr_1",
      stored_transfer_id: "tr_other",
    });
  });

  test("transfers what the pooled path would pay out for the same share", async () => {
    // a fund's two members splitting a 20.35 net each get a half cent
    const { npo, payload } = await settle_routed(10.175);
    const pooled = calc_settlement_plan(
      make_input(npo.id, 10.175),
      {
        ...npo,
        allocation: { cash: 100, liq: 0, lock: 0 },
      },
      null
    );

    await transfer_routed_dist(payload, RETRY);

    const [[params]] = stripe.transfers.create.mock.calls;
    // the grants run's figure for that payout, half down to 10.17
    expect(params.amount).toBe(1017);
    expect(params.amount).toBe(
      Math.round(payout_total([pooled.payout!.amount]) * 100)
    );
  });

  test("a transfer stripe could not take throws for the queue to retry, naming its dist", async () => {
    const { payload } = await settle_routed();
    stripe.transfers.create.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ message: "socket hang up" })
    );

    const err = await transfer_routed_dist(payload, RETRY).catch(
      (e: Error) => e
    );

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(payload.dist_id);
    expect((err as Error).message).toContain(DON_ID);
    expect(await stored(payload.dist_id)).toBeNull();
    // a retry follows, so ops isn't told yet
    expect(enqueue).not.toHaveBeenCalled();
  });

  const refusals = [
    [
      "an account that revoked our access",
      new Stripe.errors.StripePermissionError({
        message: "The provided key does not have access to account",
      }),
    ],
    [
      "a destination it can no longer pay",
      new Stripe.errors.StripeInvalidRequestError({
        message: "No such destination",
        code: "resource_missing",
      }),
    ],
  ] as const;

  const row = async (dist_id: string) => {
    const [d] = await db().select().from(dists).where(eq(dists.id, dist_id));
    return d!;
  };
  const notices = () =>
    enqueue.mock.calls
      .flat()
      .filter((m) => (m as { id: string }).id === "fiat-notice") as {
      dedupe: string;
      payload: { alert: { body: string } };
    }[];

  // a retry is the same request under the same idempotency key, so it can
  // only be refused again
  test.each(refusals)(
    "settles the share pooled when stripe refuses %s, and tells ops",
    async (_case, refusal) => {
      const { npo, payload } = await settle_routed(100, {
        cash: 60,
        liq: 40,
        lock: 0,
      });
      stripe.transfers.create.mockRejectedValueOnce(refusal);

      await expect(
        transfer_routed_dist(payload, RETRY)
      ).resolves.toBeUndefined();

      // what a pooled settle of the same share books
      const pooled = calc_settlement_plan(make_input(npo.id), npo, null);
      const dist = await row(payload.dist_id);
      expect(dist.stripe_routed_to).toBeNull();
      expect(dist.alloc).toEqual({ cash: 60, liq: 40, lock: 0 });
      const [payout] = await db().select().from(payouts);
      expect(payout).toMatchObject({
        source_id: payload.dist_id,
        npo_id: npo.id,
        amount: pooled.payout!.amount,
        type: "pending",
      });
      expect(payout!.amount).toBe(60);
      const txs = await db().select().from(bal_txs);
      expect(txs.map((t) => [t.account, t.amount, t.account_other_id])).toEqual(
        [["liq", 40, payload.dist_id]]
      );
      const [after] = await db().select().from(npos).where(eq(npos.id, npo.id));
      expect({ cash: after!.cash, liq: after!.liq }).toEqual({
        cash: 60,
        liq: 40,
      });

      const [notice] = notices();
      expect(notice!.dedupe).toBe(
        `fiat.notice_connect-refused_${payload.dist_id}`
      );
      expect(notice!.payload.alert.body).toContain(DON_ID);
      expect(notice!.payload.alert.body).toContain(payload.dist_id);
      expect((report_error.mock.calls[0]![0] as Error).cause).toBe(refusal);
    }
  );

  test("a redelivery after the pooled rebook books nothing more and tells ops again", async () => {
    const { payload } = await settle_routed();
    stripe.transfers.create.mockRejectedValueOnce(refusals[0][1]);
    await transfer_routed_dist(payload, RETRY);

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(await db().select().from(payouts)).toHaveLength(1);
    // a notice lost between the rebook's commit and its enqueue goes again
    expect(notices().map((n) => n.dedupe)).toEqual([
      `fiat.notice_connect-refused_${payload.dist_id}`,
      `fiat.notice_connect-refused_${payload.dist_id}`,
    ]);
  });

  // both read the dist routed before either rebooks it
  test("two refused deliveries racing book the share pooled once", async () => {
    const { payload } = await settle_routed();
    stripe.transfers.create.mockRejectedValue(refusals[0][1]);

    await Promise.all([
      transfer_routed_dist(payload, RETRY),
      transfer_routed_dist(payload, RETRY),
    ]);

    expect(stripe.transfers.create).toHaveBeenCalledTimes(2);
    expect(await db().select().from(payouts)).toHaveLength(1);
    const [after] = await db().select().from(npos);
    expect(after!.cash).toBe(100);
  });

  // the refund recorded nothing while the dist was routed: its cut was to come
  // off the transfer
  test("a refusal after a partial refund books the share less the refund's cut", async () => {
    const { payload } = await settle_routed();
    stripe.refunds.list.mockResolvedValue({
      data: [
        { id: "re_1", amount: 2_500, status: "succeeded", created: 1 },
        // stripe won't send it, so it takes nothing
        { id: "re_2", amount: 1_000, status: "failed", created: 2 },
      ],
    });
    stripe.transfers.create.mockRejectedValueOnce(refusals[0][1]);

    await transfer_routed_dist(payload, RETRY);

    const [payout] = await db().select().from(payouts);
    expect(payout!.amount).toBe(75);
    const [after] = await db().select().from(npos);
    expect(after!.cash).toBe(75);
    expect(notices()[0]!.payload.alert.body).toContain("refund");
  });

  /** the charge.refunded event for stripe refund `id` of `cents` of the
   * $100 charge, as the refund core takes it */
  const refund_event = (id: string, cents: number) =>
    reverse_charge({
      donation_id: DON_ID,
      rail: "stripe",
      source: "refund",
      share: { taken: cents, of: 10_000 },
      refunds: [{ id, amount: cents }],
      source_ref: id,
      alert_from: "charge-refunded",
      notice: { id: `evt_${id}`, lines: [] },
    });

  // the rebook booked $75 for the 75% left; refunding that takes back $75
  test("refunding the rest after a refusal takes back what the rebook booked, no more", async () => {
    const { npo, payload } = await settle_routed();
    const re_1 = { id: "re_1", amount: 2_500, status: "succeeded", created: 1 };
    stripe.refunds.list.mockResolvedValue({ data: [re_1] });
    await refund_event("re_1", 2_500);
    stripe.transfers.create.mockRejectedValueOnce(refusals[0][1]);
    await transfer_routed_dist(payload, RETRY);

    const res = await refund_event("re_2", 7_500);

    expect(res).toMatchObject({ status: "reversed" });
    const [after] = await db().select().from(npos).where(eq(npos.id, npo.id));
    expect(after!.cash).toBe(0);
    const [payout] = await db().select().from(payouts);
    expect([payout!.amount, payout!.type]).toEqual([75, "refunded"]);
  });

  // it can still fail, and a refused dist has no transfer to give a cut back
  // from: once sent, it is taken back as a pooled share's refund is
  test("a refusal books the whole share while the charge's refund is still unsent", async () => {
    const { payload } = await settle_routed();
    stripe.refunds.list.mockResolvedValue({
      data: [{ id: "re_1", amount: 2_500, status: "pending", created: 1 }],
    });
    stripe.transfers.create.mockRejectedValueOnce(refusals[0][1]);

    await transfer_routed_dist(payload, RETRY);

    const [payout] = await db().select().from(payouts);
    expect(payout!.amount).toBe(100);
    const [after] = await db().select().from(npos);
    expect(after!.cash).toBe(100);
  });

  // the refund core took nothing back: the dist was routed, so it had none
  test("a refusal racing a full refund unroutes the share and books nothing", async () => {
    const { payload } = await settle_routed();
    stripe.transfers.create.mockImplementationOnce(async () => {
      await db()
        .update(donations)
        .set({ status: "refunded" })
        .where(eq(donations.id, DON_ID));
      throw refusals[0][1];
    });

    await transfer_routed_dist(payload, RETRY);

    expect((await row(payload.dist_id)).stripe_routed_to).toBeNull();
    expect(await db().select().from(payouts)).toEqual([]);
    const [after] = await db().select().from(npos);
    expect(after!.cash).toBe(0);
    expect(notices()[0]!.payload.alert.body).toContain("refunded");
  });

  // stripe may have made the transfer it never answered for
  test("the last attempt at a transfer stripe never answered tells ops and leaves it routed", async () => {
    const { payload } = await settle_routed();
    stripe.transfers.create.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ message: "socket hang up" })
    );

    await expect(transfer_routed_dist(payload, { last: true })).rejects.toThrow(
      payload.dist_id
    );

    const [notice] = notices();
    expect(notice!.dedupe).toBe(
      `fiat.notice_connect-unanswered_${payload.dist_id}`
    );
    expect(notice!.payload.alert.body).toContain(DON_ID);
    expect((await row(payload.dist_id)).stripe_routed_to).toBe(ACCT);
    expect(await db().select().from(payouts)).toEqual([]);
  });

  // past stripe's 24h hold on the idempotency key, a create makes another
  test("a retry after the transfer's store failed stores the one stripe made, and makes none", async () => {
    const { payload } = await settle_routed();
    store_fails_once();
    await expect(transfer_routed_dist(payload, RETRY)).rejects.toThrow();
    stripe.transfers.create.mockResolvedValue({
      id: "tr_2",
      created: TRANSFER_CREATED,
    });

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(await stored(payload.dist_id)).toBe("tr_1");
  });

  test("a retry after the transfer's store failed reverses it once the donation was refunded meanwhile", async () => {
    const { payload } = await settle_routed();
    store_fails_once();
    await expect(transfer_routed_dist(payload, RETRY)).rejects.toThrow();
    await db()
      .update(donations)
      .set({ status: "refunded" })
      .where(eq(donations.id, DON_ID));
    stripe.refunds.list.mockResolvedValue({
      data: [{ id: "re_1", amount: 10_000, status: "succeeded", created: 1 }],
    });

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(await stored(payload.dist_id)).toBe("tr_1");
    expect(stripe.transfers.createReversal.mock.calls).toEqual([
      [
        "tr_1",
        {
          amount: 10_000,
          metadata: {
            refund_id: "re_1",
            dist_id: payload.dist_id,
            donation_id: DON_ID,
          },
        },
        { idempotencyKey: `connect-reversal:re_1:${payload.dist_id}` },
      ],
    ]);
  });

  // the transfer it looks for may exist: rebooking would pay the share twice
  test("a refused lookup of an earlier transfer throws for a retry and rebooks nothing", async () => {
    const { payload } = await settle_routed();
    stripe.transfers.list.mockImplementationOnce(() => {
      throw refusals[0][1];
    });

    await expect(transfer_routed_dist(payload, RETRY)).rejects.toThrow(
      payload.dist_id
    );

    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect((await row(payload.dist_id)).stripe_routed_to).toBe(ACCT);
    expect(await db().select().from(payouts)).toEqual([]);
  });

  // the plan names the dist settle_npo writes; a mismatch must not pass quietly
  test("reports a transfer for a dist that doesn't exist", async () => {
    const { payload } = await settle_routed();

    await transfer_routed_dist({ ...payload, dist_id: "no-such-dist" }, RETRY);

    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(report_error).toHaveBeenCalledOnce();
    expect(report_error.mock.calls[0]![1]).toMatchObject({
      donation_id: DON_ID,
      dist_id: "no-such-dist",
    });
  });

  test.each(reversed_statuses)(
    "never pays out a donation %s before its transfer ran",
    async (status) => {
      const { payload } = await settle_routed();
      await db()
        .update(donations)
        .set({ status })
        .where(eq(donations.id, DON_ID));

      await expect(
        transfer_routed_dist(payload, RETRY)
      ).resolves.toBeUndefined();

      expect(stripe.transfers.create).not.toHaveBeenCalled();
      expect(report_error).toHaveBeenCalledOnce();
      expect(report_error.mock.calls[0]![1]).toMatchObject({
        donation_id: DON_ID,
        dist_id: payload.dist_id,
        status,
      });
    }
  );
});

describe("a refund that landed before the transfer ran", () => {
  const refunded = (amount: number, status = "succeeded") =>
    stripe.refunds.list.mockResolvedValue({
      data: [{ id: "re_1", amount, status, created: 1_790_000_000 }],
    });

  // no refund event after it will see the transfer, so the transfer reverses
  // the refunded share itself; the transfer itself stays the one its key names
  test("transfers the routed net, then reverses the refunded share from it", async () => {
    const { payload } = await settle_routed();
    refunded(4_000);

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create.mock.calls[0]![0]).toMatchObject({
      amount: 10_000,
    });
    expect(stripe.transfers.createReversal.mock.calls).toEqual([
      [
        "tr_1",
        {
          amount: 4_000,
          metadata: {
            refund_id: "re_1",
            dist_id: payload.dist_id,
            donation_id: DON_ID,
          },
        },
        { idempotencyKey: `connect-reversal:re_1:${payload.dist_id}` },
      ],
    ]);
  });

  test("leaves a refund still unsent to the refund event that sees it sent", async () => {
    const { payload } = await settle_routed();
    refunded(4_000, "pending");

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  test("a delivery retried after the reversal failed reverses it, transferring nothing more", async () => {
    const { payload } = await settle_routed();
    refunded(4_000);
    stripe.transfers.createReversal.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ message: "socket hang up" })
    );
    await expect(transfer_routed_dist(payload, RETRY)).rejects.toThrow();

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(stripe.transfers.createReversal).toHaveBeenCalledTimes(2);
    expect(stripe.transfers.createReversal.mock.calls[1]![1]).toMatchObject({
      amount: 4_000,
    });
  });
});

describe("a dispute open before the transfer ran", () => {
  const dispute_row = (status: "open" | "won" | "lost") =>
    db()
      .insert(donation_disputes)
      .values({
        id: "dp_1",
        donation_id: DON_ID,
        opened_at: "2026-07-01T00:00:00.000Z",
        status,
        ...(status !== "open" && { closed_at: "2026-07-02T00:00:00.000Z" }),
      });

  /** stripe marks the charge disputed as the dispute opens */
  const charge_disputed = () =>
    stripe.paymentIntents.retrieve.mockResolvedValue({
      id: INTENT,
      latest_charge: { id: CHARGE, transfer_group: null, disputed: true },
    });

  test("holds the transfer while the gift's dispute is on record open", async () => {
    const { payload } = await settle_routed();
    await dispute_row("open");

    await expect(transfer_routed_dist(payload, RETRY)).resolves.toBeUndefined();

    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(await stored(payload.dist_id)).toBeNull();
    expect(report_error).not.toHaveBeenCalled();
  });

  // the dispute's webhook hasn't landed yet
  test("holds the transfer when the charge reads disputed and no dispute is on record", async () => {
    const { payload } = await settle_routed();
    charge_disputed();

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(await stored(payload.dist_id)).toBeNull();
  });

  // stripe keeps `disputed` true after the dispute closes
  test("sends once the gift's dispute is on record closed won, the charge still reading disputed", async () => {
    const { payload } = await settle_routed();
    charge_disputed();
    await dispute_row("won");

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(await stored(payload.dist_id)).toBe("tr_1");
  });

  const close_row = (status: "won" | "lost") =>
    db()
      .update(donation_disputes)
      .set({ status, closed_at: "2026-07-02T00:00:00.000Z" })
      .where(eq(donation_disputes.id, "dp_1"));

  /** the connect-transfer messages enqueued so far */
  const transfers_enqueued = () =>
    enqueue.mock.calls
      .flat()
      .filter((m) => (m as { id: string }).id === "connect-transfer") as {
      dedupe: string;
      payload: IConnectTransferPayload;
    }[];

  test("a win releases the held transfer: sent exactly once, a retry of the held delivery sending nothing more", async () => {
    const { payload } = await settle_routed();
    await dispute_row("open");
    await transfer_routed_dist(payload, RETRY);
    await close_row("won");

    const released = await release_held_transfers(DON_ID, INTENT, "dp_1");

    expect(released.map((d) => d.id)).toEqual([payload.dist_id]);
    const [m] = transfers_enqueued();
    expect(m).toMatchObject({
      dedupe: `connect.transfer_${payload.dist_id}_dp_1`,
      payload: { ...payload, release: "dp_1" },
    });
    await transfer_routed_dist(m!.payload, RETRY);
    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(await stored(payload.dist_id)).toBe("tr_1");
  });

  test("releases nothing while a dispute on the gift is still open", async () => {
    await settle_routed();
    await dispute_row("open");

    expect(await release_held_transfers(DON_ID, INTENT, "dp_1")).toEqual([]);
    expect(transfers_enqueued()).toEqual([]);
  });

  test.each(reversed_statuses)(
    "releases nothing once the donation is %s",
    async (status) => {
      await settle_routed();
      await dispute_row("lost");
      await db()
        .update(donations)
        .set({ status })
        .where(eq(donations.id, DON_ID));

      expect(await release_held_transfers(DON_ID, INTENT, "dp_1")).toEqual([]);
      expect(transfers_enqueued()).toEqual([]);
    }
  );

  test("releases nothing for a share already transferred", async () => {
    const { payload } = await settle_routed();
    await transfer_routed_dist(payload, RETRY);
    await dispute_row("won");

    expect(await release_held_transfers(DON_ID, INTENT, "dp_1")).toEqual([]);
  });

  // the release sends the whole net; the job's own reversal then takes back
  // the lost part
  test("a partial loss's release sends the net, then reverses the lost cut from it", async () => {
    const { payload } = await settle_routed();
    await dispute_row("open");
    await transfer_routed_dist(payload, RETRY);
    await close_row("lost");
    stripe.disputes.list.mockResolvedValue({
      data: [{ id: "dp_1", amount: 4_000, status: "lost", created: 2 }],
    });

    await release_held_transfers(DON_ID, INTENT, "dp_1");
    await transfer_routed_dist(transfers_enqueued()[0]!.payload, RETRY);

    expect(stripe.disputes.list).toHaveBeenCalledWith({
      charge: CHARGE,
      limit: 100,
    });
    expect(stripe.transfers.create.mock.calls[0]![0]).toMatchObject({
      amount: 10_000,
    });
    expect(stripe.transfers.createReversal.mock.calls).toEqual([
      [
        "tr_1",
        {
          amount: 4_000,
          metadata: {
            dispute_id: "dp_1",
            dist_id: payload.dist_id,
            donation_id: DON_ID,
          },
        },
        { idempotencyKey: `connect-reversal:dp_1:${payload.dist_id}` },
      ],
    ]);
  });

  // the cuts run oldest first, each once whichever event reverses it
  test("a refund and a lost dispute on the charge each reverse their own cut once", async () => {
    const { payload } = await settle_routed();
    stripe.refunds.list.mockResolvedValue({
      data: [{ id: "re_1", amount: 2_500, status: "succeeded", created: 1 }],
    });
    stripe.disputes.list.mockResolvedValue({
      data: [
        { id: "dp_1", amount: 4_000, status: "lost", created: 2 },
        // still open: nothing of it is taken yet
        { id: "dp_2", amount: 1_000, status: "needs_response", created: 3 },
      ],
    });
    await dispute_row("lost");
    await transfer_routed_dist(payload, RETRY);
    stripe.transfers.listReversals.mockResolvedValue({
      data: stripe.transfers.createReversal.mock.calls.map(([, p]) => p),
    });

    await transfer_routed_dist(payload, RETRY);

    expect(
      stripe.transfers.createReversal.mock.calls.map(([, p]) => [
        p.amount,
        p.metadata.refund_id ?? p.metadata.dispute_id,
      ])
    ).toEqual([
      [2_500, "re_1"],
      [4_000, "dp_1"],
    ]);
  });

  // the hold is a send not made; a transfer stripe has made is stored as ever
  test("stores a transfer an earlier delivery made, though a dispute opened since", async () => {
    const { payload } = await settle_routed();
    store_fails_once();
    await expect(transfer_routed_dist(payload, RETRY)).rejects.toThrow();
    await dispute_row("open");

    await transfer_routed_dist(payload, RETRY);

    expect(stripe.transfers.create).toHaveBeenCalledOnce();
    expect(await stored(payload.dist_id)).toBe("tr_1");
  });
});

describe("a share rebooked pooled after its transfer was refused", () => {
  const REFUSED = new Stripe.errors.StripePermissionError({
    message: "The provided key does not have access to account",
  });

  const refund_event = (id: string, cents: number) =>
    reverse_charge({
      donation_id: DON_ID,
      rail: "stripe",
      source: "refund",
      share: { taken: cents, of: 10_000 },
      refunds: [{ id, amount: cents }],
      source_ref: id,
      alert_from: "charge-refunded",
      notice: { id: `evt_${id}`, lines: [] },
    });

  /** a $100 routed share, $25 of its charge refunded, then its transfer
   * refused: rebooked pooled at $75 */
  async function rebooked_after_refund() {
    const routed = await settle_routed();
    stripe.refunds.list.mockResolvedValue({
      data: [{ id: "re_1", amount: 2_500, status: "succeeded", created: 1 }],
    });
    await refund_event("re_1", 2_500);
    stripe.transfers.create.mockRejectedValueOnce(REFUSED);
    await transfer_routed_dist(routed.payload, RETRY);
    return routed;
  }

  /** the grants run paid the rebooked share out */
  const grant_paid = () => db().update(payouts).set({ type: "settled" });

  const npo_owes = async () =>
    (await db().select().from(owed_amounts)).map((o) => [
      o.npo_id,
      o.received_usd,
    ]);

  test("the rebook stores the settled net beside the booked remainder", async () => {
    await rebooked_after_refund();
    const [dist] = await db().select().from(dists);
    expect(dist).toMatchObject({
      net: 75,
      refunds_cut_share: 0.25,
      settled_net: 100,
    });
  });

  // 25% of the charge was cut off the booking; the next 50% owes $50 of the
  // $100 net, not 75% of the $75 booked
  test("a refund after the grant went out owes its own share of the routed net", async () => {
    const { npo } = await rebooked_after_refund();
    await grant_paid();

    await refund_event("re_2", 5_000);

    expect(await npo_owes()).toEqual([[npo.id, 50]]);
  });

  // the cut came off the booking for good: nothing on record gives it back
  test("a cut refund that then fails tells ops the npo is short its cut", async () => {
    const { payload } = await rebooked_after_refund();

    const res = await refund_failed({
      donation_id: DON_ID,
      rail: "stripe",
      refund_id: "re_1",
    });

    expect(res.status).toBe("by_hand");
    const lines = res.status === "by_hand" ? res.by_hand : [];
    const short = lines.filter((l) => l.includes("short"));
    expect(short).toHaveLength(1);
    expect(short[0]).toContain(`dist ${payload.dist_id}`);
    expect(short[0]).toMatch(/short \$25\.00\b/);
  });

  test("a refund after the rebook that then fails leaves the cut standing, short nothing", async () => {
    await rebooked_after_refund();
    await refund_event("re_2", 5_000);

    const res = await refund_failed({
      donation_id: DON_ID,
      rail: "stripe",
      refund_id: "re_2",
    });

    const lines = res.status === "by_hand" ? res.by_hand : [];
    expect(lines.filter((l) => l.includes("short"))).toEqual([]);
  });

  // what is left on record is the cut refund alone, which owes nothing
  test("the refund that reversed a paid-out rebook failing credits back all it recorded", async () => {
    await rebooked_after_refund();
    await grant_paid();
    // 3/4 of its card fee is the part of the charge the cut left
    await db().update(dists).set({ fee_processing: 4 });
    await refund_event("re_2", 7_500);
    const [recorded] = await db().select().from(owed_amounts);
    expect(recorded!.outstanding_usd).toBe(78);

    await refund_failed({
      donation_id: DON_ID,
      rail: "stripe",
      refund_id: "re_2",
    });

    const [after] = await db().select().from(owed_amounts);
    expect(after!.outstanding_usd).toBe(0);
  });

  // the refund read the share routed; the rebook committed before it applied
  test("a full refund racing the rebook takes back what the rebook booked", async () => {
    const { npo, payload } = await settle_routed();
    stripe.transfers.create.mockRejectedValueOnce(REFUSED);
    const plan_read = vi.mocked(npo_get).getMockImplementation()!;
    vi.mocked(npo_get).mockImplementationOnce(async (...args) => {
      await transfer_routed_dist(payload, RETRY);
      return plan_read(...args);
    });

    const res = await refund_event("re_1", 10_000);

    expect(res).toMatchObject({ status: "reversed" });
    const [after] = await db().select().from(npos).where(eq(npos.id, npo.id));
    expect(after!.cash).toBe(0);
    const [payout] = await db().select().from(payouts);
    expect([payout!.amount, payout!.type]).toEqual([100, "refunded"]);
  });
});
