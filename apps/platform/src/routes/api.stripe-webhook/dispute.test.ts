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
import type { Alert } from "@/slack";
import type { DbOrTx } from "$/pg/queries/helpers";
import type { TestDb } from "$/pg/test-utils/pglite";

// the webhook route with its real dispute handlers over pglite; stripe's api
// and the queue are the boundary
const construct_event_mock = vi.hoisted(() => vi.fn());
const charge_retrieve_mock = vi.hoisted(() => vi.fn());
const refunds_list_mock = vi.hoisted(() => vi.fn());
const enqueue_mock = vi.hoisted(() => vi.fn());
const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("$/kit/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: construct_event_mock },
    charges: { retrieve: charge_retrieve_mock },
    refunds: { list: refunds_list_mock },
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
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

const { action } = await import("./route");
const { owed_for_donation, recover_owed } = await import("$/pg/queries/owed");
const { donations } = await import("$/pg/schema/donation");
const { donation_disputes } = await import("$/pg/schema/dispute");
const { dists } = await import("$/pg/schema/dist");
const { payouts } = await import("$/pg/schema/payout");
const { owed_amounts } = await import("$/pg/schema/owed");
const { loss_logs } = await import("$/pg/schema/revenue");
const {
  PAID_GRANT,
  balance_of,
  clear_card_gifts,
  disputes_of,
  name_card_gift,
  seed_card_gift,
  seed_paid_commission,
} = await import("#/__tests__/fixtures/card-gift");

const OPENED_UNIX = 1_790_000_000;
const OPENED = new Date(OPENED_UNIX * 1000).toISOString();
const CLOSED_UNIX = OPENED_UNIX + 40 * 86_400;
const CLOSED = new Date(CLOSED_UNIX * 1000).toISOString();

const db = () => test_db.current!.db;

type Gift = Awaited<ReturnType<typeof seed_card_gift>>;

interface IDisputeSeed {
  id?: string;
  status?: string;
  /** cents of the $100 charge */
  amount?: number;
  /** cents, in `fee_currency` */
  fee?: number;
  /** the account's settlement currency */
  fee_currency?: string;
  /** stripe has taken the disputed amount from the balance; never for an
   * inquiry */
  withdrawn?: boolean;
}

/** stripe's dispute over `gift`'s $100 charge, opened at `OPENED` */
const dispute_of = (
  gift: Gift,
  {
    id = `du_${gift.id}`,
    status = "needs_response",
    amount = 10_000,
    fee = 1_500,
    fee_currency = "usd",
    withdrawn = !status.startsWith("warning_"),
  }: IDisputeSeed = {}
) => ({
  id,
  object: "dispute",
  livemode: true,
  amount,
  currency: "usd",
  charge: `ch_${gift.id}`,
  payment_intent: gift.sttl_id,
  reason: "fraudulent",
  status,
  created: OPENED_UNIX,
  evidence_details: { due_by: OPENED_UNIX + 14 * 86_400 },
  balance_transactions: withdrawn
    ? [{ id: "txn_dsp", amount: -amount, fee, currency: fee_currency }]
    : [],
});

let event_n = 0;
const event_of = (type: string, object: object, created = OPENED_UNIX) => ({
  id: `evt_${++event_n}`,
  type,
  created,
  data: { object },
});

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

const status_of = async (donation_id: string) => {
  const [row] = await db()
    .select({ status: donations.status })
    .from(donations)
    .where(eq(donations.id, donation_id));
  return row?.status;
};

/** the ops notices queued so far */
const notices = () =>
  enqueue_mock.mock.calls.flat().filter((m) => m.id === "fiat-notice");

/** what ops read of a queued notice */
const text = (n: { payload: { alert: Alert } }) => alert_text(n.payload.alert);

/** each party's row on the gift as it breaks down, npos by id */
const owed_of = async (donation_id: string) =>
  (await owed_for_donation(donation_id))
    .sort((a, b) => (a.npo_id ?? Infinity) - (b.npo_id ?? Infinity))
    .map((o) => ({
      npo_id: o.npo_id,
      referrer_user: o.referrer_user,
      source_ref: o.source_ref,
      received_usd: o.received_usd,
      fee_processing_usd: o.fee_processing_usd,
      fee_dispute_usd: o.fee_dispute_usd,
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
  enqueue_mock.mockResolvedValue(undefined);
  charge_retrieve_mock.mockImplementation(async (id: string) => ({
    id,
    amount: 10_000,
    amount_captured: 10_000,
    currency: "usd",
  }));
  refunds_list_mock.mockResolvedValue({ data: [] });
  await db().delete(owed_amounts);
  await clear_card_gifts(db());
});

describe("charge.dispute.created", () => {
  it("records the paid-grant npo as owing what it received plus its card and dispute fees, and the gift as disputed", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);

    const res = await deliver(
      event_of("charge.dispute.created", dispute_of(gift))
    );

    expect(res.status).toBe(200);
    expect(await owed_of(gift.id)).toEqual([
      {
        npo_id: gift.npo_ids[0],
        referrer_user: null,
        source_ref: `du_${gift.id}`,
        received_usd: 90,
        fee_processing_usd: 3.2,
        fee_dispute_usd: 15,
        outstanding_usd: 108.2,
      },
    ]);
    expect(await disputes_of(db(), gift.id)).toMatchObject([
      { id: `du_${gift.id}`, status: "open", opened_at: OPENED },
    ]);
  });

  it("owes nothing until stripe has withdrawn the funds, whatever the status says", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);

    await deliver(
      event_of(
        "charge.dispute.created",
        dispute_of(gift, { status: "prevented", withdrawn: false })
      )
    );
    const before = await owed_of(gift.id);
    await deliver(event_of("charge.dispute.funds_withdrawn", dispute_of(gift)));

    expect(before).toEqual([]);
    expect(await owed_of(gift.id)).toMatchObject([{ outstanding_usd: 108.2 }]);
  });

  it("records a fee settled in another currency as none, and names it for ops", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);

    const res = await deliver(
      event_of(
        "charge.dispute.created",
        dispute_of(gift, { fee: 1_400, fee_currency: "eur" })
      )
    );

    expect(res.status).toBe(200);
    expect(await owed_of(gift.id)).toMatchObject([
      { fee_dispute_usd: 0, outstanding_usd: 93.2 },
    ]);
    expect(text(notices()[0])).toMatch(
      /Dispute fee settled in EUR \(14\.00 EUR\)/
    );
  });

  it("tells ops once when the gift has nothing settled to owe yet", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    // settled, its dist still queued
    await db().delete(payouts);
    await db().delete(dists).where(eq(dists.donation_id, gift.id));
    const opened = event_of("charge.dispute.created", dispute_of(gift));

    await deliver(opened);
    await deliver(opened);

    expect(await owed_of(gift.id)).toEqual([]);
    const [only, ...again] = notices();
    expect(again).toEqual([]);
    expect(only.payload.alert.note).toMatch(
      /Nothing settled to the gift's parties yet, so nothing is recorded as owed/
    );
    expect(only.payload.alert.table).toBeUndefined();
  });

  it("tells ops once per dispute what it recorded as owed", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    const opened = event_of("charge.dispute.created", dispute_of(gift));

    await deliver(opened);
    await deliver(opened);
    await deliver(event_of("charge.dispute.funds_withdrawn", dispute_of(gift)));

    // queued once, not three times collapsed by the queue's dedupe window
    const [only, ...again] = notices();
    expect(again).toEqual([]);
    expect(only.payload.alert.title).toMatch(/^Stripe dispute opened · /);
    expect(only.payload.alert.context).toEqual([
      `donation ${gift.id} · dispute du_${gift.id} · charge ch_${gift.id} · event ${opened.id}`,
    ]);
    expect(only.payload.alert.table.rows.at(-1)).toEqual([
      "Total",
      "—",
      "—",
      "—",
      "108.20",
    ]);
  });

  it("names the nonprofit and donor, what each party owes, and when to respond by", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await name_card_gift(db(), gift, {
      npo: "Save the Kids",
      donor: "Jane Doe",
      created_at: "2026-07-01T12:00:00.000Z",
    });
    const opened = event_of("charge.dispute.created", dispute_of(gift));

    await deliver(opened);

    const [only] = notices();
    const npo = gift.npo_ids[0];
    expect(only.payload.alert).toEqual({
      type: "NOTICE",
      from: expect.stringMatching(/^charge-dispute-/),
      title: "Stripe dispute opened · $100.00 to Save the Kids",
      summary: "Stripe dispute opened: $100.00 to Save the Kids",
      fields: [
        {
          name: "Nonprofit",
          value: `Save the Kids (#${npo})`,
          inline: true,
          url: expect.stringMatching(new RegExp(`/admin/${npo}$`)),
        },
        { name: "Donor", value: "Jane Doe", inline: true },
        { name: "Disputed", value: "$100.00", inline: true },
        { name: "Reason", value: "Fraudulent", inline: true },
        { name: "Donated", value: "Jul 1, 2026", inline: true },
        { name: "Respond by", value: "Oct 5, 2026", inline: true },
      ],
      table: {
        columns: [
          { name: "Party" },
          { name: "Received", align: "right" },
          { name: "Card fee", align: "right" },
          { name: "Dispute fee", align: "right" },
          { name: "Owed", align: "right" },
        ],
        rows: [
          [`Save the Kids (#${npo})`, "90.00", "3.20", "15.00", "108.20"],
          ["Total", "—", "—", "—", "108.20"],
        ],
      },
      note: "Donation stays settled until a loss reverses it; what's owed comes out of next grants and is credited back if we win.",
      action: {
        text: "Respond in the Stripe dashboard by Oct 5, 2026.",
        url: `https://dashboard.stripe.com/disputes/du_${gift.id}`,
      },
      context: [
        `donation ${gift.id} · dispute du_${gift.id} · charge ch_${gift.id} · event ${opened.id}`,
      ],
    });
  });
});

const lost_of = (gift: Gift) =>
  event_of(
    "charge.dispute.closed",
    dispute_of(gift, { status: "lost" }),
    CLOSED_UNIX
  );

describe("charge.dispute.closed, lost after it opened", () => {
  it("reverses the gift, keeps the row at what the open recorded and books no loss", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));

    const res = await deliver(lost_of(gift));

    expect(res.status).toBe(200);
    expect(await status_of(gift.id)).toBe("refunded_loss");
    expect(await owed_of(gift.id)).toMatchObject([
      {
        source_ref: `du_${gift.id}`,
        received_usd: 90,
        fee_dispute_usd: 15,
        outstanding_usd: 108.2,
      },
    ]);
    expect(await db().select().from(loss_logs)).toEqual([]);
    expect(await disputes_of(db(), gift.id)).toMatchObject([
      { status: "lost", closed_at: CLOSED },
    ]);
  });

  it("takes what the npo received plus fees once when its payout was still pending at open", async () => {
    const gift = await seed_card_gift(db(), {
      ...PAID_GRANT,
      payout: "pending",
    });
    const npo_id = gift.npo_ids[0]!;
    const before = await balance_of(db(), npo_id);

    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    const at_open = await owed_of(gift.id);
    await deliver(lost_of(gift));

    expect(at_open).toMatchObject([{ outstanding_usd: 108.2 }]);
    const [row] = await owed_of(gift.id);
    const taken =
      before - (await balance_of(db(), npo_id)) + (row?.outstanding_usd ?? NaN);
    expect(taken).toBeCloseTo(108.2, 10);
  });
});

const won_of = (gift: Gift) =>
  event_of(
    "charge.dispute.closed",
    dispute_of(gift, { status: "won" }),
    CLOSED_UNIX
  );

describe("charge.dispute.closed, won", () => {
  it("credits back what the open recorded, leaving nothing outstanding and the gift settled", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));

    const res = await deliver(won_of(gift));

    expect(res.status).toBe(200);
    expect(await owed_of(gift.id)).toMatchObject([
      { received_usd: 90, fee_dispute_usd: 15, outstanding_usd: 0 },
    ]);
    expect(await status_of(gift.id)).toBe("settled");
    expect(await disputes_of(db(), gift.id)).toMatchObject([
      { status: "won", closed_at: CLOSED },
    ]);
  });

  it("leaves the npo due back what a grant run had already recovered", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    await recover_owed(db() as unknown as DbOrTx, {
      donation_id: gift.id,
      party: { npo_id: gift.npo_ids[0]! },
      usd: 50,
      reason: "grant_run",
      ref: "run-1",
      now: OPENED,
    });

    await deliver(won_of(gift));

    expect(await owed_of(gift.id)).toMatchObject([{ outstanding_usd: -50 }]);
  });

  it("records nothing owed for an open that arrives after the win", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);

    await deliver(won_of(gift));
    const res = await deliver(
      event_of("charge.dispute.created", dispute_of(gift))
    );

    expect(res.status).toBe(200);
    expect(await owed_of(gift.id)).toEqual([]);
    expect(await disputes_of(db(), gift.id)).toMatchObject([{ status: "won" }]);
  });
});

describe("a paid commission on the disputed gift", () => {
  it("is owed by its referrer from the open, and credited back on a win", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await seed_paid_commission(db(), gift, "REF-1", 5);
    const referrer_row = async () =>
      (await owed_of(gift.id)).find((o) => o.referrer_user === "REF-1");

    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    const at_open = await referrer_row();
    await deliver(won_of(gift));

    expect(at_open).toMatchObject({
      source_ref: `du_${gift.id}`,
      received_usd: 5,
      fee_dispute_usd: 0,
      outstanding_usd: 5,
    });
    expect(await referrer_row()).toMatchObject({ outstanding_usd: 0 });
  });
});

describe("a fund gift across two nonprofits", () => {
  it("splits the dispute fee by each dist's share, the shares summing to the fee", async () => {
    // settled $50 and $25: a 2:1 split of $15.01 is $10.006… and $5.003…
    const gift = await seed_card_gift(
      db(),
      { net: 45, fee_processing: 1.6, fee_base: 3.4, payout: "settled" },
      { net: 22.5, fee_processing: 0.8, fee_base: 1.7, payout: "settled" }
    );
    charge_retrieve_mock.mockResolvedValue({
      id: `ch_${gift.id}`,
      amount: 7_500,
      amount_captured: 7_500,
      currency: "usd",
    });

    await deliver(
      event_of(
        "charge.dispute.created",
        dispute_of(gift, { amount: 7_500, fee: 1_501 })
      )
    );

    const rows = await owed_of(gift.id);
    expect(rows.map((o) => [o.npo_id, o.fee_dispute_usd])).toEqual([
      [gift.npo_ids[0], 10.01],
      [gift.npo_ids[1], 5],
    ]);
  });
});

describe("a second dispute on the same payment", () => {
  it("is recorded owing only its own fee more, and ops told its rows stand under the first and a win credits its share back", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    const first = await owed_of(gift.id);
    const second = dispute_of(gift, { id: `du_${gift.id}_2` });

    await deliver(event_of("charge.dispute.created", second));
    await deliver(event_of("charge.dispute.created", second));

    // the share is the whole already; each dispute's fee is its own
    expect(await owed_of(gift.id)).toEqual(
      first.map((o) => ({
        ...o,
        fee_dispute_usd: o.fee_dispute_usd + 15,
        outstanding_usd: (o.outstanding_usd ?? 0) + 15,
      }))
    );
    expect((await disputes_of(db(), gift.id)).map((d) => d.id).sort()).toEqual([
      `du_${gift.id}`,
      `du_${gift.id}_2`,
    ]);
    // its fee grew the row, so it is told as owed too
    const [, flagged, ...rest] = notices();
    expect(rest.map((n) => n.payload.id)).toEqual([`du_${gift.id}_2_owed`]);
    expect(text(flagged)).toMatch(
      new RegExp(
        `second dispute.*stands under du_${gift.id}\\b.*credited back if we win`
      )
    );
  });
});

describe("a redelivered event", () => {
  it.each([
    ["won", won_of, 0],
    ["lost", lost_of, 108.2],
  ] as const)(
    "changes nothing further across an open and a %s close",
    async (_, close_of, outstanding) => {
      const gift = await seed_card_gift(db(), PAID_GRANT);
      const opened = event_of("charge.dispute.created", dispute_of(gift));
      const closed = close_of(gift);

      await deliver(opened);
      await deliver(opened);
      const at_open = await owed_of(gift.id);
      await deliver(closed);
      const at_close = await owed_of(gift.id);
      const res = await deliver(closed);
      await deliver(opened);

      expect(res.status).toBe(200);
      expect(at_open).toMatchObject([{ outstanding_usd: 108.2 }]);
      expect(at_close).toMatchObject([{ outstanding_usd: outstanding }]);
      expect(await owed_of(gift.id)).toEqual(at_close);
      expect(await disputes_of(db(), gift.id)).toHaveLength(1);
    }
  );
});

/** the gift refunded in full before the dispute */
const refund = (gift: Gift) =>
  db()
    .update(donations)
    .set({ status: "refunded" })
    .where(eq(donations.id, gift.id));

describe("a dispute on a gift already refunded", () => {
  it("is put on record with nothing owed, and ops told once that the refund is their evidence", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await refund(gift);
    const opened = event_of("charge.dispute.created", dispute_of(gift));

    await deliver(opened);
    await deliver(opened);

    expect(await owed_of(gift.id)).toEqual([]);
    expect(await disputes_of(db(), gift.id)).toMatchObject([
      { id: `du_${gift.id}`, status: "open" },
    ]);
    const [only, ...again] = notices();
    expect(again).toEqual([]);
    expect(text(only)).toMatch(
      /already refunded.*the refund is the evidence to submit/
    );
  });

  it("tells ops again when an inquiry on it escalates and stripe withdraws the funds", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await refund(gift);
    await deliver(
      event_of(
        "charge.dispute.created",
        dispute_of(gift, { status: "warning_needs_response" })
      )
    );

    await deliver(event_of("charge.dispute.funds_withdrawn", dispute_of(gift)));

    expect(await owed_of(gift.id)).toEqual([]);
    const [asked, escalated, ...rest] = notices();
    expect(rest).toEqual([]);
    expect(text(asked)).toMatch(/An inquiry/);
    expect(escalated.dedupe).not.toBe(asked.dedupe);
    expect(text(escalated)).toMatch(
      /already refunded.*the refund is the evidence to submit/
    );
  });

  it("tells ops a win returns only the platform's own funds, nothing owed to the nonprofit", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await refund(gift);

    const res = await deliver(won_of(gift));

    expect(res.status).toBe(200);
    expect(await disputes_of(db(), gift.id)).toMatchObject([{ status: "won" }]);
    const [notice] = notices();
    expect(notice.payload.alert.title).toMatch(
      /^Stripe dispute won on a reversed donation · /
    );
    const body = text(notice);
    expect(body).toContain(gift.id);
    expect(body).toMatch(/reversed by its refund.*nothing is owed/);
    expect(body).not.toMatch(/by hand/);
  });
});

describe("a late win after the dispute was lost", () => {
  it("does not credit a loss that only closed the row after a refund", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    await refund(gift);
    const owed = await owed_of(gift.id);
    enqueue_mock.mockClear();

    await deliver(lost_of(gift));
    const res = await deliver(won_of(gift));

    expect(res.status).toBe(200);
    expect(await owed_of(gift.id)).toEqual(owed);
    const [notice] = notices();
    expect(notice.payload.alert.title).toMatch(
      /^Stripe dispute won on a reversed donation · /
    );
    expect(text(notice)).toMatch(/reversed by its refund.*nothing is owed/);
    expect(text(notice)).not.toMatch(/credited back/);
    expect(text(notice)).not.toMatch(/by hand/);
  });

  it("asks ops to restore an older loss that reversed the gift before it was stamped", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    await deliver(lost_of(gift));
    await db()
      .update(donation_disputes)
      .set({ loss_recorded_at: null })
      .where(eq(donation_disputes.id, `du_${gift.id}`));
    const owed = await owed_of(gift.id);
    enqueue_mock.mockClear();

    const res = await deliver(won_of(gift));

    expect(res.status).toBe(200);
    expect(owed).toMatchObject([{ outstanding_usd: 108.2 }]);
    expect(await owed_of(gift.id)).toEqual(owed);
    const [notice] = notices();
    expect(notice.payload.alert.title).toMatch(
      /^Stripe dispute won on a reversed donation · /
    );
    expect(text(notice)).toMatch(
      /after it was lost[\s\S]*Credit the nonprofit by hand/
    );
    expect(text(notice)).not.toMatch(/nothing is owed/);
    expect(text(notice)).not.toMatch(/credited back/);
  });

  it("credits what the loss recorded and tells ops that it did, a redelivery crediting nothing more", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    await deliver(lost_of(gift));
    enqueue_mock.mockClear();
    const won = won_of(gift);

    const res = await deliver(won);
    const credited = await owed_of(gift.id);
    await deliver(won);

    expect(res.status).toBe(200);
    expect(credited).toMatchObject([
      {
        received_usd: 90,
        fee_processing_usd: 3.2,
        fee_dispute_usd: 15,
        outstanding_usd: 0,
      },
    ]);
    expect(await owed_of(gift.id)).toEqual(credited);
    const [notice] = notices();
    expect(notice.payload.alert.title).toMatch(
      /^Stripe dispute won on a reversed donation · /
    );
    expect(text(notice)).toMatch(
      /after it was lost.*credited back, its dispute fee included/
    );
    expect(text(notice)).not.toMatch(/by hand/);
  });

  it("says a non-usd dispute fee is still for ops when the loss is credited back", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    const eur = { fee: 1_500, fee_currency: "eur" };
    await deliver(event_of("charge.dispute.created", dispute_of(gift, eur)));
    await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { ...eur, status: "lost" }),
        CLOSED_UNIX
      )
    );
    enqueue_mock.mockClear();

    await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { ...eur, status: "won" }),
        CLOSED_UNIX + 60
      )
    );

    const [notice] = notices();
    expect(text(notice)).toMatch(/credited back/);
    expect(text(notice)).not.toMatch(/dispute fee included/);
    expect(text(notice)).toMatch(/settled in EUR/);
    expect(text(notice)).toMatch(/by hand/);
  });
});

describe("a dispute over part of the charge", () => {
  const part = { amount: 3_000 };

  it("records the share disputed of what the npo received plus its card fee, and the dispute fee in full, its loss reversing nothing", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);

    await deliver(event_of("charge.dispute.created", dispute_of(gift, part)));
    const res = await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { ...part, status: "lost" }),
        CLOSED_UNIX
      )
    );

    expect(res.status).toBe(200);
    expect(await owed_of(gift.id)).toEqual([
      {
        npo_id: gift.npo_ids[0],
        referrer_user: null,
        source_ref: `du_${gift.id}`,
        received_usd: 27,
        fee_processing_usd: 0.96,
        fee_dispute_usd: 15,
        outstanding_usd: 42.96,
      },
    ]);
    expect(await disputes_of(db(), gift.id)).toMatchObject([
      { id: `du_${gift.id}`, status: "lost" },
    ]);
    expect(await status_of(gift.id)).toBe("settled");
    expect(notices().map((n) => n.payload.alert.title.split(" · ")[0])).toEqual(
      ["Stripe dispute opened", "Lost dispute share recorded as owed"]
    );
  });

  it("won after its loss, credits nothing and tells ops, once per event", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(event_of("charge.dispute.created", dispute_of(gift, part)));
    await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { ...part, status: "lost" }),
        CLOSED_UNIX
      )
    );
    const owed = await owed_of(gift.id);
    enqueue_mock.mockClear();
    const won = event_of(
      "charge.dispute.closed",
      dispute_of(gift, { ...part, status: "won" }),
      CLOSED_UNIX + 60
    );

    await deliver(won);
    await deliver(won);

    expect(await owed_of(gift.id)).toEqual(owed);
    expect(await disputes_of(db(), gift.id)).toMatchObject([
      { status: "lost" },
    ]);
    const changed = notices().filter((n) =>
      n.payload.alert.title.startsWith("Stripe dispute outcome changed")
    );
    expect(new Set(changed.map((n) => n.payload.id))).toEqual(
      new Set([won.id])
    );
    expect(changed[0]!.payload.alert.note).toContain(
      "Won after it was recorded lost. The chargeback stays owed"
    );
  });

  it("records the same share when its loss is the first event handled", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);

    const res = await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { ...part, status: "lost" }),
        CLOSED_UNIX
      )
    );

    expect(res.status).toBe(200);
    expect(await owed_of(gift.id)).toMatchObject([
      {
        received_usd: 27,
        fee_processing_usd: 0.96,
        fee_dispute_usd: 15,
        outstanding_usd: 42.96,
      },
    ]);
    expect(await status_of(gift.id)).toBe("settled");
  });

  it("counts the charge's refunds into the share its loss takes", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    refunds_list_mock.mockResolvedValue({
      data: [{ id: "re_1", amount: 2_000, status: "succeeded" }],
    });

    await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { ...part, status: "lost" }),
        CLOSED_UNIX
      )
    );

    expect(await owed_of(gift.id)).toMatchObject([
      { received_usd: 45, fee_processing_usd: 1.6, outstanding_usd: 61.6 },
    ]);
  });

  // stripe fails a refund pending when its charge is disputed
  it("counts no pending refund into the share its loss takes", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    refunds_list_mock.mockResolvedValue({
      data: [{ id: "re_1", amount: 4_000, status: "pending" }],
    });

    await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { ...part, status: "lost" }),
        CLOSED_UNIX
      )
    );

    expect(await owed_of(gift.id)).toMatchObject([
      { received_usd: 27, outstanding_usd: 42.96 },
    ]);
    expect(await status_of(gift.id)).toBe("settled");
  });
});

describe("an inquiry", () => {
  const inquiry = { status: "warning_needs_response" };

  it("records the dispute with nothing owed, since no funds left", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);

    const res = await deliver(
      event_of("charge.dispute.created", dispute_of(gift, inquiry))
    );

    expect(res.status).toBe(200);
    expect(await disputes_of(db(), gift.id)).toMatchObject([
      { id: `du_${gift.id}`, status: "open" },
    ]);
    expect(await owed_of(gift.id)).toEqual([]);
    const [notice] = notices();
    expect(text(notice)).toMatch(/inquiry.*nothing is recorded as owed/);
  });

  it("records what is owed once it escalates and stripe withdraws the funds", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(
      event_of("charge.dispute.created", dispute_of(gift, inquiry))
    );

    const res = await deliver(
      event_of("charge.dispute.funds_withdrawn", dispute_of(gift))
    );

    expect(res.status).toBe(200);
    expect(await owed_of(gift.id)).toMatchObject([
      { fee_dispute_usd: 15, outstanding_usd: 108.2 },
    ]);
    expect(text(notices().at(-1)!)).toMatch(/^Total \| .* \| 108\.20$/m);
  });

  it("records the share once it escalates over part of the charge, telling ops a loss won't reverse the gift", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(
      event_of(
        "charge.dispute.created",
        dispute_of(gift, { ...inquiry, amount: 4_000 })
      )
    );

    await deliver(
      event_of(
        "charge.dispute.funds_withdrawn",
        dispute_of(gift, { amount: 4_000 })
      )
    );

    expect(await owed_of(gift.id)).toMatchObject([
      { received_usd: 36, fee_processing_usd: 1.28, outstanding_usd: 52.28 },
    ]);
    const [asked, escalated, ...rest] = notices();
    expect(rest).toEqual([]);
    expect(text(asked)).toMatch(/An inquiry/);
    expect(text(escalated)).toMatch(
      /^Total \| .* \| 52\.28\n[\s\S]*stays settled even if this part is lost/m
    );
  });

  it("reads closed when it ends with no chargeback, nothing owed", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    await deliver(
      event_of("charge.dispute.created", dispute_of(gift, inquiry))
    );

    const res = await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { status: "warning_closed" }),
        CLOSED_UNIX
      )
    );

    expect(res.status).toBe(200);
    expect(await disputes_of(db(), gift.id)).toMatchObject([
      { status: "inquiry_closed", closed_at: CLOSED },
    ]);
    expect(await owed_of(gift.id)).toEqual([]);
    expect(await status_of(gift.id)).toBe("settled");
  });

  it("a late inquiry event after the escalation changes nothing", async () => {
    const gift = await seed_card_gift(db(), PAID_GRANT);
    const asked = event_of("charge.dispute.created", dispute_of(gift, inquiry));
    await deliver(asked);
    await deliver(event_of("charge.dispute.funds_withdrawn", dispute_of(gift)));
    const before = notices().length;

    await deliver(asked);

    expect(await owed_of(gift.id)).toMatchObject([{ outstanding_usd: 108.2 }]);
    expect(notices()).toHaveLength(before);
  });
});
