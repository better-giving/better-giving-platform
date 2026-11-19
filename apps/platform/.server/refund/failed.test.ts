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
  clear_card_gifts,
  PAID_GRANT,
  seed_card_gift,
  seed_paid_commission,
} from "#/__tests__/fixtures/card-gift";
import { seed_user } from "#/__tests__/fixtures/funds";
import { lock_order, logged_db } from "#/__tests__/fixtures/locks";
import { dists } from "../pg/schema/dist";
import { donations } from "../pg/schema/donation";
import { npos } from "../pg/schema/npo";
import { owed_amounts } from "../pg/schema/owed";
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
// the full refund's subscription lookup: no gift here is recurring
vi.mock("../kit/stripe", () => ({
  stripe: { invoicePayments: { list: vi.fn(async () => ({ data: [] })) } },
}));

// --- imports (after mocks) ---

import { donation_get } from "../pg/queries/donation";
import type { DbOrTx } from "../pg/queries/helpers";
import {
  owed_for_donation,
  recover_owed,
  write_off_owed,
} from "../pg/queries/owed";
import { takes_of } from "../pg/queries/take";
import { create_test_db } from "../pg/test-utils/pglite";
import { refund_failed } from "./failed";
import { reverse_charge } from "./reverse";
import { taken_of } from "./takes";

// --- setup ---

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

const seed = (...ds: Parameters<typeof seed_card_gift>[1][]) =>
  seed_card_gift(test_db.current!.db, ...ds);

/** a stripe refund of `own` of the gift's $100 that succeeded; an event
 * confirming the refunds `counted` takes each of them instead */
const refund = (
  donation_id: string,
  own: number,
  ref: string,
  counted?: { id: string; amount: number }[]
) =>
  reverse_charge({
    donation_id,
    rail: "stripe",
    source: "refund",
    share: { taken: own, of: 100 },
    refunds: counted,
    source_ref: ref,
    alert_from: "charge-refunded",
    notice: { id: `evt_${ref}`, lines: [] },
  });

/** refund `ref` failed after succeeding */
const fail = (donation_id: string, ref: string) =>
  refund_failed({ donation_id, rail: "stripe", refund_id: ref });

const gift = async (id: string) =>
  (
    await test_db
      .current!.db.select()
      .from(donations)
      .where(eq(donations.id, id))
  )[0];

/** what the gift's active takes take back */
const taken = async (id: string) =>
  taken_of(await takes_of(test_db.current!.db as unknown as DbOrTx, id));

const outstanding = async (donation_id: string) =>
  (await owed_for_donation(donation_id)).map((o) => o.outstanding_usd);

describe("refund_failed — row locks", () => {
  // the order `dists_locked` in ./share documents: a refused transfer's
  // rebook holds the donation while it waits on the dist
  test("credits back under the donation's lock, then its dists'", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    const real = test_db.current!;
    const { db, queries } = logged_db(real);
    test_db.current = { ...real, db };

    try {
      await fail(id, "re_1");
    } finally {
      test_db.current = real;
    }

    expect(await taken(id)).toBe(0);
    expect(lock_order(queries, ["donations", "dists", "npos"])).toEqual([
      "donations",
      "dists",
    ]);
  });
});

describe("refund_failed — part of the charge", () => {
  test("a failed $40 of a gift since refunded in full credits back only its share", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    await refund(id, 60, "re_2");

    await fail(id, "re_1");

    expect(await outstanding(id)).toEqual([55.92]);
  });

  test("two failed partials each credit their own share", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    await refund(id, 30, "re_2");
    expect(await outstanding(id)).toEqual([65.24]);

    await fail(id, "re_1");
    expect(await outstanding(id)).toEqual([27.96]);
    expect(await taken(id)).toBe(0.3);

    await fail(id, "re_2");

    expect(await outstanding(id)).toEqual([0]);
    expect(await taken(id)).toBe(0);
  });

  test("a redelivery of either failure, after both failed, changes nothing", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    await refund(id, 30, "re_2");
    await fail(id, "re_1");
    await fail(id, "re_2");

    await fail(id, "re_1");
    await fail(id, "re_2");

    expect(await outstanding(id)).toEqual([0]);
    expect(await taken(id)).toBe(0);
  });

  test("a redelivery of the first failure, landing after the second failed at stripe, leaves the second its own share", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    await refund(id, 30, "re_2");
    await fail(id, "re_1");

    // re_2 has failed at stripe, so re_1's redelivery counts no others
    const again = await fail(id, "re_1");

    expect(again).toMatchObject({ status: "not_recorded" });
    expect(await taken(id)).toBe(0.3);
    await fail(id, "re_2");
    expect(await outstanding(id)).toEqual([0]);
    expect(await taken(id)).toBe(0);
  });

  test("a refund event that read the refunds before one failed doesn't owe the failed one again", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    await refund(id, 30, "re_2");
    await fail(id, "re_1");

    // re_2's redelivery, its list read while re_1 still stood
    await refund(id, 30, "re_2", [
      { id: "re_1", amount: 40 },
      { id: "re_2", amount: 30 },
    ]);

    expect(await outstanding(id)).toEqual([27.96]);
  });

  test("a refund that failed before anything recorded it credits nothing", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");

    const res = await fail(id, "re_2");

    expect(res).toEqual({ status: "not_recorded", donation_status: "settled" });
    expect(await outstanding(id)).toEqual([37.28]);
    expect(await taken(id)).toBe(0.4);
  });

  test("a full refund after a failed $40 partial owes the full figure", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    await fail(id, "re_1");

    expect((await refund(id, 100, "re_2")).status).toBe("reversed");

    expect(await outstanding(id)).toEqual([93.2]);
  });

  test("a recovered $40 partial that failed, then a $60 refund, owes the $60's share less what was recovered", async () => {
    const { id, npo_ids } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    await recover_owed(test_db.current!.db as unknown as DbOrTx, {
      donation_id: id,
      party: { npo_id: npo_ids[0]! },
      usd: 37.28,
      reason: "grant_run",
      ref: "run-1",
      now: "2026-10-02T00:00:00.000Z",
    });
    await fail(id, "re_1");
    expect(await outstanding(id)).toEqual([-37.28]);

    await refund(id, 60, "re_2");

    expect(await outstanding(id)).toEqual([18.64]);
  });

  test("a failed $40 partial owes nothing", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    expect(await outstanding(id)).toEqual([37.28]);

    const res = await fail(id, "re_1");

    expect(res).toMatchObject({
      status: "credited",
      donation_status: "settled",
    });
    expect(await outstanding(id)).toEqual([0]);
    expect(await taken(id)).toBe(0);
  });

  test("a $60 refund after a failed $40 partial owes its own share, not reversing the gift", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 40, "re_1");
    await fail(id, "re_1");

    expect((await refund(id, 60, "re_2")).status).toBe("partial_owed");

    expect(await outstanding(id)).toEqual([55.92]);
    expect((await gift(id))?.status).toBe("settled");
    expect(await taken(id)).toBe(0.6);
  });
});

describe("refund_failed — a gift whose grant hadn't gone out", () => {
  test.each([
    ["reversed from a pending payout", "pending", 100],
    ["reversed from savings", "savings", 100],
    ["partly refunded on a pending payout", "pending", 40],
  ] as const)(
    "%s credits nothing and names the dist to undo by hand",
    async (_, payout, taken) => {
      const { id } = await seed({ ...PAID_GRANT, payout });
      await refund(id, taken, "re_1");

      const res = await fail(id, "re_1");

      expect(res).toEqual({
        status: "by_hand",
        donation_status: taken === 100 ? "refunded" : "settled",
        credited: [],
        by_hand: [expect.stringMatching(new RegExp(`^dist dist-${id}-0 `))],
      });
      expect(await owed_for_donation(id)).toEqual([]);
    }
  );
});

describe("refund_failed — a written-off row", () => {
  test("credits nothing past the write-off and names its loss log for finance to reverse", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 100, "re_1");
    const db = test_db.current!.db as unknown as DbOrTx;
    const admin = await seed_user(test_db.current!.db, "admin@test.com");
    const [row] = await owed_for_donation(id);
    await write_off_owed(db, {
      owed_id: row!.id,
      reason: "pre-terms gift",
      actor: admin!.id,
      now: "2026-10-03T00:00:00.000Z",
    });

    const res = await fail(id, "re_1");

    expect(res).toMatchObject({
      status: "by_hand",
      by_hand: [
        expect.stringMatching(
          new RegExp(
            `\\$93\\.20 .*written off.*owed row ${row!.id}'s write-off ${row!.id}:\\S+ .*loss log write_off:${row!.id}:`
          )
        ),
      ],
    });
    expect(await outstanding(id)).toEqual([0]);
  });
});

describe("refund_failed — a reversed paid-grant gift", () => {
  test("credits back the $93.20 its refund recorded, leaving the gift reversed", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 100, "re_1");
    expect(await outstanding(id)).toEqual([93.2]);

    const res = await fail(id, "re_1");

    expect(res).toMatchObject({
      status: "credited",
      donation_status: "refunded_loss",
    });
    expect(await outstanding(id)).toEqual([0]);
    expect((await donation_get(id))!.status).toBe("refunded_loss");
  });

  test("a row already recovered leaves the npo due the $93.20 back", async () => {
    const { id, npo_ids } = await seed(PAID_GRANT);
    await refund(id, 100, "re_1");
    await recover_owed(test_db.current!.db as unknown as DbOrTx, {
      donation_id: id,
      party: { npo_id: npo_ids[0]! },
      usd: 93.2,
      reason: "grant_run",
      ref: "run-1",
      now: "2026-10-02T00:00:00.000Z",
    });

    await fail(id, "re_1");

    expect(await outstanding(id)).toEqual([-93.2]);
  });

  test("credits back the referrer's row from the same refund", async () => {
    const gift = await seed(PAID_GRANT);
    await seed_paid_commission(test_db.current!.db, gift, "REF-1", 5);
    await refund(gift.id, 100, "re_1");

    await fail(gift.id, "re_1");

    const rows = await owed_for_donation(gift.id);
    expect(rows.map((o) => [o.referrer_user, o.outstanding_usd])).toEqual(
      expect.arrayContaining([
        [null, 0],
        ["REF-1", 0],
      ])
    );
  });

  test("a redelivery credits nothing twice", async () => {
    const { id } = await seed(PAID_GRANT);
    await refund(id, 100, "re_1");
    await fail(id, "re_1");

    const again = await fail(id, "re_1");

    expect(await outstanding(id)).toEqual([0]);
    expect(again).toEqual({
      status: "not_recorded",
      donation_status: "refunded_loss",
    });
  });
});

describe("refund_failed — a refused transfer's cut", () => {
  // rebuilding 33.33 / (2/3) sizes the short at $16.66 or $16.68
  test("a one-third cut reports the short from the stored settled net", async () => {
    const { id } = await seed({
      net: 50,
      fee_processing: 0,
      fee_base: 0,
      payout: "pending",
    });
    await test_db
      .current!.db.update(dists)
      .set({ net: 33.33, refunds_cut_share: 1 / 3, settled_net: 50 })
      .where(eq(dists.donation_id, id));
    await refund(id, 34, "re_1");

    const res = await fail(id, "re_1");

    const lines = res.status === "by_hand" ? res.by_hand : [];
    const short = lines.filter((l) => l.includes("short"));
    expect(short).toHaveLength(1);
    expect(short[0]).toMatch(/short \$16\.67\b/);
  });
});

describe("refund_failed — a void payout's gift", () => {
  // $90 net, half void cash and half savings the npo no longer holds, so the
  // reversal records $45 owed, $1.60 of the $3.20 card fee, and a platform
  // loss of $45 + $3.40 + $1.60
  const HALF_SAVED = { ...PAID_GRANT, payout: "void", savings: 50 } as const;

  const reversed_by_two_halves = async () => {
    const { id } = await seed(HALF_SAVED);
    await test_db.current!.db.update(npos).set({ liq: 0 });
    await refund(id, 50, "re_a");
    await refund(id, 50, "re_b");
    expect((await gift(id))?.status).toBe("refunded_loss");
    return id;
  };

  const loss_of = async (id: string) =>
    (
      await test_db
        .current!.db.select()
        .from(loss_logs)
        .where(eq(loss_logs.donation_id, id))
    ).map((l) => ({
      amount: l.amount,
      npo_amount: l.npo_amount,
      fees_bg: l.fees_bg,
      fees_processing: l.fees_processing,
    }));

  test("one of two half-refunds failing credits back half the void gift's fee, not all of it", async () => {
    const id = await reversed_by_two_halves();
    const [owed] = await owed_for_donation(id);
    expect([owed?.received_usd, owed?.fee_processing_usd]).toEqual([45, 1.6]);

    await fail(id, "re_b");

    const [after] = await owed_for_donation(id);
    // half the $45 and half the $1.60 fee, and nothing more
    expect(after?.credited_back_usd).toBeCloseTo(22.5 + 0.8, 6);
  });

  test("one of two half-refunds failing leaves the platform's loss at what the donor got back", async () => {
    const id = await reversed_by_two_halves();
    expect(await loss_of(id)).toEqual([
      {
        amount: expect.closeTo(50, 6),
        npo_amount: 45,
        fees_bg: 3.4,
        fees_processing: 1.6,
      },
    ]);

    await fail(id, "re_b");

    expect(await taken(id)).toBe(0.5);
    const [loss] = await loss_of(id);
    expect(loss).toMatchObject({ npo_amount: 22.5, fees_bg: 1.7 });
    expect(loss?.fees_processing).toBeCloseTo(0.8, 6);
    expect(loss?.amount).toBeCloseTo(25, 6);
  });

  test("the second half-refund failing too books no loss", async () => {
    const id = await reversed_by_two_halves();

    await fail(id, "re_b");
    await fail(id, "re_a");

    expect(await loss_of(id)).toEqual([]);
  });
});
