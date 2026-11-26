import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { alert_text } from "#/__tests__/fixtures/alert-text";
import type { DbOrTx } from "$/pg/queries/helpers";
import type { TestDb } from "$/pg/test-utils/pglite";

// the webhook route with its real refund handlers over pglite; stripe's api
// and the queue are the boundary
const construct_event_mock = vi.hoisted(() => vi.fn());
const charge_retrieve_mock = vi.hoisted(() => vi.fn());
const refunds_list_mock = vi.hoisted(() => vi.fn());
const enqueue_mock = vi.hoisted(() => vi.fn());
const invoice_payments_list_mock = vi.hoisted(() => vi.fn());
const report_error_mock = vi.hoisted(() => vi.fn());
const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("$/kit/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: construct_event_mock },
    charges: { retrieve: charge_retrieve_mock },
    refunds: { list: refunds_list_mock },
    invoicePayments: { list: invoice_payments_list_mock },
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
vi.mock("$/kit/queue", () => ({ enqueue: enqueue_mock }));
vi.mock("$/kit/slack", () => ({ fiat_monitor: { send_alert: vi.fn() } }));
vi.mock("#/errors/report", () => ({ report_error: report_error_mock }));

const { action } = await import("./route");
const { owed_for_donation, recover_owed } = await import("$/pg/queries/owed");
const { donations } = await import("$/pg/schema/donation");
const { owed_amounts } = await import("$/pg/schema/owed");
const { takes_of } = await import("$/pg/queries/take");
const { taken_of } = await import("$/refund/takes");
const {
  PAID_GRANT,
  clear_card_gifts,
  name_card_gift,
  seed_card_gift,
  seed_paid_commission,
} = await import("#/__tests__/fixtures/card-gift");

const db = () => test_db.current!.db;

type Gift = Awaited<ReturnType<typeof seed_card_gift>>;

interface IRefund {
  id: string;
  amount: number;
  status: string;
  created: number;
}

/** stripe's side of the gift's one $100 usd charge; refunds newest first, as
 * stripe lists them */
let refunds: IRefund[] = [];
let charge_of: Gift;
let clock = 1_790_000_000;
let event_n = 0;

// stripe doesn't document whether its refunded total counts a pending refund
// or drops a failed one, so the charge stripe returns here carries none: the
// share is read off the refund list
const charge_now = () => ({
  id: `ch_${charge_of.id}`,
  payment_intent: charge_of.sttl_id,
  currency: "usd",
  amount: 10_000,
  amount_captured: 10_000,
});

/** the event's own copy of the charge, which names its refunded total */
const live_refunded = () =>
  refunds
    .filter((r) => r.status !== "failed" && r.status !== "canceled")
    .reduce((sum, r) => sum + r.amount, 0);

/** support refunds `amount` cents; returns the charge.refunded stripe sends.
 * a bank refund (ach, acss) starts pending */
const refund = (amount: number, status = "succeeded") => {
  const before = live_refunded();
  clock += 60;
  refunds.unshift({
    id: `re_${refunds.length + 1}`,
    amount,
    status,
    created: clock,
  });
  return {
    id: `evt_${++event_n}`,
    type: "charge.refunded",
    created: clock,
    data: {
      object: { ...charge_now(), amount_refunded: live_refunded() },
      previous_attributes: { amount_refunded: before },
    },
  };
};

/** the bank settles refund `id` as `status`; returns stripe's refund.updated */
const settle = (id: string, status: string) => {
  const r = refunds.find((x) => x.id === id);
  if (!r) throw new Error(`no refund ${id}`);
  const previous = r.status;
  r.status = status;
  clock += 60;
  return {
    id: `evt_${++event_n}`,
    type: "refund.updated",
    created: clock,
    data: {
      object: { ...r, charge: charge_now().id, currency: "usd" },
      previous_attributes: { status: previous },
    },
  };
};

/** the bank returns refund `id` to stripe; returns stripe's refund.failed */
const fail = (id: string) => {
  const r = refunds.find((x) => x.id === id);
  if (!r) throw new Error(`no refund ${id}`);
  r.status = "failed";
  clock += 60;
  return {
    id: `evt_${++event_n}`,
    type: "refund.failed",
    created: clock,
    data: {
      object: {
        ...r,
        charge: charge_now().id,
        payment_intent: charge_of.sttl_id,
        currency: "usd",
        failure_reason: "expired_or_canceled_card",
      },
    },
  };
};

/** the finance alert a failed refund posts, title and body */
const failed_alert = () => {
  const [m, ...rest] = enqueue_mock.mock.calls
    .flat()
    .filter((x) => x.payload?.alert?.title === "Stripe Refund Failed");
  if (rest.some((x) => x.dedupe !== m.dedupe)) {
    throw new Error("more than one alert");
  }
  return m ? `${m.payload.alert.title}\n${m.payload.alert.body}` : undefined;
};

/** stripe's `type` event for a chargeback of `amount` cents on the charge,
 * its funds withdrawn with a $15 fee; `status` as stripe has it then */
const dispute_event = (type: string, amount: number, status: string) => {
  clock += 60;
  return {
    id: `evt_${++event_n}`,
    type,
    created: clock,
    data: {
      object: {
        id: `du_${charge_of.id}`,
        object: "dispute",
        amount,
        currency: "usd",
        charge: charge_now().id,
        payment_intent: charge_of.sttl_id,
        reason: "fraudulent",
        status,
        created: clock,
        evidence_details: { due_by: clock + 14 * 86_400 },
        balance_transactions: [
          { id: "txn_dsp", amount: -amount, fee: 1_500, currency: "usd" },
        ],
      },
    },
  };
};

/** verified by the mocked signature check, then handled for real */
const deliver = async (event: object) => {
  construct_event_mock.mockReturnValue(event);
  const request = new Request("https://x/api/stripe-webhook", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "t=1,v1=ok" },
  });
  return (await action({ request } as any)) as Response;
};

/** every ops notice queued so far, as ops read them */
const notice_text = () =>
  enqueue_mock.mock.calls
    .flat()
    .filter((m) => m.id === "fiat-notice")
    .map((m) => alert_text(m.payload.alert))
    .join("\n");

/** the gift's status, and what its active takes take back */
const gift_of = async (donation_id: string) => {
  const [row] = await db()
    .select({ status: donations.status })
    .from(donations)
    .where(eq(donations.id, donation_id));
  return {
    status: row?.status,
    taken: taken_of(await takes_of(db() as unknown as DbOrTx, donation_id)),
  };
};

/** each party's row on the gift, npos by id */
const owed_of = async (donation_id: string) =>
  (await owed_for_donation(donation_id))
    .sort((a, b) => (a.npo_id ?? Infinity) - (b.npo_id ?? Infinity))
    .map((o) => ({
      npo_id: o.npo_id,
      source_ref: o.source_ref,
      received_usd: o.received_usd,
      fee_processing_usd: o.fee_processing_usd,
      outstanding_usd: o.outstanding_usd,
    }));

beforeAll(async () => {
  const { create_test_db } = await import("$/pg/test-utils/pglite");
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  refunds = [];
  enqueue_mock.mockResolvedValue(undefined);
  invoice_payments_list_mock.mockResolvedValue({ data: [] });
  charge_retrieve_mock.mockImplementation(async () => charge_now());
  refunds_list_mock.mockImplementation(async () => ({ data: [...refunds] }));
  await db().delete(owed_amounts);
  await clear_card_gifts(db());
});

describe("a partial refund on a gift whose grant went out", () => {
  it("records the npo's share of what it received plus its card fee, and leaves the gift settled and partly refunded", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);

    const res = await deliver(refund(4_000));

    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toEqual([
      {
        npo_id: charge_of.npo_ids[0],
        source_ref: "re_1",
        received_usd: 36,
        fee_processing_usd: 1.28,
        outstanding_usd: 37.28,
      },
    ]);
    expect(await gift_of(charge_of.id)).toEqual({
      status: "settled",
      taken: 0.4,
    });
    expect(notice_text()).toMatch(
      /^Partial refund recorded as owed · \$40\.00 to /m
    );
  });

  it("reverses the gift once a later refund completes the charge, the row ending at the full-refund figure", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));

    const res = await deliver(refund(6_000));

    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toMatchObject([
      { received_usd: 90, fee_processing_usd: 3.2, outstanding_usd: 93.2 },
    ]);
    expect((await gift_of(charge_of.id))?.status).toBe("refunded_loss");
    expect(notice_text()).not.toMatch(/undo|hand adjustment/i);
  });

  it("ends two $50 refunds where one full refund ends, each redelivery changing nothing", async () => {
    const full = await seed_card_gift(db(), PAID_GRANT);
    charge_of = full;
    await deliver(refund(10_000));
    const one_full = await owed_of(full.id);

    refunds = [];
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    const first = refund(5_000);
    await deliver(first);
    await deliver(first);
    const at_half = await owed_of(charge_of.id);
    const second = refund(5_000);
    await deliver(second);
    await deliver(second);

    expect(at_half).toMatchObject([{ outstanding_usd: 46.6 }]);
    const without_npo = (rows: typeof one_full) =>
      rows.map(({ npo_id: _, ...o }) => o);
    expect(without_npo(await owed_of(charge_of.id))).toEqual(
      without_npo(one_full)
    );
    expect(one_full).toMatchObject([{ outstanding_usd: 93.2 }]);
    expect((await gift_of(charge_of.id))?.status).toBe(
      (await gift_of(full.id))?.status
    );
  });
});

describe("a partial refund on a gift whose payout is still pending", () => {
  it("records nothing owed, and tells ops the pending grant is why", async () => {
    charge_of = await seed_card_gift(db(), {
      ...PAID_GRANT,
      payout: "pending",
    });

    const res = await deliver(refund(4_000));

    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toEqual([]);
    expect((await gift_of(charge_of.id))?.status).toBe("settled");
    expect(notice_text()).toMatch(
      /^Partial refund not reversed · [\s\S]*grant payout is still pending/m
    );
  });
});

describe("a partial bank refund that starts pending", () => {
  it("records nothing until refund.updated says it succeeded, then its share", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);

    await deliver(refund(4_000, "pending"));
    const while_pending = await owed_of(charge_of.id);
    const res = await deliver(settle("re_1", "succeeded"));

    expect(while_pending).toEqual([]);
    expect(notice_text()).toMatch(
      /^Reversal held until the refund succeeds · /m
    );
    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toMatchObject([
      { source_ref: "re_1", outstanding_usd: 37.28 },
    ]);
    expect((await gift_of(charge_of.id))?.status).toBe("settled");
  });

  it("names the nonprofit and donor of a held reversal, and what it waits on", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await name_card_gift(db(), charge_of, {
      npo: "Save the Kids",
      donor: "Jane Doe",
      created_at: "2026-07-01T12:00:00.000Z",
    });
    const held = refund(4_000, "pending");

    await deliver(held);

    const [notice] = enqueue_mock.mock.calls
      .flat()
      .filter((m) => m.id === "fiat-notice");
    const npo = charge_of.npo_ids[0];
    expect(notice.payload.alert).toMatchObject({
      title:
        "Reversal held until the refund succeeds · $40.00 to Save the Kids",
      summary:
        "Reversal held until the refund succeeds: $40.00 to Save the Kids",
      fields: [
        { name: "Nonprofit", value: `Save the Kids (#${npo})` },
        { name: "Donor", value: "Jane Doe" },
        { name: "Refunded", value: "$40.00" },
        { name: "Status", value: "Pending" },
        { name: "Donated", value: "Jul 1, 2026" },
      ],
      note: expect.stringMatching(
        /^Waiting on: 40\.00 USD \(re_1, pending\)\./
      ),
      action: { text: expect.stringContaining("refund.updated") },
      context: [
        `donation ${charge_of.id} · charge ${charge_now().id} · event ${held.id} · refund re_1`,
      ],
    });
    expect(notice.payload.alert.table).toBeUndefined();
  });

  it("takes nothing back, and tells ops nothing more, when the pending refund fails", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000, "pending"));
    const held = notice_text();

    const res = await deliver(settle("re_1", "failed"));

    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toEqual([]);
    expect(notice_text()).toBe(held);
  });

  it("records the share of the refund that succeeded once the other pending one fails", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000, "pending"));
    await deliver(refund(2_000, "pending"));
    await deliver(settle("re_1", "succeeded"));
    const while_one_pending = await owed_of(charge_of.id);

    await deliver(settle("re_2", "failed"));

    expect(while_one_pending).toEqual([]);
    expect(await owed_of(charge_of.id)).toMatchObject([
      { source_ref: "re_1", outstanding_usd: 37.28 },
    ]);
  });
});

describe("a refund.updated that changes no status", () => {
  it("ignores a refund.updated that settles nothing, such as the trace number arriving", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));
    const after_refund = notice_text();
    const traced = settle("re_1", "succeeded");
    traced.data.previous_attributes = {} as any;

    const res = await deliver(traced);

    expect(res.status).toBe(200);
    expect(after_refund).toMatch(/^Partial refund recorded as owed · /m);
    expect(notice_text()).toBe(after_refund);
  });
});

describe("what the share counts", () => {
  it("counts a pending refund, so a pending full refund ends the recurring gift while it holds", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);

    await deliver(refund(10_000, "pending"));

    expect(await owed_of(charge_of.id)).toEqual([]);
    expect(invoice_payments_list_mock).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: { payment_intent: charge_of.sttl_id, type: "payment_intent" },
      })
    );
  });

  it("ends no recurring gift while a pending refund is only part of the charge", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);

    await deliver(refund(4_000, "pending"));

    expect(invoice_payments_list_mock).not.toHaveBeenCalled();
  });

  it("counts nothing of a refund that failed", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(2_000, "pending"));
    await deliver(settle("re_1", "failed"));

    await deliver(refund(4_000));

    expect(await owed_of(charge_of.id)).toMatchObject([
      { source_ref: "re_2", outstanding_usd: 37.28 },
    ]);
  });
});

describe("a refund that fails after it succeeded", () => {
  it("credits back the row the reversal recorded, leaving nothing outstanding, and tells finance", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(10_000));

    const res = await deliver(fail("re_1"));

    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toMatchObject([
      { received_usd: 90, fee_processing_usd: 3.2, outstanding_usd: 0 },
    ]);
    const alert = failed_alert();
    expect(alert).toMatch(
      /\$93\.20 credited back to NPO .*; outstanding now \$0/
    );
    expect(alert).not.toMatch(/nothing was changed|reversal stands/);
  });

  it("leaves the nonprofit due back what a grant run had already recovered", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(10_000));
    await recover_owed(db() as unknown as DbOrTx, {
      donation_id: charge_of.id,
      party: { npo_id: charge_of.npo_ids[0]! },
      usd: 93.2,
      reason: "grant_run",
      ref: "run-1",
      now: new Date().toISOString(),
    });

    await deliver(fail("re_1"));

    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: -93.2 },
    ]);
  });

  it("credits back the referrer's row from the same refund", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await seed_paid_commission(db(), charge_of, "REF-1", 5);
    await deliver(refund(10_000));
    const referrer_row = async () =>
      (await owed_for_donation(charge_of.id)).find(
        (o) => o.referrer_user === "REF-1"
      );
    const before = await referrer_row();

    await deliver(fail("re_1"));

    expect(before).toMatchObject({ outstanding_usd: 5 });
    expect(await referrer_row()).toMatchObject({ outstanding_usd: 0 });
    expect(failed_alert()).toMatch(/\$5\.00? credited back to referrer REF-1/);
  });

  it("credits nothing twice when stripe redelivers it", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(10_000));
    const failed = fail("re_1");

    await deliver(failed);
    await deliver(failed);

    expect(await owed_of(charge_of.id)).toMatchObject([{ outstanding_usd: 0 }]);
  });
});

describe("a partial refund that fails after it succeeded", () => {
  it("credits back only its share of a gift the refunds reversed", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));
    await deliver(refund(6_000));

    await deliver(fail("re_2"));

    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: 37.28 },
    ]);
    expect((await gift_of(charge_of.id))?.status).toBe("refunded_loss");
  });

  it("credits back the share it recorded on a gift still settled, and a later refund records its own", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));

    await deliver(fail("re_1"));
    const after_failure = await owed_of(charge_of.id);
    await deliver(refund(6_000));

    expect(after_failure).toMatchObject([{ outstanding_usd: 0 }]);
    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: 55.92 },
    ]);
    expect(await gift_of(charge_of.id)).toEqual({
      status: "settled",
      taken: 0.6,
    });
  });

  it("credits back each of two failed partials its own share", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));
    await deliver(refund(2_000));

    await deliver(fail("re_1"));
    const after_first = await owed_of(charge_of.id);
    await deliver(fail("re_2"));

    expect(after_first).toMatchObject([{ outstanding_usd: 18.64 }]);
    expect(await owed_of(charge_of.id)).toMatchObject([{ outstanding_usd: 0 }]);
    expect(await gift_of(charge_of.id)).toEqual({
      status: "settled",
      taken: 0,
    });
  });

  it("tells finance the earlier credit when stripe redelivers after a delivery that credited it", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));
    const failed = fail("re_1");
    await deliver(failed);
    enqueue_mock.mockClear();

    const res = await deliver(failed);

    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toMatchObject([{ outstanding_usd: 0 }]);
    const alert = failed_alert();
    expect(alert).toMatch(/already credited back[\s\S]*\$37\.28 credited back/);
    expect(alert).not.toMatch(/nothing was changed/);
  });
});

describe("a refund that fails while held", () => {
  it("credits nothing back of an earlier refund's share, and tells finance nothing changed", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));
    await deliver(refund(2_000, "pending"));

    const res = await deliver(fail("re_2"));

    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toMatchObject([
      { source_ref: "re_1", outstanding_usd: 37.28 },
    ]);
    expect(failed_alert()).toMatch(
      /taken nothing back from the donation \(status settled\): nothing was changed/
    );
  });

  it("leaves a gift its held full refund never reversed as it was", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(10_000, "pending"));

    await deliver(fail("re_1"));

    expect(await owed_of(charge_of.id)).toEqual([]);
    expect((await gift_of(charge_of.id))?.status).toBe("settled");
    expect(failed_alert()).toMatch(/nothing was changed/);
  });
});

describe("a refund that fails after reversing a gift whose payout was pending", () => {
  it("credits nothing, and tells finance to re-settle it by hand", async () => {
    charge_of = await seed_card_gift(db(), {
      ...PAID_GRANT,
      payout: "pending",
    });
    await deliver(refund(10_000));
    const after_reversal = await owed_of(charge_of.id);

    await deliver(fail("re_1"));

    expect(await owed_of(charge_of.id)).toEqual(after_reversal);
    expect(failed_alert()).toMatch(/undo by hand:\n.*re-settle/);
  });
});

describe("the finance alert of a failed refund", () => {
  it("names the refund, its amount and stripe's reason, keyed on the refund", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(10_000));

    await deliver(fail("re_1"));

    const [alert] = enqueue_mock.mock.calls
      .flat()
      .filter((m) => m.payload?.alert?.title === "Stripe Refund Failed");
    expect(alert.dedupe).toBe("fiat.notice_re_1");
    expect(alert.payload.alert.body).toMatch(
      /refund re_1[\s\S]*amount: 100\.00 USD[\s\S]*failure reason: expired_or_canceled_card/
    );
  });

  it("fails the delivery when the alert of a refund that changed nothing can't be queued", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(10_000, "pending"));
    const failed = fail("re_1");
    enqueue_mock.mockRejectedValue(new Error("qstash 503"));

    const res = await deliver(failed);

    expect(res.status).not.toBe(200);
  });

  // a redelivery would read the credit as already made and tell it wrong
  it("reports the alert of a credit it can't queue rather than have stripe redeliver it", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(10_000));
    const failed = fail("re_1");
    enqueue_mock.mockRejectedValue(new Error("qstash 503"));

    const res = await deliver(failed);

    expect(res.status).toBe(200);
    expect(report_error_mock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "qstash 503" }),
      expect.objectContaining({
        body: expect.stringMatching(/\$93\.20 credited back/),
      })
    );
  });
});

describe("a dispute won on a charge with refunds", () => {
  it("leaves the refund's share owed after a dispute over the rest is won", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));
    await deliver(
      dispute_event("charge.dispute.created", 6_000, "needs_response")
    );

    await deliver(dispute_event("charge.dispute.closed", 6_000, "won"));

    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: 37.28 },
    ]);
    expect((await gift_of(charge_of.id))?.status).toBe("settled");
  });

  it("owes a later refund its own share, the won dispute's money being back", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(
      dispute_event("charge.dispute.created", 3_000, "needs_response")
    );
    await deliver(dispute_event("charge.dispute.closed", 3_000, "won"));

    await deliver(refund(4_000));

    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: 37.28 },
    ]);
  });
});

describe("a dispute lost on a charge with refunds", () => {
  it("takes the whole charge once the refunds and the dispute together cover it", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(6_000));
    await deliver(
      dispute_event("charge.dispute.created", 4_000, "needs_response")
    );
    const before = await gift_of(charge_of.id);

    const res = await deliver(
      dispute_event("charge.dispute.closed", 4_000, "lost")
    );

    expect(res.status).toBe(200);
    expect(before.status).toBe("settled");
    expect(await gift_of(charge_of.id)).toEqual({
      status: "refunded_loss",
      taken: 1,
    });
    expect(await owed_of(charge_of.id)).toMatchObject([
      { received_usd: 90, fee_processing_usd: 3.2 },
    ]);
  });

  it("leaves the gift settled while the refunds and the dispute leave part of it", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(4_000));
    await deliver(
      dispute_event("charge.dispute.created", 3_000, "needs_response")
    );

    await deliver(dispute_event("charge.dispute.closed", 3_000, "lost"));

    expect(await gift_of(charge_of.id)).toEqual({
      status: "settled",
      taken: 0.7,
    });
  });
});

describe("a bank refund completing the charge", () => {
  it("holds the reversal while pending, and reverses once refund.updated says it succeeded", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(10_000, "pending"));
    const while_pending = await gift_of(charge_of.id);

    await deliver(settle("re_1", "succeeded"));

    expect(while_pending).toEqual({ status: "settled", taken: 0 });
    expect(notice_text()).toMatch(
      /^Reversal held until the refund succeeds · [\s\S]*Waiting on: 100\.00 USD \(re_1, pending\)/m
    );
    expect((await gift_of(charge_of.id)).status).toBe("refunded_loss");
    expect(await owed_of(charge_of.id)).toMatchObject([
      { source_ref: "re_1", outstanding_usd: 93.2 },
    ]);
  });

  it.each(["failed", "canceled"])(
    "takes nothing back when the pending refund is %s",
    async (status) => {
      charge_of = await seed_card_gift(db(), PAID_GRANT);
      await deliver(refund(10_000, "pending"));

      await deliver(settle("re_1", status));

      expect(await owed_of(charge_of.id)).toEqual([]);
      expect(await gift_of(charge_of.id)).toEqual({
        status: "settled",
        taken: 0,
      });
    }
  );

  it("reverses once when refund.updated lands before the charge.refunded it belongs to", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    const created = refund(10_000, "pending");
    await deliver(settle("re_1", "succeeded"));

    await deliver(created);
    await deliver(created); // stripe redelivers

    expect((await gift_of(charge_of.id)).status).toBe("refunded_loss");
    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: 93.2 },
    ]);
  });

  it("holds on an earlier pending refund though the completing one succeeded, naming what it waits on", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(9_500, "pending"));
    const completing = refund(500);

    await deliver(completing);
    await deliver(completing); // stripe redelivers

    expect(notice_text()).toMatch(/Waiting on: 95\.00 USD \(re_1, pending\)/);
    expect(await gift_of(charge_of.id)).toEqual({
      status: "settled",
      taken: 0,
    });
    const held = enqueue_mock.mock.calls
      .flat()
      .filter((m) => m.payload?.id === "re_2_held");
    expect(new Set(held.map((m) => m.dedupe))).toEqual(
      new Set(["fiat.notice_re_2_held"])
    );
  });

  it("reverses once when the earlier pending refund succeeds after the completing one", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(9_500, "pending"));
    await deliver(refund(500));
    const updated = settle("re_1", "succeeded");

    await deliver(updated);
    await deliver(updated); // stripe redelivers

    expect((await gift_of(charge_of.id)).status).toBe("refunded_loss");
    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: 93.2 },
    ]);
  });

  it("waits for the completing refund when an earlier pending partial succeeds first", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(500, "pending"));
    await deliver(refund(9_500, "pending"));

    await deliver(settle("re_1", "succeeded"));
    const after_first = await gift_of(charge_of.id);
    await deliver(settle("re_2", "succeeded"));

    expect(after_first.status).toBe("settled");
    expect((await gift_of(charge_of.id)).status).toBe("refunded_loss");
  });
});

describe("a refund event that is stale by the time it is handled", () => {
  it("judges the charge as stripe has it now, not the event's copy", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    const stale = refund(500);
    refund(9_500);

    await deliver(stale);

    expect((await gift_of(charge_of.id)).status).toBe("refunded_loss");
    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: 93.2 },
    ]);
  });

  it("changes nothing for a partial event that arrives after the gift was reversed", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    const late = refund(500);
    await deliver(refund(9_500));
    const reversed = await owed_of(charge_of.id);
    enqueue_mock.mockClear();

    const res = await deliver(late);

    expect(res.status).toBe(200);
    expect(await owed_of(charge_of.id)).toEqual(reversed);
    expect(enqueue_mock).not.toHaveBeenCalled();
  });

  it("reverses once when two deliveries of the completing refund run at the same time", async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
    await deliver(refund(500));
    const completing = refund(9_500);

    await Promise.all([deliver(completing), deliver(completing)]);

    expect((await gift_of(charge_of.id)).status).toBe("refunded_loss");
    expect(await owed_of(charge_of.id)).toMatchObject([
      { outstanding_usd: 93.2 },
    ]);
  });
});

describe("the notice a partial refund posts", () => {
  beforeEach(async () => {
    charge_of = await seed_card_gift(db(), PAID_GRANT);
  });

  const new_line = () =>
    notice_text()
      .split("\n")
      .filter((l) => l.startsWith("New in this event:"))
      .at(-1);

  it("names the refunds on the charge and the total refunded so far", async () => {
    await deliver(refund(500));

    const text = notice_text();
    expect(text).toContain(charge_of.id);
    expect(text).toContain("5.00 USD (re_1, succeeded)");
    expect(text).toMatch(/Total refunded so far: 5\.00 USD of 100\.00 USD/);
  });

  it("marks only the second refund as new on the second partial's notice", async () => {
    await deliver(refund(500));
    await deliver(refund(1_000));

    expect(new_line()).toBe("New in this event: 10.00 USD (re_2, succeeded).");
    expect(notice_text()).toMatch(
      /Total refunded so far: 15\.00 USD of 100\.00 USD/
    );
  });

  it("names every partial when a failed first notice is redelivered after a second partial", async () => {
    const first = refund(500);
    enqueue_mock.mockRejectedValueOnce(new Error("qstash 503"));
    const failed = await deliver(first);
    await deliver(refund(1_000));

    await deliver(first); // stripe redelivers

    expect(failed.status).not.toBe(200);
    expect(new_line()).toBe("New in this event: 5.00 USD (re_1, succeeded).");
    expect(notice_text()).toContain("10.00 USD (re_2, succeeded)");
    expect(notice_text()).toMatch(
      /Total refunded so far: 15\.00 USD of 100\.00 USD/
    );
  });

  it("keys a redelivery on its event, so it collapses into the notice already posted", async () => {
    await deliver(refund(500));
    const second = refund(1_000);
    await deliver(second);
    await deliver(second); // stripe redelivers

    const posted = enqueue_mock.mock.calls
      .flat()
      .filter((m) => m.id === "fiat-notice" && m.payload.id === second.id);
    expect(posted).toHaveLength(2);
    expect(new Set(posted.map((m) => m.dedupe)).size).toBe(1);
    expect(new_line()).toBe("New in this event: 10.00 USD (re_2, succeeded).");
  });

  it("names the latest refund by the event's time when the event carries no previous attributes", async () => {
    await deliver(refund(500));
    const second = refund(1_000);
    delete (second.data as any).previous_attributes;
    refund(2_000); // made after the event, so not in it

    await deliver(second);

    expect(new_line()).toBe("New in this event: 10.00 USD (re_2, succeeded).");
  });

  it("says it could not tell when two refunds share the latest second and the event carries no previous attributes", async () => {
    await deliver(refund(500));
    const second = refund(1_000);
    delete (second.data as any).previous_attributes;
    refunds[1]!.created = refunds[0]!.created; // both made in the same second

    await deliver(second);

    expect(new_line()).toBe(
      "New in this event: could not tell which refund is new."
    );
  });

  it("says it could not tell rather than guess when an earlier refund has since failed", async () => {
    await deliver(refund(500));
    refunds[0]!.status = "failed"; // the bank refund bounced back

    await deliver(refund(500));

    expect(new_line()).toBe(
      "New in this event: could not tell which refund is new."
    );
  });
});
