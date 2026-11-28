import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { render } from "react-email";
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
import { to_utc_day } from "@/helpers/date";
import type { Alert } from "@/slack";
import type { DbOrTx } from "$/pg/queries/helpers";
import type { TestDb } from "$/pg/test-utils/pglite";

// mocked stripe events through the real webhook handlers and the owed-notice
// mailer. stripe's api, smtp and the queue are the boundary; the ledger is pglite
const construct_event_mock = vi.hoisted(() => vi.fn());
const charge_retrieve_mock = vi.hoisted(() => vi.fn());
const refunds_list_mock = vi.hoisted(() => vi.fn());
const invoice_payments_list_mock = vi.hoisted(() => vi.fn());
const transfer_create_mock = vi.hoisted(() => vi.fn());
const transfer_reversal_mock = vi.hoisted(() => vi.fn());
const enqueue_mock = vi.hoisted(() => vi.fn());
const send_email_or_throw = vi.hoisted(() =>
  vi.fn(async (_mail: { subject: string; node: ReactElement }) => ({}))
);
const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("$/kit/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: construct_event_mock },
    charges: { retrieve: charge_retrieve_mock },
    refunds: { list: refunds_list_mock },
    invoicePayments: { list: invoice_payments_list_mock },
    transfers: {
      create: transfer_create_mock,
      createReversal: transfer_reversal_mock,
    },
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
vi.mock("$/email", () => ({ send_email_or_throw }));

const { action } = await import("./route");
const { handle_owed_notice } = await import(
  "../api.q-handler.$event/handle-owed-notice"
);
const { owed_for_donation } = await import("$/pg/queries/owed");
const { owed_notices_due } = await import("$/pg/queries/owed-notice");
const { donations } = await import("$/pg/schema/donation");
const { owed_amounts, owed_entries } = await import("$/pg/schema/owed");
const { user_npo_memberships } = await import("$/pg/schema/user");
const { PAID_GRANT, clear_card_gifts, seed_card_gift } = await import(
  "#/__tests__/fixtures/card-gift"
);
const { seed_user } = await import("#/__tests__/fixtures/funds");

/** after the terms' recovery right (2026-10-23), so the row reaches its npo */
const GIFT_AT = "2026-10-23T16:00:00.000Z";
const GIFT_DAY = to_utc_day(GIFT_AT);
const OPENED_UNIX = 1_790_000_000;
const CLOSED_UNIX = OPENED_UNIX + 40 * 86_400;

const db = () => test_db.current!.db;
const as_db = (x: unknown) => x as DbOrTx;

type Gift = Awaited<ReturnType<typeof seed_card_gift>>;

let refunds: { id: string; amount: number; status: string; created: number }[] =
  [];
let charge_of: Gift;
let clock = OPENED_UNIX;
let event_n = 0;

const charge_now = () => ({
  id: `ch_${charge_of.id}`,
  payment_intent: charge_of.sttl_id,
  currency: "usd",
  amount: 10_000,
  amount_captured: 10_000,
});

const live_refunded = () =>
  refunds
    .filter((r) => r.status !== "failed" && r.status !== "canceled")
    .reduce((sum, r) => sum + r.amount, 0);

/** stripe's charge.refunded for a support refund of `amount` cents */
const refund_event = (amount: number) => {
  const before = live_refunded();
  clock += 60;
  refunds.unshift({
    id: `re_${refunds.length + 1}`,
    amount,
    status: "succeeded",
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

const dispute_of = (
  gift: Gift,
  opts: { status?: string; amount?: number; fee?: number } = {}
) => ({
  id: `du_${gift.id}`,
  object: "dispute",
  amount: opts.amount ?? 10_000,
  currency: "usd",
  charge: `ch_${gift.id}`,
  payment_intent: gift.sttl_id,
  reason: "fraudulent",
  status: opts.status ?? "needs_response",
  created: OPENED_UNIX,
  evidence_details: { due_by: OPENED_UNIX + 14 * 86_400 },
  balance_transactions: [
    {
      id: "txn_dsp",
      amount: -(opts.amount ?? 10_000),
      fee: opts.fee ?? 1_500,
      currency: "usd",
    },
  ],
});

const event_of = (type: string, object: object, created = OPENED_UNIX) => ({
  id: `evt_${++event_n}`,
  type,
  created,
  data: { object },
});

const deliver = async (event: object) => {
  construct_event_mock.mockReturnValue(event);
  const request = new Request("https://x/api/stripe-webhook", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "t=1,v1=ok" },
  });
  return (await action({ request } as any)) as Response;
};

/** the cron's pass: every due notice, mailed by the real handler */
const deliver_due = async () => {
  for (const n of await owed_notices_due(50, as_db(db()))) {
    await handle_owed_notice(as_db(db()), { id: n.id });
  }
};

const mail_text = (node: ReactElement) => render(node, { plainText: true });

const sent = () =>
  Promise.all(
    send_email_or_throw.mock.calls.map(async ([m]) => ({
      subject: m.subject,
      text: await mail_text(m.node),
    }))
  );

const ops_notices = () =>
  enqueue_mock.mock.calls
    .flat()
    .filter((m) => m.id === "fiat-notice")
    .map((m) => m.payload.alert as Alert);

/** a paid-grant gift the terms cover, with an admin who can be mailed */
const prepare = async () => {
  const gift = await seed_card_gift(db(), PAID_GRANT);
  await db()
    .update(donations)
    .set({ created_at: GIFT_AT })
    .where(eq(donations.id, gift.id));
  const admin = await seed_user(db(), `admin-${gift.id}@npo.test`, "Ada");
  await db()
    .insert(user_npo_memberships)
    .values({ user_id: admin!.id, npo_id: gift.npo_ids[0]! });
  charge_of = gift;
  return gift;
};

const owed_row = async (donation_id: string) =>
  (await owed_for_donation(donation_id))[0];

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
  clock = OPENED_UNIX;
  enqueue_mock.mockResolvedValue(undefined);
  send_email_or_throw.mockResolvedValue({});
  invoice_payments_list_mock.mockResolvedValue({ data: [] });
  charge_retrieve_mock.mockImplementation(async () => charge_now());
  refunds_list_mock.mockImplementation(async () => ({ data: [...refunds] }));
  await db().delete(owed_amounts);
  await clear_card_gifts(db());
});

describe("owed-npo-notif from mocked stripe events", () => {
  it("mails a partial refund with the gift date and the refund date, and no dispute fee", async () => {
    const gift = await prepare();

    const res = await deliver(refund_event(4_000));
    await deliver_due();

    expect(res.status).toBe(200);
    const [mail, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect(mail!.subject).toBe(`Amount owed on a refunded gift: ${gift.id}`);
    const day = to_utc_day((await owed_row(gift.id))!.recorded_at);
    expect(mail!.text).toContain(`Gift date: ${GIFT_DAY}`);
    expect(mail!.text).toContain(`Refunded: ${day}`);
    expect(mail!.text).toContain(
      `On ${day}, the 100.00 USD gift made on ${GIFT_DAY} was refunded`
    );
    expect(mail!.text).toMatch(/Total owed: \$37\.28/);
    expect(mail!.text).not.toMatch(/Dispute fee/);
    expect(transfer_create_mock).not.toHaveBeenCalled();
    expect(transfer_reversal_mock).not.toHaveBeenCalled();
  });

  it("mails a full refund with the gift date and the refund date, and no dispute fee", async () => {
    const gift = await prepare();

    const res = await deliver(refund_event(10_000));
    await deliver_due();

    expect(res.status).toBe(200);
    const [mail, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect(mail!.subject).toBe(`Amount owed on a refunded gift: ${gift.id}`);
    const day = to_utc_day((await owed_row(gift.id))!.recorded_at);
    expect(mail!.text).toContain(`Gift date: ${GIFT_DAY}`);
    expect(mail!.text).toContain(`Refunded: ${day}`);
    expect(mail!.text).toMatch(/Total owed: \$93\.20/);
    expect(mail!.text).not.toMatch(/Dispute fee/);
  });

  it("mails a dispute opening with the gift date, the disputed date and the dispute fee", async () => {
    const gift = await prepare();

    const res = await deliver(
      event_of("charge.dispute.created", dispute_of(gift))
    );
    await deliver_due();

    expect(res.status).toBe(200);
    const [mail, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect(mail!.subject).toBe(`Amount owed on a disputed gift: ${gift.id}`);
    const day = to_utc_day((await owed_row(gift.id))!.recorded_at);
    expect(mail!.text).toContain(`Gift date: ${GIFT_DAY}`);
    expect(mail!.text).toContain(`Disputed: ${day}`);
    expect(mail!.text).toContain(
      `On ${day}, the donor's bank opened a dispute`
    );
    expect(mail!.text).toContain("Dispute fee: $15.00");
    expect(mail!.text).toMatch(/Total owed: \$108\.20/);
  });

  it("mails a dispute won, while the gift is still settled, as credited back including the dispute fee", async () => {
    const gift = await prepare();
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    await deliver_due();
    send_email_or_throw.mockClear();

    const res = await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { status: "won" }),
        CLOSED_UNIX
      )
    );
    await deliver_due();

    expect(res.status).toBe(200);
    expect((await owed_row(gift.id))?.outstanding_usd).toBe(0);
    const [mail, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect(mail!.subject).toBe(`Amount owed credited back: ${gift.id}`);
    const row = (await owed_row(gift.id))!;
    expect(mail!.text).toContain(`Gift date: ${GIFT_DAY}`);
    expect(mail!.text).toContain(`Disputed: ${to_utc_day(row.recorded_at)}`);
    expect(mail!.text).toMatch(
      /We credited back \$108\.20 of what was owed on the .* because its dispute was settled\./
    );
    expect(mail!.text).toContain(
      `The most recent credit was on ${to_utc_day(row.credited_back_at!)}.`
    );
    // 90 received + 3.20 card fee + 15 dispute fee; nothing re-transferred
    expect(transfer_create_mock).not.toHaveBeenCalled();
    expect(transfer_reversal_mock).not.toHaveBeenCalled();
  });

  it("does not mail again when a dispute is lost after its opening already told the nonprofit", async () => {
    const gift = await prepare();
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    await deliver_due();
    const [opened] = await sent();
    send_email_or_throw.mockClear();

    const res = await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { status: "lost" }),
        CLOSED_UNIX
      )
    );
    await deliver_due();

    expect(res.status).toBe(200);
    expect(await sent()).toEqual([]);
    expect((await owed_row(gift.id))?.outstanding_usd).toBeCloseTo(108.2, 10);
    expect(opened!.text).toContain("Dispute fee: $15.00");
    expect(ops_notices().map((n) => n.title.split(" · ")[0])).toContain(
      "Dispute lost, donation reversed"
    );
  });

  it("mails a dispute lost that arrives first, with the gift date, the disputed date and the dispute fee", async () => {
    const gift = await prepare();

    const res = await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { status: "lost" }),
        CLOSED_UNIX
      )
    );
    await deliver_due();

    expect(res.status).toBe(200);
    const [mail, ...rest] = await sent();
    expect(rest).toEqual([]);
    expect(mail!.subject).toBe(`Amount owed on a disputed gift: ${gift.id}`);
    const day = to_utc_day((await owed_row(gift.id))!.recorded_at);
    expect(mail!.text).toContain(`Gift date: ${GIFT_DAY}`);
    expect(mail!.text).toContain(`Disputed: ${day}`);
    expect(mail!.text).toContain("Dispute fee: $15.00");
    expect(mail!.text).toMatch(/Total owed: \$108\.20/);
  });

  it("credits a win after the loss reversed the gift once, mails it once, and a replay credits nothing more", async () => {
    const gift = await prepare();
    await deliver(event_of("charge.dispute.created", dispute_of(gift)));
    await deliver(
      event_of(
        "charge.dispute.closed",
        dispute_of(gift, { status: "lost" }),
        CLOSED_UNIX
      )
    );
    await deliver_due();
    send_email_or_throw.mockClear();
    enqueue_mock.mockClear();
    const won = event_of(
      "charge.dispute.closed",
      dispute_of(gift, { status: "won" }),
      CLOSED_UNIX + 60
    );

    const res = await deliver(won);
    await deliver_due();
    const credits = await credit_rows(gift.id);
    const [mail, ...rest] = await sent();
    const [ops, ...more] = ops_notices();

    await deliver(won);
    await deliver_due();

    expect(res.status).toBe(200);
    expect((await owed_row(gift.id))?.outstanding_usd).toBe(0);
    expect(credits.map((c) => [c.reason, c.usd])).toEqual([
      ["dispute_won", 90],
      ["dispute_won_fee", 3.2],
      ["dispute_won_fee_dispute", 15],
    ]);
    expect(await credit_rows(gift.id)).toEqual(credits);
    expect(rest).toEqual([]);
    expect(mail!.subject).toBe(`Amount owed credited back: ${gift.id}`);
    expect(mail!.text).toContain(`Gift date: ${GIFT_DAY}`);
    expect(mail!.text).toMatch(
      /We credited back \$108\.20 of what was owed on the .* because its dispute was settled\./
    );
    expect(await sent()).toEqual([
      { subject: mail!.subject, text: mail!.text },
    ]);
    expect(more).toEqual([]);
    expect(ops!.title).toMatch(/^Stripe dispute won on a reversed donation · /);
    expect(alert_text(ops!)).toMatch(/credited back, its dispute fee included/);
    expect(alert_text(ops!)).not.toMatch(/by hand/);
    expect(transfer_create_mock).not.toHaveBeenCalled();
    expect(transfer_reversal_mock).not.toHaveBeenCalled();
  });
});

/** the win's credit entries, in reason order */
const credit_rows = async (donation_id: string) => {
  const row = await owed_row(donation_id);
  return db()
    .select({ reason: owed_entries.reason, usd: owed_entries.usd })
    .from(owed_entries)
    .where(eq(owed_entries.owed_id, row!.id))
    .orderBy(owed_entries.reason);
};
