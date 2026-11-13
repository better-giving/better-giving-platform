import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  balance_of,
  clear_card_gifts,
  disputes_of,
  type IDistSeed,
  PAID_GRANT,
  seed_card_gift,
  seed_paid_commission,
} from "#/__tests__/fixtures/card-gift";
import { donation_disputes } from "../pg/schema/dispute";
import { dists } from "../pg/schema/dist";
import { donations } from "../pg/schema/donation";
import { npos } from "../pg/schema/npo";
import { owed_amounts } from "../pg/schema/owed";
import { payouts } from "../pg/schema/payout";
import { referrer_commissions } from "../pg/schema/referrer";
import { loss_logs } from "../pg/schema/revenue";
import type { TestDb } from "../pg/test-utils/pglite";

// --- mocks ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

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

vi.mock("../kit/slack", () => ({ fiat_monitor: { send_alert: vi.fn() } }));
vi.mock("../kit/queue", () => ({ enqueue: vi.fn(async () => undefined) }));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));
// a full refund's subscription lookup: no gift here is recurring
vi.mock("../kit/stripe", () => ({
  stripe: { invoicePayments: { list: vi.fn(async () => ({ data: [] })) } },
}));

// --- imports (after mocks) ---

import { enqueue } from "../kit/queue";
import {
  dispute_close,
  dispute_get,
  dispute_open,
} from "../pg/queries/dispute";
import type { DbOrTx } from "../pg/queries/helpers";
import {
  owed_for_donation,
  record_owed,
  recover_owed,
} from "../pg/queries/owed";
import { create_test_db } from "../pg/test-utils/pglite";
import { dispute_opened, dispute_won } from "./dispute";
import { refund_failed } from "./failed";
import { reverse_charge } from "./reverse";

// --- setup ---

const OPENED = "2026-10-01T12:00:00.000Z";

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  const db = test_db.current!.db;
  await db.delete(owed_amounts);
  await clear_card_gifts(db);
});

const seed = (...ds: IDistSeed[]) => seed_card_gift(test_db.current!.db, ...ds);

/** a dispute over `own` of the gift's $100 opened */
const opened_on = (donation_id: string, fee_usd = 15, own = 100) => ({
  donation_id,
  rail: "stripe" as const,
  dispute_id: `du_${donation_id}`,
  opened_at: OPENED,
  disputed: { taken: own, of: 100 },
  fee_usd,
});

/** `opened_on`, opened now: after any refund already on record, so a dispute
 * of its own rather than the claim that refund paid */
const opened_after = (donation_id: string, fee_usd = 15, own = 100) => ({
  ...opened_on(donation_id, fee_usd, own),
  opened_at: new Date().toISOString(),
});

/** each party's row on the gift as it breaks down, npos by id, then referrers */
const owed_of = async (donation_id: string) =>
  (await owed_for_donation(donation_id))
    .sort((a, b) => (a.npo_id ?? Infinity) - (b.npo_id ?? Infinity))
    .map((o) => ({
      npo_id: o.npo_id,
      referrer_user: o.referrer_user,
      source: o.source,
      source_ref: o.source_ref,
      received_usd: o.received_usd,
      fee_processing_usd: o.fee_processing_usd,
      fee_dispute_usd: o.fee_dispute_usd,
      outstanding_usd: o.outstanding_usd,
    }));

describe("dispute_opened", () => {
  test("records what a paid-grant npo received plus its card and dispute fees as owed", async () => {
    const { id, npo_ids } = await seed(PAID_GRANT);

    await dispute_opened(opened_on(id));

    expect(await owed_of(id)).toEqual([
      {
        npo_id: npo_ids[0],
        referrer_user: null,
        source: "dispute",
        source_ref: `du_${id}`,
        received_usd: 90,
        fee_processing_usd: 3.2,
        fee_dispute_usd: 15,
        outstanding_usd: 108.2,
      },
    ]);
    expect(await disputes_of(test_db.current!.db, id)).toMatchObject([
      { id: `du_${id}`, status: "open", opened_at: OPENED },
    ]);
  });

  test("a dispute over $30 of a $100 charge records that share of what the npo received and its card fee, plus the dispute fee in full", async () => {
    const { id } = await seed(PAID_GRANT);

    await dispute_opened(opened_on(id, 15, 30));

    expect(await owed_of(id)).toMatchObject([
      {
        received_usd: 27,
        fee_processing_usd: 0.96,
        fee_dispute_usd: 15,
        outstanding_usd: 42.96,
      },
    ]);
  });

  test("splits the dispute fee across a fund gift's npos by share, to the cent", async () => {
    // settled $50 and $25: a 2:1 split of $15.01 is $10.006… and $5.003…
    const { id, npo_ids } = await seed(
      { net: 45, fee_processing: 1.6, fee_base: 3.4, payout: "settled" },
      { net: 22.5, fee_processing: 0.8, fee_base: 1.7, payout: "settled" }
    );

    await dispute_opened(opened_on(id, 15.01));

    const rows = await owed_of(id);
    expect(rows.map((o) => [o.npo_id, o.fee_dispute_usd])).toEqual([
      [npo_ids[0], 10.01],
      [npo_ids[1], 5],
    ]);
  });

  test("flags no second dispute over a refund's row on the gift", async () => {
    const { id, npo_ids } = await seed(PAID_GRANT);
    await record_owed(test_db.current!.db as unknown as DbOrTx, {
      donation_id: id,
      party: { npo_id: npo_ids[0]! },
      source: "refund",
      source_ref: "re_1",
      received_usd: 90,
      fee_processing_usd: 3.2,
      now: OPENED,
    });

    const res = await dispute_opened(opened_on(id));

    expect(res).toMatchObject({ status: "recorded", prior_refs: [] });
  });

  test("flags a second dispute on the payment, owing only its own fee more", async () => {
    const { id } = await seed(PAID_GRANT);

    const first = await dispute_opened(opened_on(id));
    const second = await dispute_opened({
      ...opened_on(id),
      dispute_id: "du_2",
    });

    expect([first, second]).toMatchObject([
      { status: "recorded", prior_refs: [], owed_written: true },
      { status: "recorded", prior_refs: [`du_${id}`], owed_written: true },
    ]);
    // the share is the whole already; each dispute's fee is its own
    expect(await owed_of(id)).toMatchObject([
      { source_ref: `du_${id}`, fee_dispute_usd: 30, outstanding_usd: 123.2 },
    ]);
  });

  test("says which call put the dispute on record", async () => {
    const { id } = await seed(PAID_GRANT);

    const first = await dispute_opened(opened_on(id));
    const again = await dispute_opened(opened_on(id));

    expect([first, again]).toMatchObject([
      { status: "recorded", inserted: true, owed_written: true },
      { status: "recorded", inserted: false, owed_written: false },
    ]);
  });

  test("says it wrote what is owed when an inquiry on record escalates", async () => {
    const { id } = await seed(PAID_GRANT);
    // the inquiry, put on record with nothing owed
    await dispute_open(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      opened_at: OPENED,
    });

    const escalated = await dispute_opened(opened_on(id));
    const again = await dispute_opened(opened_on(id));

    expect([escalated, again]).toMatchObject([
      { status: "recorded", inserted: false, owed_written: true },
      { status: "recorded", inserted: false, owed_written: false },
    ]);
    expect(await owed_of(id)).toMatchObject([{ outstanding_usd: 108.2 }]);
  });
});

const CLOSED = "2026-10-20T12:00:00.000Z";

const won_on = (donation_id: string) => ({
  donation_id,
  rail: "stripe" as const,
  dispute_id: `du_${donation_id}`,
  opened_at: OPENED,
  closed_at: CLOSED,
});

describe("an open handled after its dispute closed", () => {
  test.each(["won", "lost", "inquiry_closed"] as const)(
    "owes nothing once closed %s",
    async (status) => {
      const { id } = await seed(PAID_GRANT);
      await dispute_close(test_db.current!.db as unknown as DbOrTx, {
        id: `du_${id}`,
        donation_id: id,
        status,
        opened_at: OPENED,
        closed_at: CLOSED,
      });

      const res = await dispute_opened(opened_on(id));

      expect(res).toEqual({
        status: "closed",
        dispute_status: status,
        inserted: false,
      });
      expect(await owed_of(id)).toEqual([]);
      expect(await disputes_of(test_db.current!.db, id)).toMatchObject([
        { status },
      ]);
    }
  );
});

describe("a dispute on a gift already reversed", () => {
  /** a gift whose money already went back to its donor */
  async function seed_refunded() {
    const gift = await seed(PAID_GRANT);
    await test_db
      .current!.db.update(donations)
      .set({ status: "refunded" })
      .where(eq(donations.id, gift.id));
    return gift;
  }

  test("is recorded open, owing nothing", async () => {
    const { id } = await seed_refunded();

    const res = await dispute_opened(opened_on(id));

    expect(res).toEqual({
      status: "already_reversed",
      donation_status: "refunded",
      inserted: true,
    });
    expect(await owed_of(id)).toEqual([]);
    expect(await disputes_of(test_db.current!.db, id)).toMatchObject([
      { id: `du_${id}`, status: "open" },
    ]);
  });

  test("is recorded won, crediting nothing", async () => {
    const { id } = await seed_refunded();

    const res = await dispute_won(won_on(id));

    expect(res).toEqual({
      status: "already_reversed",
      donation_status: "refunded",
      prior_status: null,
      credited: false,
      hand: false,
    });
    expect(await disputes_of(test_db.current!.db, id)).toMatchObject([
      { id: `du_${id}`, status: "won", closed_at: CLOSED },
    ]);
  });

  test("won after the dispute's own loss reversed the gift, says it was lost", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened(opened_on(id));
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    await lose(id);

    const res = await dispute_won(won_on(id));
    const again = await dispute_won(won_on(id));

    expect(res).toEqual({
      status: "already_reversed",
      donation_status: "refunded_loss",
      prior_status: "lost",
      credited: true,
      hand: false,
    });
    expect(again).toEqual(res);
    expect(await owed_of(id)).toMatchObject([
      {
        received_usd: 90,
        fee_processing_usd: 3.2,
        fee_dispute_usd: 15,
        outstanding_usd: 0,
      },
    ]);
  });

  test("a lost partial, then a refund that reverses the gift, credits nothing when won", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened(opened_on(id, 15, 30));
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    expect((await lose(id, 30)).status).toBe("partial_owed");
    expect((await refund(id, "refund", 70, "re_rest")).status).toBe("reversed");
    const before = await owed_of(id);

    const res = await dispute_won(won_on(id));

    expect(res).toMatchObject({
      prior_status: "lost",
      credited: false,
      hand: false,
    });
    expect(await owed_of(id)).toEqual(before);
  });

  test("a $30 refund, then this dispute's $70 loss reverses the gift: the win credits only the dispute", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, "refund", 30, "re_1");
    await dispute_opened({
      ...opened_on(id, 15, 70),
      disputed: { taken: 70, of: 100 },
    });
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    expect((await lose(id, 70)).status).toBe("reversed");

    const res = await dispute_won(won_on(id));

    expect(res).toMatchObject({ prior_status: "lost", credited: true });
    // the refund's 30% of $90 + $3.20 stays owed; the dispute's share and fee do not
    expect(await owed_of(id)).toMatchObject([{ outstanding_usd: 27.96 }]);
  });

  test("a pending payout's full loss, then a win, leaves nothing outstanding", async () => {
    const { id } = await seed({ ...PAID_GRANT, payout: "pending" });
    await dispute_opened(opened_on(id));
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    expect((await lose(id)).status).toBe("reversed");

    const res = await dispute_won(won_on(id));

    expect(res).toMatchObject({ credited: true });
    expect(await owed_of(id)).toMatchObject([{ outstanding_usd: 0 }]);
  });

  test("a loss does not stamp a dispute already recorded won", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened(opened_on(id));
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      status: "won",
      opened_at: OPENED,
      closed_at: CLOSED,
    });

    expect((await lose(id)).status).toBe("reversed");

    const [row] = await test_db
      .current!.db.select({
        status: donation_disputes.status,
        loss_recorded_at: donation_disputes.loss_recorded_at,
      })
      .from(donation_disputes)
      .where(eq(donation_disputes.id, `du_${id}`));
    expect(row).toEqual({ status: "won", loss_recorded_at: null });
  });

  test("another dispute's stamped reversal is not restored on this one's win", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened(opened_on(id));
    await dispute_opened({ ...opened_on(id), dispute_id: "du_2" });
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: "du_2",
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    expect(
      (
        await reverse_charge({
          donation_id: id,
          rail: "stripe",
          source: "dispute",
          share: { taken: 100, of: 100 },
          dispute_fee_usd: 15,
          source_ref: "du_2",
          alert_from: "charge-dispute",
          notice: { id: `evt_lost_${id}`, lines: [] },
        })
      ).status
    ).toBe("reversed");
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    const owed = await owed_of(id);

    const other = await dispute_won(won_on(id));
    const own = await dispute_won({ ...won_on(id), dispute_id: "du_2" });

    expect(other).toMatchObject({ credited: false, hand: false });
    expect(own).toMatchObject({ prior_status: "lost", credited: true });
    expect(owed).not.toEqual(await owed_of(id));
  });

  test("an older loss with no stamp is not credited, and is left for ops", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened(opened_on(id));
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    await lose(id);
    await test_db
      .current!.db.update(donation_disputes)
      .set({ loss_recorded_at: null })
      .where(eq(donation_disputes.id, `du_${id}`));
    const owed = await owed_of(id);

    const res = await dispute_won(won_on(id));

    expect(res).toMatchObject({
      prior_status: "lost",
      credited: false,
      hand: true,
    });
    expect(owed).toMatchObject([{ outstanding_usd: 108.2 }]);
    expect(await owed_of(id)).toEqual(owed);
  });

  test("a pending commission is not owed by a late win after a refund and a smaller loss", async () => {
    const gift = await seed({ ...PAID_GRANT, payout: "pending" });
    const { id } = gift;
    await seed_paid_commission(test_db.current!.db, gift, "REF-1", 5);
    await test_db
      .current!.db.update(referrer_commissions)
      .set({ status: "pending" })
      .where(eq(referrer_commissions.referrer_user, "REF-1"));
    await refund(id, "refund", 70, "re_1");
    await dispute_opened(opened_on(id, 15, 30));
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: `du_${id}`,
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    expect((await lose(id, 30)).status).toBe("reversed");
    const outstanding = async () =>
      (await owed_of(id)).reduce((sum, o) => sum + (o.outstanding_usd ?? 0), 0);
    const before = await outstanding();

    const res = await dispute_won(won_on(id));
    const after = await outstanding();

    expect(res).toMatchObject({ prior_status: "lost", credited: true });
    expect(after).toBeLessThanOrEqual(before);
    expect(await owed_of(id)).toEqual([
      expect.objectContaining({
        npo_id: gift.npo_ids[0],
        referrer_user: null,
        outstanding_usd: 0,
      }),
    ]);
  });

  test("won on a gift refunded while the dispute was open, says it was open", async () => {
    const { id } = await seed_refunded();
    await dispute_opened(opened_on(id));

    const res = await dispute_won(won_on(id));

    expect(res).toMatchObject({ prior_status: "open" });
  });
});

describe("dispute_won", () => {
  test("credits back what the dispute recorded, leaving nothing outstanding", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened(opened_on(id));

    await dispute_won(won_on(id));

    expect(await owed_of(id)).toMatchObject([
      { received_usd: 90, fee_dispute_usd: 15, outstanding_usd: 0 },
    ]);
    expect(await disputes_of(test_db.current!.db, id)).toMatchObject([
      { status: "won", closed_at: CLOSED },
    ]);
  });

  test("leaves the npo due back what a grant run had already recovered", async () => {
    const { id, npo_ids } = await seed(PAID_GRANT);
    await dispute_opened(opened_on(id));
    await recover_owed(test_db.current!.db as unknown as DbOrTx, {
      donation_id: id,
      party: { npo_id: npo_ids[0]! },
      usd: 50,
      reason: "grant_run",
      ref: "run-1",
      now: OPENED,
    });

    await dispute_won(won_on(id));

    expect(await owed_of(id)).toMatchObject([{ outstanding_usd: -50 }]);
  });

  test("a redelivered open or win changes nothing further", async () => {
    const { id } = await seed(PAID_GRANT);

    await dispute_opened(opened_on(id));
    await dispute_opened(opened_on(id));
    const at_open = await owed_of(id);
    await dispute_won(won_on(id));
    await dispute_won(won_on(id));

    expect(at_open).toMatchObject([{ outstanding_usd: 108.2 }]);
    expect(await owed_for_donation(id)).toMatchObject([
      { outstanding_usd: 0, credited_back_usd: 108.2 },
    ]);
  });
});

describe("dispute_won, whatever wrote the row", () => {
  /** a refund of `taken` of the gift's $100 */
  const refund_share = (donation_id: string, taken: number, ref: string) =>
    reverse_charge({
      donation_id,
      rail: "stripe",
      source: "refund",
      share: { taken, of: 100 },
      source_ref: ref,
      alert_from: "charge-refunded",
      notice: { id: `evt_${ref}`, lines: [] },
    });
  const outstanding = async (id: string) =>
    (await owed_of(id)).map((o) => o.outstanding_usd);

  test("a lost $30 dispute, then a $70 one won: the win leaves the lost one's share and fee owed", async () => {
    const { id } = await seed(PAID_GRANT);
    const d0 = { ...opened_on(id, 15, 30), dispute_id: "PP-D0" };
    await dispute_opened(d0);
    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: { taken: 30, of: 100 },
      dispute_fee_usd: 15,
      source_ref: "PP-D0",
      alert_from: "paypal-dispute",
      notice: { id: "WH-D0", lines: [] },
    });
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: "PP-D0",
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
    expect(await outstanding(id)).toEqual([42.96]);

    // the filing counts its own $70 only: the core adds the lost one's share
    await dispute_opened({
      ...opened_on(id, 15, 70),
      disputed: { taken: 70, of: 100 },
    });
    expect(await outstanding(id)).toEqual([123.2]);
    await dispute_won(won_on(id));

    expect(await outstanding(id)).toEqual([42.96]);
  });

  test("a $33 refund, then a $67 dispute won: owes exactly the refund's share", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund_share(id, 33, "re_1");
    expect(await outstanding(id)).toEqual([30.75]);
    await dispute_opened({
      ...opened_on(id),
      disputed: { taken: 67, of: 100 },
    });

    await dispute_won(won_on(id));

    expect(await outstanding(id)).toEqual([30.75]);
  });

  test("a refund of $30 before a dispute over the other $70: the win leaves the refund's share owed", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund_share(id, 30, "re_1");
    await dispute_opened({
      ...opened_on(id),
      disputed: { taken: 70, of: 100 },
    });
    expect(await outstanding(id)).toEqual([108.2]);

    await dispute_won(won_on(id));

    expect(await outstanding(id)).toEqual([27.96]);
  });

  test("a second dispute after the first closed with no decision: its win credits the whole", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened({ ...opened_on(id), dispute_id: "PP-D1" });
    await dispute_won({
      ...won_on(id),
      dispute_id: "PP-D1",
      status: "inquiry_closed",
    });
    const second = await dispute_opened(opened_on(id));
    expect(second).toMatchObject({ prior_refs: ["PP-D1"] });

    await dispute_won(won_on(id));

    expect(await outstanding(id)).toEqual([0]);
  });

  test("a $30 chargeback taken before the dispute was filed: the win credits it", async () => {
    const { id } = await seed(PAID_GRANT);
    // a chargeback reversal recorded under its own ref, before its dispute
    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: { taken: 30, of: 100 },
      dispute_fee_usd: 15,
      source_ref: "REV-1",
      alert_from: "charge-dispute",
      notice: { id: "WH-1", lines: [] },
    });
    expect(await outstanding(id)).toEqual([42.96]);
    await dispute_opened(opened_on(id, 15, 30));

    await dispute_won(won_on(id));

    expect(await outstanding(id)).toEqual([0]);
  });

  test("a $30 dispute won, then a $40 refund: the refund owes its own share", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened(opened_on(id, 15, 30));
    await dispute_won(won_on(id));
    expect(await outstanding(id)).toEqual([0]);

    await refund_share(id, 40, "re_1");

    expect(await outstanding(id)).toEqual([37.28]);
  });
});

describe("dispute_opened, sized from the gift's own records", () => {
  const refund_share = (donation_id: string, taken: number, ref: string) =>
    reverse_charge({
      donation_id,
      rail: "stripe",
      source: "refund",
      share: { taken, of: 100 },
      source_ref: ref,
      alert_from: "charge-refunded",
      notice: { id: `evt_${ref}`, lines: [] },
    });
  const outstanding = async (id: string) =>
    (await owed_of(id)).map((o) => o.outstanding_usd);
  const close = (id: string, dispute_id: string, status: "lost" | "accepted") =>
    dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: dispute_id,
      donation_id: id,
      status,
      opened_at: OPENED,
      closed_at: CLOSED,
    });

  test("a $10 refund, a $30 chargeback lost, then a $60 dispute won: owes the refund's and the loss's shares", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund_share(id, 10, "re_1");
    await dispute_opened({ ...opened_on(id, 0, 30), dispute_id: "PP-D0" });
    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: { taken: 30, of: 100 },
      source_ref: "PP-D0",
      alert_from: "paypal-dispute",
      notice: { id: "WH-D0", lines: [] },
    });
    await close(id, "PP-D0", "lost");
    expect(await outstanding(id)).toEqual([37.28]);

    await dispute_opened({ ...opened_on(id, 0, 60), dispute_id: "PP-D1" });
    expect(await outstanding(id)).toEqual([93.2]);
    await dispute_won({ ...won_on(id), dispute_id: "PP-D1" });

    expect(await outstanding(id)).toEqual([37.28]);
  });

  test.each([
    [30, 27.96],
    [50, 46.6],
  ])(
    "a $%i refund, then a dispute over as much, won: owes the refund's share to the cent",
    async (usd, owed) => {
      const { id } = await seed(PAID_GRANT);
      await refund_share(id, usd, "re_1");
      expect(await outstanding(id)).toEqual([owed]);
      await dispute_opened(opened_after(id, 15, usd));

      await dispute_won(won_on(id));

      expect(await outstanding(id)).toEqual([owed]);
    }
  );

  test("a lost dispute whose chargeback isn't on record yet counts toward the next one", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened({ ...opened_on(id, 0, 30), dispute_id: "PP-D0" });
    await close(id, "PP-D0", "lost");

    await dispute_opened({ ...opened_on(id, 0, 70), dispute_id: "PP-D1" });
    await dispute_won({ ...won_on(id), dispute_id: "PP-D1" });

    expect(await outstanding(id)).toEqual([27.96]);
  });

  test("a claim accepted and paid as a refund counts once, through the refund", async () => {
    const { id } = await seed(PAID_GRANT);
    await dispute_opened({ ...opened_on(id, 0, 30), dispute_id: "PP-D0" });
    await dispute_won({
      ...won_on(id),
      dispute_id: "PP-D0",
      status: "accepted",
    });
    await refund_share(id, 30, "re_claim");
    expect(await outstanding(id)).toEqual([27.96]);

    await dispute_opened({ ...opened_on(id, 0, 60), dispute_id: "PP-D1" });

    expect(await outstanding(id)).toEqual([83.88]);
    expect(await dispute_get("PP-D0")).toMatchObject({ status: "accepted" });
  });
});

describe("a refund after a dispute lost, sized from the gift's own records", () => {
  /** a refund of `own` of the gift's $100 */
  const refund_share = (donation_id: string, own: number, ref: string) =>
    reverse_charge({
      donation_id,
      rail: "stripe",
      source: "refund",
      share: { taken: own, of: 100 },
      source_ref: ref,
      alert_from: "charge-refunded",
      notice: { id: `evt_${ref}`, lines: [] },
    });
  /** dispute `dispute_id` over `own` filed, its chargeback recorded when
   * `charged_back`, then closed lost */
  const lose_dispute = async (
    id: string,
    dispute_id: string,
    own: number,
    charged_back: boolean
  ) => {
    await dispute_opened({ ...opened_on(id, 0, own), dispute_id });
    if (charged_back) {
      await reverse_charge({
        donation_id: id,
        rail: "stripe",
        source: "dispute",
        share: { taken: own, of: 100 },
        source_ref: dispute_id,
        alert_from: "paypal-dispute",
        notice: { id: `WH-${dispute_id}`, lines: [] },
      });
    }
    await dispute_close(test_db.current!.db as unknown as DbOrTx, {
      id: dispute_id,
      donation_id: id,
      status: "lost",
      opened_at: OPENED,
      closed_at: CLOSED,
    });
  };
  const outstanding = async (id: string) =>
    (await owed_of(id)).map((o) => o.outstanding_usd);
  const status_of = async (id: string) =>
    (
      await test_db
        .current!.db.select({ status: donations.status })
        .from(donations)
        .where(eq(donations.id, id))
    )[0]?.status;

  test.each([
    ["recorded", true],
    ["never recorded", false],
  ])(
    "a 40 USD dispute lost, its chargeback %s, then a 60 USD refund reverses the gift owing the whole",
    async (_, charged_back) => {
      const { id } = await seed(PAID_GRANT);
      await lose_dispute(id, "PP-D0", 40, charged_back);
      expect(await outstanding(id)).toEqual([37.28]);

      expect((await refund_share(id, 60, "re_1")).status).toBe("reversed");

      expect(await status_of(id)).toBe("refunded_loss");
      expect(await outstanding(id)).toEqual([93.2]);
    }
  );

  test("a $20 refund, a $30 dispute lost, then $10 more refunded: owes 60% of it", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund_share(id, 20, "re_1");
    expect(await outstanding(id)).toEqual([18.64]);
    await lose_dispute(id, "PP-D0", 30, true);
    expect(await outstanding(id)).toEqual([46.6]);

    expect((await refund_share(id, 10, "re_2")).status).toBe("partial_owed");

    expect(await outstanding(id)).toEqual([55.92]);
  });

  test("a dispute after a $20 refund, a $30 dispute lost and $10 more refunded counts the lost one once", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund_share(id, 20, "re_1");
    await lose_dispute(id, "PP-D0", 30, true);
    await refund_share(id, 10, "re_2");

    await dispute_opened({ ...opened_on(id, 0, 40), dispute_id: "PP-D1" });

    expect(await outstanding(id)).toEqual([93.2]);
  });
});

describe("a paid commission on a disputed gift", () => {
  /** a $5 commission on the gift, paid to referrer `REF-1` */
  const seed_commission = (gift: { id: string; npo_ids: number[] }) =>
    seed_paid_commission(test_db.current!.db, gift, "REF-1", 5);

  const referrer_row = async (donation_id: string) =>
    (await owed_of(donation_id)).find((o) => o.referrer_user === "REF-1");

  test("is owed by its referrer from the open", async () => {
    const gift = await seed(PAID_GRANT);
    const { id } = gift;
    await seed_commission(gift);

    await dispute_opened(opened_on(id));

    expect(await referrer_row(id)).toEqual({
      npo_id: null,
      referrer_user: "REF-1",
      source: "dispute",
      source_ref: `du_${id}`,
      received_usd: 5,
      fee_processing_usd: 0,
      fee_dispute_usd: 0,
      outstanding_usd: 5,
    });
  });

  test("is credited back to its referrer on a win", async () => {
    const gift = await seed(PAID_GRANT);
    const { id } = gift;
    await seed_commission(gift);
    await dispute_opened(opened_on(id));

    await dispute_won(won_on(id));

    expect(await referrer_row(id)).toMatchObject({ outstanding_usd: 0 });
  });
});

/** the dispute closed lost: the gift reverses through the one reversal entry */
const lose = (donation_id: string, taken = 100) =>
  reverse_charge({
    donation_id,
    rail: "stripe",
    source: "dispute",
    share: { taken, of: 100 },
    dispute_fee_usd: 15,
    source_ref: `du_${donation_id}`,
    alert_from: "charge-dispute",
    notice: { id: `evt_lost_${donation_id}`, lines: [] },
  });

/** a refund of `taken` of the gift's $100 from `source`, not its dispute */
const refund = (
  donation_id: string,
  source: "refund" | "admin",
  taken = 100,
  ref = "re_1"
) =>
  reverse_charge({
    donation_id,
    rail: "stripe",
    source,
    share: { taken, of: 100 },
    source_ref: ref,
    alert_from: "charge-refunded",
    notice: { id: `evt_${ref}`, lines: [] },
  });

describe("a refund after a dispute opened on a pending payout", () => {
  /** what the npo is out for the gift: taken from its balances, plus what
   * its row still owes */
  const debited = async (id: string, npo_id: number, before: number) => {
    const [row] = await owed_of(id);
    return (
      before -
      (await balance_of(test_db.current!.db, npo_id)) +
      (row?.outstanding_usd ?? 0)
    );
  };

  test.each(["refund", "admin"] as const)(
    "a full %s takes what the npo received plus fees once",
    async (source) => {
      const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "pending" });
      const npo_id = npo_ids[0]!;
      const before = await balance_of(test_db.current!.db, npo_id);
      await dispute_opened(opened_on(id));

      expect((await refund(id, source)).status).toBe("reversed");

      expect(await debited(id, npo_id, before)).toBeCloseTo(108.2, 10);
    }
  );

  test("a redelivery of it changes nothing", async () => {
    const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "pending" });
    const npo_id = npo_ids[0]!;
    const before = await balance_of(test_db.current!.db, npo_id);
    await dispute_opened(opened_on(id));
    await refund(id, "refund");

    expect((await refund(id, "refund")).status).toBe("already_reversed");

    expect(await debited(id, npo_id, before)).toBeCloseTo(108.2, 10);
  });

  test("a partial refund takes nothing beyond the dispute's share its open recorded", async () => {
    const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "pending" });
    const npo_id = npo_ids[0]!;
    const before = await balance_of(test_db.current!.db, npo_id);
    await dispute_opened(opened_on(id, 15, 30));

    expect((await refund(id, "refund", 40)).status).toBe("partial_pending");

    expect(await debited(id, npo_id, before)).toBeCloseTo(42.96, 10);
  });
});

describe("a refund, then a dispute, on a grant not yet out", () => {
  test("the dispute's open owes only its own share, the refund's left to ops' hand adjustment", async () => {
    const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "pending" });
    const before = await balance_of(test_db.current!.db, npo_ids[0]!);
    const res = await refund(id, "refund", 30);
    expect(res.status).toBe("partial_pending");
    expect(await owed_of(id)).toEqual([]);

    await dispute_opened({
      ...opened_on(id),
      disputed: { taken: 70, of: 100 },
    });

    expect(await owed_of(id)).toMatchObject([
      {
        received_usd: 63,
        fee_processing_usd: 2.24,
        fee_dispute_usd: 15,
        outstanding_usd: 80.24,
      },
    ]);
    expect(await balance_of(test_db.current!.db, npo_ids[0]!)).toBe(before);
  });
});

describe("a dispute lost after it opened", () => {
  test.each([
    ["its payout still pending", "pending"],
    ["its share in savings", "savings"],
  ] as const)(
    "takes what the npo received plus fees once, %s at open",
    async (_, payout) => {
      const { id, npo_ids } = await seed({ ...PAID_GRANT, payout });
      const npo_id = npo_ids[0]!;
      const before = await balance_of(test_db.current!.db, npo_id);

      await dispute_opened(opened_on(id));
      const at_open = await owed_of(id);
      const res = await lose(id);

      expect(at_open).toMatchObject([{ outstanding_usd: 108.2 }]);
      expect(res.status).toBe("reversed");
      const [row] = await owed_of(id);
      const taken =
        before -
        (await balance_of(test_db.current!.db, npo_id)) +
        (row?.outstanding_usd ?? NaN);
      expect(taken).toBeCloseTo(108.2, 10);
    }
  );

  test("over part of the charge on a pending payout, says its share is already owed rather than to settle it by hand", async () => {
    const { id } = await seed({ ...PAID_GRANT, payout: "pending" });
    await dispute_opened(opened_on(id, 15, 30));

    const res = await lose(id, 30);

    expect(res).toMatchObject({
      status: "partial_owed",
      owed_msgs: [expect.stringMatching(/^\$42\.96 recorded as owed by /)],
    });
    expect(await owed_of(id)).toMatchObject([{ outstanding_usd: 42.96 }]);
  });

  test("over part of the charge, owes what its open recorded and reverses nothing", async () => {
    const { id, npo_ids } = await seed(PAID_GRANT);
    const npo_id = npo_ids[0]!;
    const cash_before = await balance_of(test_db.current!.db, npo_id);
    await dispute_opened(opened_on(id, 15, 30));
    const res = await lose(id, 30);

    expect(res.status).toBe("partial_owed");
    expect(await owed_of(id)).toMatchObject([{ outstanding_usd: 42.96 }]);
    const [don] = await test_db
      .current!.db.select({ status: donations.status })
      .from(donations)
      .where(eq(donations.id, id));
    expect(don!.status).toBe("settled");
    expect(await balance_of(test_db.current!.db, npo_id)).toEqual(cash_before);
  });

  test("the rest refunded with its payout pending at open, takes back what the npo received and leaves its share of the fees owed", async () => {
    const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "pending" });
    const npo_id = npo_ids[0]!;
    const before = await balance_of(test_db.current!.db, npo_id);

    await dispute_opened(opened_on(id, 15, 30));
    await lose(id, 30);
    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: { taken: 70, of: 100 },
      source_ref: "re_rest",
      alert_from: "charge-refunded",
      notice: { id: "evt_rest", lines: [] },
    });

    expect(res.status).toBe("reversed");
    expect(before - (await balance_of(test_db.current!.db, npo_id))).toBe(90);
    expect(await owed_of(id)).toMatchObject([{ outstanding_usd: 15.96 }]);
  });

  test("with no open on record, owes what the loss path records plus the dispute fee", async () => {
    // half to savings the npo no longer holds, half to a pending payout the
    // reversal cancels: a loss that takes $45 back and owes the rest
    const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "pending" });
    const db = test_db.current!.db;
    await db
      .update(dists)
      .set({ alloc: { liq: 50, lock: 0, cash: 50 } })
      .where(eq(dists.donation_id, id));
    await db.update(npos).set({ cash: 45 }).where(eq(npos.id, npo_ids[0]!));
    await db
      .update(payouts)
      .set({ amount: 45 })
      .where(eq(payouts.npo_id, npo_ids[0]!));

    await lose(id);

    expect(await owed_of(id)).toMatchObject([
      {
        received_usd: 45,
        fee_processing_usd: 3.2,
        fee_dispute_usd: 15,
        outstanding_usd: 63.2,
      },
    ]);
  });

  test("reverses a paid-grant gift, keeping the row and booking no loss", async () => {
    const { id, npo_ids } = await seed(PAID_GRANT);
    const db = test_db.current!.db;

    await dispute_opened(opened_on(id));
    const res = await lose(id);

    expect(res.status).toBe("reversed");
    const [don] = await db
      .select({ status: donations.status })
      .from(donations)
      .where(eq(donations.id, id));
    expect(don?.status).toBe("refunded_loss");
    expect(await owed_of(id)).toEqual([
      {
        npo_id: npo_ids[0],
        referrer_user: null,
        source: "dispute",
        source_ref: `du_${id}`,
        received_usd: 90,
        fee_processing_usd: 3.2,
        fee_dispute_usd: 15,
        outstanding_usd: 108.2,
      },
    ]);
    expect(await db.select().from(loss_logs)).toEqual([]);
  });
});

/** a returned payout's money is back in the npo's cash and not yet re-sent,
 * so every refund and dispute of its gift runs as on a pending payout */
describe("a gift whose grant transfer came back", () => {
  /** every balance the gift's reversal can move */
  const books_of = async (id: string, npo_id: number) => {
    const db = test_db.current!.db;
    const [npo] = await db
      .select({ cash: npos.cash, liq: npos.liq, lock_units: npos.lock_units })
      .from(npos)
      .where(eq(npos.id, npo_id));
    const [dist] = await db
      .select({ status: dists.status, refund_status: dists.refund_status })
      .from(dists)
      .where(eq(dists.donation_id, id));
    const [po] = await db
      .select({ type: payouts.type })
      .from(payouts)
      .where(eq(payouts.source_id, `dist-${id}-0`));
    const [don] = await db
      .select({ status: donations.status })
      .from(donations)
      .where(eq(donations.id, id));
    return {
      npo,
      dist,
      payout: po?.type,
      donation: don?.status,
      owed: await owed_of(id),
    };
  };

  /** the gift's loss logs, the figures the platform took */
  const losses_of = async (id: string) => {
    const db = test_db.current!.db;
    const rows = await db
      .select()
      .from(loss_logs)
      .where(eq(loss_logs.donation_id, id));
    return rows.map((l) => ({
      id: l.id,
      npo_id: l.npo_id,
      type: l.type,
      amount: l.amount,
      npo_amount: l.npo_amount,
      fees_bg: l.fees_bg,
      fees_processing: l.fees_processing,
    }));
  };

  test.each(["pending", "returned"] as const)(
    "a full refund of a %s payout cancels it and takes its cash back, owing nothing",
    async (payout) => {
      const { id, npo_ids } = await seed({ ...PAID_GRANT, payout });
      const npo_id = npo_ids[0]!;
      expect((await books_of(id, npo_id)).npo).toEqual({
        cash: 90,
        liq: 0,
        lock_units: 0,
      });

      expect((await refund(id, "refund")).status).toBe("reversed");

      expect(await books_of(id, npo_id)).toEqual({
        npo: { cash: 0, liq: 0, lock_units: 0 },
        dist: { status: "refunded", refund_status: "completed" },
        payout: "refunded",
        donation: "refunded",
        owed: [],
      });
    }
  );

  test.each(["pending", "returned"] as const)(
    "a partial refund of a %s payout leaves its books and records nothing owed",
    async (payout) => {
      const { id, npo_ids } = await seed({ ...PAID_GRANT, payout });
      const npo_id = npo_ids[0]!;

      const res = await refund(id, "refund", 30);

      expect(res.status).toBe("partial_pending");
      expect(await books_of(id, npo_id)).toEqual({
        npo: { cash: 90, liq: 0, lock_units: 0 },
        dist: { status: "settled", refund_status: null },
        payout,
        donation: "settled",
        owed: [],
      });
    }
  );

  test.each(["pending", "returned"] as const)(
    "a dispute open on a %s payout owes its share and fees, and its loss cancels the payout and credits the cash taken",
    async (payout) => {
      const { id, npo_ids } = await seed({ ...PAID_GRANT, payout });
      const npo_id = npo_ids[0]!;

      await dispute_opened(opened_on(id));
      const at_open = await books_of(id, npo_id);
      expect((await lose(id)).status).toBe("reversed");

      expect(at_open).toMatchObject({
        npo: { cash: 90, liq: 0, lock_units: 0 },
        payout,
        owed: [{ received_usd: 90, outstanding_usd: 108.2 }],
      });
      expect(await books_of(id, npo_id)).toEqual({
        npo: { cash: 0, liq: 0, lock_units: 0 },
        dist: { status: "refunded", refund_status: "completed" },
        payout: "refunded",
        donation: "refunded",
        owed: [
          expect.objectContaining({
            received_usd: 90,
            fee_dispute_usd: 15,
            outstanding_usd: 18.2,
          }),
        ],
      });
    }
  );

  test.each(["pending", "returned"] as const)(
    "a dispute won on a %s payout leaves its cash and owes nothing",
    async (payout) => {
      const { id, npo_ids } = await seed({ ...PAID_GRANT, payout });
      const npo_id = npo_ids[0]!;
      await dispute_opened(opened_on(id));

      await dispute_won(won_on(id));

      expect(await books_of(id, npo_id)).toMatchObject({
        npo: { cash: 90, liq: 0, lock_units: 0 },
        dist: { status: "settled", refund_status: null },
        payout,
        donation: "settled",
        owed: [expect.objectContaining({ outstanding_usd: 0 })],
      });
    }
  );

  test("a full refund of a void payout leaves it void, owing nothing, and books the platform's loss", async () => {
    const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "void" });
    const npo_id = npo_ids[0]!;

    expect((await refund(id, "refund")).status).toBe("reversed");

    expect(await books_of(id, npo_id)).toEqual({
      npo: { cash: 0, liq: 0, lock_units: 0 },
      dist: { status: "refunded", refund_status: "loss" },
      payout: "void",
      donation: "refunded_loss",
      owed: [],
    });
    expect(await losses_of(id)).toEqual([
      {
        id: `void:dist-${id}-0`,
        npo_id,
        type: "payout",
        amount: expect.closeTo(100, 6),
        npo_amount: 90,
        fees_bg: 6.8,
        fees_processing: 3.2,
      },
    ]);
  });

  test("a partial refund of a void payout records nothing owed and says why", async () => {
    const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "void" });

    const res = await refund(id, "refund", 30);

    expect(res).toMatchObject({ status: "partial_pending" });
    expect(await owed_of(id)).toEqual([]);
    expect(await balance_of(test_db.current!.db, npo_ids[0]!)).toBe(0);
    expect(JSON.stringify(vi.mocked(enqueue).mock.calls)).toMatch(
      /not owed: dist [^"]* its grant payout is void, so nothing of it is recorded as owed/
    );
  });

  /** a void payout's cash share was never a grant: the platform takes its
   * loss, so a dispute of it owes nothing, fees included */
  test.each(["lost", "won"] as const)(
    "a dispute on a void payout records nothing owed, open or %s",
    async (end) => {
      const { id, npo_ids } = await seed({ ...PAID_GRANT, payout: "void" });
      const npo_id = npo_ids[0]!;

      await dispute_opened(opened_on(id));
      const at_open = await books_of(id, npo_id);
      if (end === "lost") expect((await lose(id)).status).toBe("reversed");
      else await dispute_won(won_on(id));

      expect(at_open).toEqual({
        npo: { cash: 0, liq: 0, lock_units: 0 },
        dist: { status: "settled", refund_status: null },
        payout: "void",
        donation: "settled",
        owed: [],
      });
      expect(await books_of(id, npo_id)).toEqual(
        end === "lost"
          ? {
              npo: { cash: 0, liq: 0, lock_units: 0 },
              dist: { status: "refunded", refund_status: "loss" },
              payout: "void",
              donation: "refunded_loss",
              owed: [],
            }
          : at_open
      );
      expect(await losses_of(id)).toEqual(
        end === "lost"
          ? [
              expect.objectContaining({
                id: `void:dist-${id}-0`,
                type: "payout",
                npo_amount: 90,
              }),
            ]
          : []
      );
    }
  );

  describe("with half its net in savings", () => {
    const HALF_SAVED: IDistSeed = {
      ...PAID_GRANT,
      payout: "void",
      savings: 50,
    };

    test("a full refund takes the savings share back, and books the void cash share as the platform's loss", async () => {
      const { id, npo_ids } = await seed(HALF_SAVED);
      const npo_id = npo_ids[0]!;
      expect((await books_of(id, npo_id)).npo).toEqual({
        cash: 0,
        liq: 45,
        lock_units: 0,
      });

      expect((await refund(id, "refund")).status).toBe("reversed");

      expect(await books_of(id, npo_id)).toEqual({
        npo: { cash: 0, liq: 0, lock_units: 0 },
        dist: { status: "refunded", refund_status: "loss" },
        payout: "void",
        donation: "refunded_loss",
        owed: [],
      });
      expect(await losses_of(id)).toEqual([
        {
          id: `void:dist-${id}-0`,
          npo_id,
          type: "payout",
          amount: expect.closeTo(50, 6),
          npo_amount: 45,
          fees_bg: 3.4,
          fees_processing: 1.6,
        },
      ]);
    });

    test("a full refund that then fails books no loss and has ops re-settle the savings share", async () => {
      const { id } = await seed(HALF_SAVED);
      expect((await refund(id, "refund")).status).toBe("reversed");

      const res = await refund_failed({
        donation_id: id,
        rail: "stripe",
        refund_id: "re_1",
      });

      expect(res).toMatchObject({
        status: "by_hand",
        by_hand: [
          expect.stringMatching(
            /savings and investment shares back from the npo's balances; re-settle them by hand/
          ),
        ],
      });
      expect(await losses_of(id)).toEqual([]);
    });

    test("a partial refund leaves its books and records nothing owed", async () => {
      const { id, npo_ids } = await seed(HALF_SAVED);

      expect((await refund(id, "refund", 30)).status).toBe("partial_pending");

      expect(await books_of(id, npo_ids[0]!)).toEqual({
        npo: { cash: 0, liq: 45, lock_units: 0 },
        dist: { status: "settled", refund_status: null },
        payout: "void",
        donation: "settled",
        owed: [],
      });
    });

    test("a dispute open owes the savings share and its part of the fees; lost, it takes the savings back and leaves the fees owed", async () => {
      const { id, npo_ids } = await seed(HALF_SAVED);
      const npo_id = npo_ids[0]!;

      await dispute_opened(opened_on(id));
      const at_open = await books_of(id, npo_id);
      expect((await lose(id)).status).toBe("reversed");

      expect(at_open).toMatchObject({
        npo: { cash: 0, liq: 45, lock_units: 0 },
        owed: [
          {
            received_usd: 45,
            fee_processing_usd: 1.6,
            fee_dispute_usd: 7.5,
            outstanding_usd: 54.1,
          },
        ],
      });
      expect(await books_of(id, npo_id)).toEqual({
        npo: { cash: 0, liq: 0, lock_units: 0 },
        dist: { status: "refunded", refund_status: "loss" },
        payout: "void",
        donation: "refunded_loss",
        owed: [
          expect.objectContaining({ received_usd: 45, outstanding_usd: 9.1 }),
        ],
      });
      expect(await losses_of(id)).toEqual([
        expect.objectContaining({ type: "payout", npo_amount: 45 }),
      ]);
    });

    test("a dispute won leaves the savings and owes nothing", async () => {
      const { id, npo_ids } = await seed(HALF_SAVED);
      await dispute_opened(opened_on(id));

      await dispute_won(won_on(id));

      expect(await books_of(id, npo_ids[0]!)).toMatchObject({
        npo: { cash: 0, liq: 45, lock_units: 0 },
        dist: { status: "settled", refund_status: null },
        payout: "void",
        donation: "settled",
        owed: [expect.objectContaining({ outstanding_usd: 0 })],
      });
    });
  });
});
