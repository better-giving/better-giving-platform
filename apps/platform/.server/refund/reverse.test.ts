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
import { alert_text } from "#/__tests__/fixtures/alert-text";
import { lock_order, logged_db } from "#/__tests__/fixtures/locks";
import { user } from "../pg/schema/auth";
import { bal_txs } from "../pg/schema/bal-tx";
import { donation_disputes } from "../pg/schema/dispute";
import { dists } from "../pg/schema/dist";
import {
  donation_donors,
  donation_recipients,
  donation_settlements,
  donations,
} from "../pg/schema/donation";
import { forms } from "../pg/schema/form";
import { donation_match_events } from "../pg/schema/match";
import { npos } from "../pg/schema/npo";
import { owed_amounts } from "../pg/schema/owed";
import { payouts } from "../pg/schema/payout";
import { programs } from "../pg/schema/program";
import { referrer_commissions } from "../pg/schema/referrer";
import { loss_logs } from "../pg/schema/revenue";
import { subscriptions } from "../pg/schema/subscription";
import { donation_takes } from "../pg/schema/take";
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

// the lost-dispute alert's own read of the owed rows is the one call made with
// no transaction: `fail` makes just that one reject
const owed_read = vi.hoisted(() => ({ fail: false }));
vi.mock("../pg/queries/owed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pg/queries/owed")>();
  return {
    ...actual,
    owed_for_donation: (
      ...args: Parameters<typeof actual.owed_for_donation>
    ) =>
      owed_read.fail && args.length === 1
        ? Promise.reject(new Error("owed read failed"))
        : actual.owed_for_donation(...args),
  };
});

const fiat_alert = vi.hoisted(() => vi.fn());
vi.mock("../kit/slack", () => ({ fiat_monitor: { send_alert: fiat_alert } }));

const enqueue = vi.hoisted(() => vi.fn());
vi.mock("../kit/queue", () => ({ enqueue }));

const report_error = vi.hoisted(() => vi.fn());
vi.mock("#/errors/report", () => ({ report_error }));

// the filed-claim heads-up's only side effect. mocked at the module rather than
// at the transport, so a test can make the send throw as well as refuse
const send_email = vi.hoisted(() => vi.fn());
vi.mock("../email", () => ({ send_email }));

// the stripe boundary the subscription lookup crosses: which subscription, if
// any, the refunded payment intent paid an invoice of
const invoice_sub = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("../kit/stripe", () => ({
  stripe: {
    invoicePayments: {
      list: vi.fn(async () => ({
        data: invoice_sub.id
          ? [
              {
                invoice: {
                  parent: {
                    subscription_details: { subscription: invoice_sub.id },
                  },
                },
              },
            ]
          : [],
      })),
    },
  },
}));

// --- imports (after mocks) ---

import { stripe } from "../kit/stripe";
import { donation_get } from "../pg/queries/donation";
import type { DbOrTx } from "../pg/queries/helpers";
import { owed_for_donation } from "../pg/queries/owed";
import { commissions_mark_paid } from "../pg/queries/referrer";
import { create_test_db } from "../pg/test-utils/pglite";
import { dispute_opened } from "./dispute";
import { has_settled_dists, reversal_preview, reverse_charge } from "./reverse";
import { owe_takes, owe_takes_of_dists } from "./takes";
import { reverse_unfunded_payout_loss } from "./unfunded";

// --- setup ---

let counter = 0;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  invoice_sub.id = null;
  enqueue.mockResolvedValue(undefined);
  send_email.mockResolvedValue({ data: { id: "msg-1" }, error: null });
  const db = test_db.current!.db;
  await db.delete(bal_txs);
  await db.delete(loss_logs);
  await db.delete(owed_amounts);
  await db.delete(donation_disputes);
  await db.delete(donation_takes);
  await db.delete(payouts);
  await db.delete(dists);
  await db.delete(donation_match_events);
  await db.delete(donation_settlements);
  await db.delete(donation_donors);
  await db.delete(donation_recipients);
  await db.delete(donations);
  await db.delete(forms);
  await db.delete(programs);
  await db.delete(subscriptions);
  await db.delete(referrer_commissions);
  await db.delete(npos);
  await db.delete(user);
});

/** a settled gift of $100 on `via`, distributed whole to one npo's liquid
 * balance, which holds $1000 */
async function seed(
  via: string,
  o?: { fee?: number; currency?: string; made_at?: string }
) {
  counter++;
  const db = test_db.current!.db;
  const [npo] = await db
    .insert(npos)
    .values({
      registration_number: `EIN-REV-${counter}`,
      name: `Test NPO ${counter}`,
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
      liq: 1000,
      lock_units: 0,
      cash: 0,
    })
    .returning();

  const id = `don-${counter}`;
  await db.insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: 100,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via,
  });
  await db.insert(donation_recipients).values({
    donation_id: id,
    npo_id: npo!.id,
    name: npo!.name,
    type: "npo",
  });
  await db.insert(donation_donors).values({
    donation_id: id,
    email: "donor@test.com",
  });
  await db.insert(donation_settlements).values({
    donation_id: id,
    sttl_id: `sttl-${counter}`,
    // paid on the recovery cutoff, so the revised terms still allow the take-back
    date: o?.made_at ?? "2026-10-23T16:00:00.000Z",
    currency: o?.currency ?? "USD",
    net: 96.8,
    fee: o?.fee ?? 3.2,
  });
  await db.insert(dists).values({
    id: `dist-${id}`,
    donation_id: id,
    status: "settled",
    date_created: "2026-07-01T00:00:00.000Z",
    to_id: npo!.id,
    to_name: npo!.name,
    amount: 100,
    amount_usd: 100,
    amount_denom: "USD",
    net: 100,
    fee_base: 0,
    fee_fsa: 0,
    fee_processing: 0,
    alloc: { liq: 100, lock: 0, cash: 0 },
  });
  return { id, npo_id: npo!.id, sttl_id: `sttl-${counter}` };
}

const notice = { id: "evt_1", lines: ["donation x, charge ch_1, event evt_1"] };
const whole = { taken: 100, of: 100 };

/** a second dist with no npo, which fails to reverse */
const seed_orphan_dist = (id: string) =>
  test_db.current!.db.insert(dists).values({
    id: `dist-${id}-orphan`,
    donation_id: id,
    status: "settled",
    date_created: "2026-07-01T00:00:00.000Z",
    to_id: null,
    amount_denom: "USD",
    net: 10,
    alloc: { liq: 100, lock: 0, cash: 0 },
  });

async function state(id: string, npo_id: number) {
  const db = test_db.current!.db;
  const [don] = await db.select().from(donations).where(eq(donations.id, id));
  const [dist] = await db.select().from(dists).where(eq(dists.donation_id, id));
  const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
  return {
    don: don!.status,
    dist: [dist!.status, dist!.refund_status],
    liq: npo!.liq,
    bal_txs: (await db.select().from(bal_txs)).length,
  };
}

describe("reverse_charge — a full refund", () => {
  test("a gift paid before the cutoff keeps its savings", async () => {
    const { id, npo_id } = await seed("stripe:card", {
      made_at: "2026-10-22T16:00:00.000Z",
    });

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      alert_from: "charge-refunded",
      notice,
    });

    expect(res).toMatchObject({ status: "reversed", applied: 1 });
    expect(await state(id, npo_id)).toMatchObject({
      don: "refunded",
      dist: ["refunded", "completed"],
      liq: 1000,
      bal_txs: 0,
    });
  });

  test("reverses a stripe gift: npo debited, dist and donation refunded", async () => {
    const { id, npo_id } = await seed("stripe:card");

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      alert_from: "charge-refunded",
      notice,
    });

    expect(res).toMatchObject({ status: "reversed", applied: 1 });
    expect(await state(id, npo_id)).toEqual({
      don: "refunded",
      dist: ["refunded", "completed"],
      liq: 900,
      bal_txs: 1,
    });
  });
});

describe("reverse_charge — a gift through a form, to a program", () => {
  test("takes the gift off the form's and the program's totals", async () => {
    const { id, npo_id } = await seed("stripe:card");
    const db = test_db.current!.db;
    await db.insert(forms).values({
      id: "form-1",
      name: "Form",
      owner_npo_id: npo_id,
      status: "active",
      date_created: "2026-07-01T00:00:00.000Z",
      ltd: 100,
      ltd_count: 1,
    });
    await db.insert(programs).values({
      id: "prog-1",
      npo_id,
      title: "Wells",
      description_pt: "[]",
      total_donations: 100,
    });
    await db
      .update(donations)
      .set({ form_id: "form-1", program_id: "prog-1", program_name: "Wells" })
      .where(eq(donations.id, id));

    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      alert_from: "charge-refunded",
      notice,
    });

    const [form] = await db.select().from(forms);
    expect([form!.ltd, form!.ltd_count]).toEqual([0, 0]);
    const [prog] = await db.select().from(programs);
    expect(prog!.total_donations).toBe(0);
  });
});

describe("reverse_charge — a gift named by its v1 id", () => {
  test("reverses the gift that id loads", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await test_db
      .current!.db.update(donations)
      .set({ id_v1: `v1-${id}` })
      .where(eq(donations.id, id));

    const res = await reverse_charge({
      donation_id: `v1-${id}`,
      rail: "stripe",
      source: "refund",
      share: whole,
      alert_from: "charge-refunded",
      notice,
    });

    expect(res).toMatchObject({ status: "reversed", applied: 1 });
    expect(await state(id, npo_id)).toEqual({
      don: "refunded",
      dist: ["refunded", "completed"],
      liq: 900,
      bal_txs: 1,
    });
  });
});

describe("reverse_charge — every refundable rail", () => {
  test.each([
    ["stripe", "stripe:us_bank_account", "refund"],
    ["stripe", "stripe:card", "dispute"],
    ["stripe", "stripe:card", "admin"],
    ["paypal", "paypal", "refund"],
    ["paypal", "paypal", "dispute"],
    ["crypto", "crypto:eth", "refund"],
  ] as const)(
    "a full %s reversal (%s, %s) lands as a full refund does",
    async (rail, via, source) => {
      const { id, npo_id } = await seed(via);

      const res = await reverse_charge({
        donation_id: id,
        rail,
        source,
        share: whole,
        alert_from: "test",
        notice,
      });

      expect(res).toMatchObject({ status: "reversed", applied: 1 });
      expect(await state(id, npo_id)).toEqual({
        don: "refunded",
        dist: ["refunded", "completed"],
        liq: 900,
        bal_txs: 1,
      });
    }
  );
});

/** `seed`'s gift reshaped into the ticket's $100 card gift: $90 net, a $3.20
 * card fee and $6.80 of bg fees, its whole net granted in a payout already paid */
async function grant_paid(id: string, npo_id: number) {
  const db = test_db.current!.db;
  await db
    .update(dists)
    .set({
      net: 90,
      fee_base: 4.3,
      fee_fsa: 2.5,
      fee_processing: 3.2,
      alloc: { liq: 0, lock: 0, cash: 100 },
    })
    .where(eq(dists.donation_id, id));
  await db.insert(payouts).values({
    id: `payout-${id}`,
    source_id: `dist-${id}`,
    npo_id,
    source: "donation",
    date: "2026-07-01T00:00:00.000Z",
    amount: 90,
    type: "settled",
    settled_date: "2026-07-02T00:00:00.000Z",
  });
}

// read through the module's own query, gift by gift
const owed_rows = async () => {
  const db = test_db.current!.db as unknown as DbOrTx;
  const gifts = await test_db
    .current!.db.select({ id: donations.id })
    .from(donations);
  return (
    await Promise.all(gifts.map((g) => owed_for_donation(g.id, db)))
  ).flat();
};

describe("reverse_charge — a gift whose grant was already paid", () => {
  test.each([
    ["card", "stripe", "stripe:card"],
    ["ACH", "stripe", "stripe:us_bank_account"],
    ["PayPal", "paypal", "paypal"],
    ["crypto", "crypto", "crypto:eth"],
  ] as const)(
    "%s: a refund records what the npo owes, not a platform loss",
    async (_, rail, via) => {
      const { id, npo_id } = await seed(via);
      await grant_paid(id, npo_id);

      const res = await reverse_charge({
        donation_id: id,
        rail,
        source: "refund",
        share: whole,
        alert_from: "test",
        notice,
      });

      expect(res).toMatchObject({ status: "reversed", applied: 1 });
      expect(await owed_rows()).toEqual([
        expect.objectContaining({
          donation_id: id,
          npo_id,
          source: "refund",
          source_ref: "evt_1",
          received_usd: 90,
          fee_processing_usd: 3.2,
          fee_dispute_usd: 0,
          outstanding_usd: 93.2,
        }),
      ]);
      expect(await test_db.current!.db.select().from(loss_logs)).toEqual([]);
    }
  );

  test.each([
    ["dispute", "dispute"],
    ["admin", "refund"],
  ] as const)(
    "a reversal from %s is recorded as a %s",
    async (source, recorded) => {
      const { id, npo_id } = await seed("stripe:card");
      await grant_paid(id, npo_id);

      await reverse_charge({
        donation_id: id,
        rail: "stripe",
        source,
        share: whole,
        alert_from: "test",
        notice,
      });

      const [owed] = await owed_rows();
      expect(owed).toMatchObject({ source: recorded, source_ref: "evt_1" });
    }
  );

  test("a reversal naming the provider's refund records it as the source, not the event", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);

    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      source_ref: "re_1",
      alert_from: "test",
      notice,
    });

    const [owed] = await owed_rows();
    expect(owed).toMatchObject({ source: "refund", source_ref: "re_1" });
  });

  test("a gift whose payout is still pending cancels it and owes nothing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    const db = test_db.current!.db;
    await db
      .update(payouts)
      .set({ type: "pending", settled_date: null })
      .where(eq(payouts.id, `payout-${id}`));
    await db.update(npos).set({ cash: 90 }).where(eq(npos.id, npo_id));

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      alert_from: "test",
      notice,
    });

    expect(res).toMatchObject({ status: "reversed", has_loss: false });
    const [po] = await db.select().from(payouts);
    expect(po!.type).toBe("refunded");
    expect(await owed_rows()).toEqual([]);
  });
});

describe("reverse_charge — a redelivery", () => {
  test.each(["refunded", "refunded_loss"])(
    "on a %s gift reverses nothing",
    async (status) => {
      const { id, npo_id } = await seed("stripe:card");
      await test_db
        .current!.db.update(donations)
        .set({ status })
        .where(eq(donations.id, id));

      const res = await reverse_charge({
        donation_id: id,
        rail: "stripe",
        source: "refund",
        share: whole,
        alert_from: "charge-refunded",
        notice,
      });

      expect(res).toEqual({
        status: "already_reversed",
        donation_status: status,
      });
      expect(await state(id, npo_id)).toEqual({
        don: status,
        dist: ["settled", null],
        liq: 1000,
        bal_txs: 0,
      });
      expect(enqueue).not.toHaveBeenCalled();
      expect(fiat_alert).not.toHaveBeenCalled();
    }
  );
});

describe("reverse_charge — part of the charge, its grant paid", () => {
  /** a refund of `own` of the gift's $100 */
  const part = (id: string, own: number, ref = `re_${own}`) =>
    reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: { taken: own, of: 100 },
      source_ref: ref,
      alert_from: "charge-refunded",
      notice: { id: `evt_${ref}`, lines: [`donation ${id}`] },
    });

  test("$40 of $100 records its share of what the npo received plus its card fee, and reverses nothing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);

    const res = await part(id, 40, "re_1");

    expect(res.status).toBe("partial_owed");
    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        npo_id,
        source: "refund",
        source_ref: "re_1",
        received_usd: 36,
        fee_processing_usd: 1.28,
        outstanding_usd: 37.28,
      }),
    ]);
    const [don] = await test_db
      .current!.db.select()
      .from(donations)
      .where(eq(donations.id, id));
    expect(don!.status).toBe("settled");
  });

  test("the $60 that completes the charge reverses the gift and leaves the row at the full figure, with no hand adjustment to undo", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    await part(id, 40, "re_1");

    const res = await part(id, 60, "re_2");

    expect(res).toMatchObject({ status: "reversed", applied: 1 });
    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        source_ref: "re_1",
        received_usd: 90,
        fee_processing_usd: 3.2,
        outstanding_usd: 93.2,
      }),
    ]);
    expect((await state(id, npo_id)).don).toBe("refunded_loss");
    const titles = enqueue.mock.calls
      .flat()
      .filter((m) => m.id === "fiat-notice")
      .map((m) => m.payload.alert.title);
    expect(titles).toEqual([
      expect.stringMatching(/^Partial refund recorded as owed · /),
    ]);
  });

  test("two refunds of $50 end as one full refund does", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);

    await part(id, 50, "re_1");
    const half = await owed_rows();
    expect(half).toEqual([
      expect.objectContaining({ received_usd: 45, fee_processing_usd: 1.6 }),
    ]);

    expect((await part(id, 50, "re_2")).status).toBe("reversed");

    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        id: half[0]!.id,
        received_usd: 90,
        fee_processing_usd: 3.2,
        outstanding_usd: 93.2,
      }),
    ]);
  });

  test("a redelivery of a $50 refund changes nothing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    await part(id, 50, "re_1");
    const half = await owed_rows();

    await part(id, 50, "re_1");

    expect(await owed_rows()).toEqual(half);
  });

  test("a redelivery of either $50 refund, once the charge is reversed, changes nothing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    await part(id, 50, "re_1");
    await part(id, 50, "re_2");
    const full = await owed_rows();

    expect(await part(id, 50, "re_1")).toEqual({
      status: "already_reversed",
      donation_status: "refunded_loss",
    });
    expect(await part(id, 50, "re_2")).toMatchObject({
      status: "already_reversed",
    });

    expect(await owed_rows()).toEqual(full);
  });

  test("a lost dispute over $30 owes its share plus the dispute fee in full, and reverses nothing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: { taken: 30, of: 100 },
      dispute_fee_usd: 15,
      source_ref: "du_1",
      alert_from: "charge-dispute",
      notice: { id: "evt_lost", lines: [] },
    });

    expect(res.status).toBe("partial_owed");
    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        source: "dispute",
        source_ref: "du_1",
        received_usd: 27,
        fee_processing_usd: 0.96,
        fee_dispute_usd: 15,
        outstanding_usd: 42.96,
      }),
    ]);
    expect((await state(id, npo_id)).don).toBe("settled");
  });

  test.each([
    ["the commission run that pays it", "hook"],
    ["the refund's redelivery", "redelivery"],
  ] as const)(
    "a commission pending at the refund owes its share once paid, recorded by %s",
    async (_, by) => {
      const { id, npo_id } = await seed("stripe:card");
      await grant_paid(id, npo_id);
      const db = test_db.current!.db;
      await db
        .update(npos)
        .set({ referral_id: "NPO-REF" })
        .where(eq(npos.id, npo_id));
      await db.insert(referrer_commissions).values({
        referrer_npo: "NPO-REF",
        date: "2026-07-01T00:00:00.000Z",
        donation_id: `dist-${id}`,
        npo_id,
        amount: 5,
        status: "pending",
      });
      const referrer_row = async () =>
        (await owed_rows()).find((o) => o.referrer_npo === "NPO-REF");
      await part(id, 40, "re_1");
      expect(await referrer_row()).toBeUndefined();

      await db
        .update(referrer_commissions)
        .set({ status: "paid", ref: "ref-1" })
        .where(eq(referrer_commissions.donation_id, `dist-${id}`));
      if (by === "hook") await owe_takes_of_dists([`dist-${id}`]);
      else await part(id, 40, "re_1");

      expect(await referrer_row()).toMatchObject({ outstanding_usd: 2 });
    }
  );

  test("a commission claimed for a transfer owes its share, which stays once the transfer pays and the refund is redelivered", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ referral_id: "NPO-REF" })
      .where(eq(npos.id, npo_id));
    await db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-07-01T00:00:00.000Z",
      donation_id: `dist-${id}`,
      npo_id,
      amount: 5,
      status: "processing",
      ref: "ref-1",
    });
    const referrer_row = async () =>
      (await owed_rows()).find((o) => o.referrer_npo === "NPO-REF");

    await part(id, 40, "re_1");
    expect(await referrer_row()).toMatchObject({ outstanding_usd: 2 });

    await commissions_mark_paid(db as never, "ref-1");
    await part(id, 40, "re_1");

    expect(await referrer_row()).toMatchObject({
      received_usd: 2,
      outstanding_usd: 2,
    });
  });

  test("a paid commission owes the same share, and the whole once the rest is refunded", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ referral_id: "NPO-REF" })
      .where(eq(npos.id, npo_id));
    await db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-07-01T00:00:00.000Z",
      donation_id: `dist-${id}`,
      npo_id,
      amount: 5,
      status: "paid",
      ref: "ref-1",
    });
    const referrer_row = async () =>
      (await owed_rows()).find((o) => o.referrer_npo === "NPO-REF");

    await part(id, 40, "re_1");
    expect(await referrer_row()).toMatchObject({
      received_usd: 2,
      outstanding_usd: 2,
    });

    await part(id, 60, "re_2");
    expect(await referrer_row()).toMatchObject({
      received_usd: 5,
      outstanding_usd: 5,
    });
  });
});

describe("reverse_charge — a whole lost dispute, its grant paid", () => {
  const OPENED = "2026-07-03T00:00:00.000Z";
  const lost = (id: string) =>
    reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: whole,
      dispute_id: "du_1",
      dispute_fee_usd: 15,
      source_ref: "du_1",
      alert_from: "charge-dispute",
      notice: { id: "evt_lost", lines: [] },
    });
  const opened = (id: string) =>
    dispute_opened({
      donation_id: id,
      rail: "stripe",
      dispute_id: "du_1",
      opened_at: OPENED,
      disputed: whole,
      fee_usd: 15,
    });

  test("closed before its open, owes the dispute fee with the full figure, and the late open adds nothing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);

    expect((await lost(id)).status).toBe("reversed");
    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        received_usd: 90,
        fee_processing_usd: 3.2,
        fee_dispute_usd: 15,
        outstanding_usd: 108.2,
      }),
    ]);

    expect((await opened(id)).status).toBe("already_reversed");
    expect(await owed_rows()).toEqual([
      expect.objectContaining({ outstanding_usd: 108.2 }),
    ]);
  });

  test("redelivered after a run that reversed the gift and died before its fee, records the fee", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    await lost(id);
    // the row as such a run leaves it
    await test_db
      .current!.db.update(owed_amounts)
      .set({ fee_dispute_usd: 0 })
      .where(eq(owed_amounts.npo_id, npo_id));

    expect((await lost(id)).status).toBe("already_reversed");

    expect(await owed_rows()).toEqual([
      expect.objectContaining({ fee_dispute_usd: 15, outstanding_usd: 108.2 }),
    ]);
  });

  test("opened first, owes its fee once", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    await opened(id);

    expect((await lost(id)).status).toBe("reversed");

    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        fee_dispute_usd: 15,
        outstanding_usd: 108.2,
      }),
    ]);
  });
});

describe("owe_takes — dists settled after their gift's dispute opened", () => {
  /** `seed`'s gift split over two npos, its dists not yet settled, and a
   * dispute over $30 of each $100 with a $15 fee already open */
  async function opened_before_settling() {
    const { id, npo_id } = await seed("stripe:card");
    const db = test_db.current!.db;
    const [npo2] = await db
      .insert(npos)
      .values({
        registration_number: `EIN-REV-${id}-2`,
        name: "Second NPO",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      })
      .returning();
    const [first] = await db.delete(dists).returning();
    const second = {
      ...first!,
      id: `${first!.id}-2`,
      to_id: npo2!.id,
      to_name: npo2!.name,
    };
    await dispute_opened({
      donation_id: id,
      rail: "stripe",
      dispute_id: "du_1",
      opened_at: "2026-07-03T00:00:00.000Z",
      disputed: { taken: 30, of: 100 },
      fee_usd: 15,
    });
    const settle = async (d: typeof first) => {
      await db.insert(dists).values(d!);
      await db.transaction((tx) =>
        owe_takes(tx as unknown as DbOrTx, id, "2026-07-04T00:00:00.000Z")
      );
    };
    return { id, npo_ids: [npo_id, npo2!.id], settle, first, second };
  }
  const by_npo = async () =>
    (await owed_rows())
      .sort((a, b) => a.npo_id! - b.npo_id!)
      .map((o) => [o.received_usd, o.fee_dispute_usd, o.outstanding_usd]);

  test("owes each new dist's share once, its fee left to the dispute's next event", async () => {
    const { settle, first } = await opened_before_settling();
    expect(await owed_rows()).toEqual([]);

    await settle(first);
    await test_db.current!.db.transaction((tx) =>
      owe_takes(tx as unknown as DbOrTx, first!.donation_id, "2026-07-05")
    );

    expect(await by_npo()).toEqual([[30, 0, 30]]);
  });

  test("its loss then owes the fee split over every dist, never more than the fee", async () => {
    const { id, settle, first, second } = await opened_before_settling();
    await settle(first);
    await settle(second);

    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: { taken: 30, of: 100 },
      dispute_id: "du_1",
      dispute_fee_usd: 15,
      source_ref: "du_1",
      alert_from: "charge-dispute",
      notice: { id: "evt_lost", lines: [] },
    });

    expect(await by_npo()).toEqual([
      [30, 7.5, 37.5],
      [30, 7.5, 37.5],
    ]);
  });
});

describe("reverse_charge — a share the provider can't size", () => {
  const unsized = (id: string, share: { taken: number; of: number } | null) =>
    reverse_charge({
      donation_id: id,
      rail: "paypal",
      source: "refund",
      share,
      alert_from: "paypal-refund",
      notice: {
        id: "paypal-unsized_WH-1",
        amount: "$6.00",
        ids: ["charge c_1"],
        lines: ["Charge was 100.00 USD."],
      },
    });

  test.each([
    ["no share", null],
    ["an amount that isn't a number", { taken: Number.NaN, of: 100 }],
  ])(
    "%s reverses nothing and tells ops it couldn't be sized",
    async (_, share) => {
      const { id, npo_id } = await seed("paypal");
      await grant_paid(id, npo_id);

      expect(await unsized(id, share)).toEqual({ status: "unsized" });

      expect((await state(id, npo_id)).don).toBe("settled");
      expect(await owed_rows()).toEqual([]);
      const [m, ...rest] = enqueue.mock.calls.flat();
      expect(rest).toEqual([]);
      expect(m.payload.id).toBe("paypal-unsized_WH-1");
      expect(m.payload.alert.title).toMatch(
        /^Reversal not sized · \$6\.00 to /
      );
      expect(m.payload.alert.note).toBe("Charge was 100.00 USD.");
      expect(m.payload.alert.action.text).toMatch(
        /Could not read how much.*Settle it by hand\.$/
      );
      // the whole donation id, to look it up by
      expect(m.payload.alert.context).toEqual([`donation ${id} · charge c_1`]);
    }
  );

  test("on a reversed gift is acknowledged, with no notice", async () => {
    const { id } = await seed("paypal");
    await test_db
      .current!.db.update(donations)
      .set({ status: "refunded" })
      .where(eq(donations.id, id));

    expect(await unsized(id, null)).toEqual({
      status: "already_reversed",
      donation_status: "refunded",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("reverse_charge — part of the charge, its grant not yet out", () => {
  const notices = () =>
    enqueue.mock.calls
      .flat()
      .filter((m) => m.id === "fiat-notice")
      .map((m) => m.payload);

  test("a chargeback of part of a gift whose payout is pending owes its own share, as its dispute's filing would", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    await test_db
      .current!.db.update(payouts)
      .set({ type: "pending", settled_date: null })
      .where(eq(payouts.id, `payout-${id}`));

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: { taken: 40, of: 100 },
      alert_from: "charge-dispute",
      notice: { id: "evt_9", lines: [] },
    });

    expect(res).toMatchObject({ status: "partial_owed" });
    expect(await owed_rows()).toEqual([
      expect.objectContaining({ npo_id, outstanding_usd: 37.28 }),
    ]);
  });

  test("a refund of part of a gift whose payout is pending records nothing and tells ops a pending grant is why", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    await test_db
      .current!.db.update(payouts)
      .set({ type: "pending", settled_date: null })
      .where(eq(payouts.id, `payout-${id}`));
    await test_db
      .current!.db.update(donation_donors)
      .set({ name: "Jane Doe" })
      .where(eq(donation_donors.donation_id, id));

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: { taken: 40, of: 100 },
      alert_from: "charge-refunded",
      notice: {
        id: "evt_9",
        amount: "$40.00",
        ids: ["charge ch_1", "event evt_9"],
        lines: ["Refunds on this charge: 40.00 USD (re_1, succeeded)."],
      },
    });

    expect(res).toEqual({ status: "partial_pending", owed_msgs: [] });
    expect(await owed_rows()).toEqual([]);
    expect((await state(id, npo_id)).don).toBe("settled");
    const [n, ...rest] = notices();
    expect(rest).toEqual([]);
    expect(n.id).toBe("evt_9");
    const npo = `Test NPO ${counter}`;
    expect(n.alert).toMatchObject({
      title: `Partial refund not reversed · $40.00 to ${npo}`,
      summary: `Partial refund not reversed: $40.00 to ${npo}`,
      fields: [
        { name: "Nonprofit", value: `${npo} (#${npo_id})` },
        { name: "Donor", value: "Jane Doe" },
        { name: "Refunded", value: "$40.00" },
        { name: "Taken back", value: "40.00% of the charge" },
        { name: "Donated", value: expect.any(String) },
      ],
      action: { text: expect.stringMatching(/^Adjust these dists by hand/) },
      context: [`donation ${id} · charge ch_1 · event evt_9`],
    });
    expect(n.alert.table).toBeUndefined();
    expect(n.alert.note.split("\n")).toEqual([
      "The donation is not reversed.",
      expect.stringMatching(
        new RegExp(
          `^Not owed: dist dist-${id} to ${npo}.*grant payout is still pending`
        )
      ),
      expect.stringMatching(/^Undo that adjustment if a later refund/),
      "Refunds on this charge: 40.00 USD (re_1, succeeded).",
    ]);
  });
});

describe("reverse_charge — a reversal that can't finish", () => {
  test("a gift not distributed yet reverses nothing and stays settled for a redelivery", async () => {
    const { id } = await seed("paypal");
    await test_db.current!.db.delete(dists).where(eq(dists.donation_id, id));

    const res = await reverse_charge({
      donation_id: id,
      rail: "paypal",
      source: "refund",
      share: whole,
      alert_from: "paypal-refund",
      notice,
    });

    expect(res).toEqual({ status: "failed", reason: "not_distributed" });
    const [don] = await test_db
      .current!.db.select()
      .from(donations)
      .where(eq(donations.id, id));
    expect(don!.status).toBe("settled");
  });

  test("a dist that fails to reverse leaves the gift settled and names the failure", async () => {
    const { id, npo_id } = await seed("crypto:eth");
    // no npo behind it: the strict plan load throws, so this dist fails
    await test_db.current!.db.insert(dists).values({
      id: `dist-${id}-orphan`,
      donation_id: id,
      status: "settled",
      date_created: "2026-07-01T00:00:00.000Z",
      to_id: null,
      amount_denom: "USD",
      net: 10,
      alloc: { liq: 100, lock: 0, cash: 0 },
    });

    const res = await reverse_charge({
      donation_id: id,
      rail: "crypto",
      source: "refund",
      share: whole,
      alert_from: "nowpayments-refunded",
      notice,
    });

    expect(res).toEqual({
      status: "failed",
      reason: "incomplete",
      dists: 2,
      applied: 1,
      failures: [`dist dist-${id}-orphan: npo:0 not found`],
    });
    const [don] = await test_db
      .current!.db.select()
      .from(donations)
      .where(eq(donations.id, id));
    expect(don!.status).toBe("settled");
    const [npo] = await test_db
      .current!.db.select()
      .from(npos)
      .where(eq(npos.id, npo_id));
    expect(npo!.liq).toBe(900);
  });
});

describe("reverse_charge — a gift on another rail", () => {
  test("reverses nothing", async () => {
    const { id, npo_id } = await seed("crypto:eth");

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "admin",
      share: whole,
      alert_from: "refund-action",
      notice,
    });

    expect(res).toEqual({ status: "failed", reason: "wrong_rail" });
    expect((await state(id, npo_id)).dist).toEqual(["settled", null]);
  });
});

describe("reverse_charge — a subscription payment", () => {
  async function seed_sub(npo_id: number) {
    await test_db.current!.db.insert(subscriptions).values({
      id: "sub_1",
      interval: "month",
      interval_count: 1,
      next_billing: "2026-08-01T00:00:00.000Z",
      amount: 100,
      amount_usd: 100,
      currency: "USD",
      product_id: "prod_1",
      to_npo_id: npo_id,
      to_name: "npo",
      platform: "stripe",
      status: "active",
      from_id: "donor@test.com",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    });
    invoice_sub.id = "sub_1";
  }
  const sub = async () =>
    (await test_db.current!.db.select().from(subscriptions))[0]!;
  const deactivated = () =>
    enqueue.mock.calls.flat().filter((m) => m.id === "sub-deactivated");

  test.each([
    ["stripe", "stripe:card", "refund", "inactive", 1],
    ["stripe", "stripe:card", "admin", "inactive", 1],
    // a lost dispute leaves it billing
    ["stripe", "stripe:card", "dispute", "active", 0],
    ["paypal", "paypal", "refund", "active", 0],
    ["paypal", "paypal", "dispute", "active", 0],
    ["crypto", "crypto:eth", "refund", "active", 0],
  ] as const)(
    "a full %s reversal (%s, %s) leaves the recurring gift %s",
    async (rail, via, source, status, queued) => {
      const { id, npo_id } = await seed(via);
      await seed_sub(npo_id);

      const res = await reverse_charge({
        donation_id: id,
        rail,
        source,
        share: whole,
        alert_from: "test",
        notice,
      });

      expect(res.status).toBe("reversed");
      expect((await sub()).status).toBe(status);
      expect(deactivated()).toHaveLength(queued);
    }
  );

  test("a stripe refund of a gift whose subscription already ended still reverses", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await seed_sub(npo_id);
    await test_db
      .current!.db.update(subscriptions)
      .set({ status: "inactive", status_cancel_reason: "user" });

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      alert_from: "charge-refunded",
      notice,
    });

    expect(res.status).toBe("reversed");
    expect((await state(id, npo_id)).don).toBe("refunded");
  });

  test("a billing stop that can't be queued reverses nothing, so a redelivery retries both", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await seed_sub(npo_id);
    enqueue.mockRejectedValueOnce(new Error("qstash 503"));
    const full = {
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      alert_from: "charge-refunded",
      notice,
    } as const;

    await expect(reverse_charge(full)).rejects.toThrow("qstash 503");
    expect((await state(id, npo_id)).dist).toEqual(["settled", null]);

    expect((await reverse_charge(full)).status).toBe("reversed");
    expect(deactivated()).toHaveLength(2);
  });

  test("a stripe refund whose reversal doesn't finish still stops the billing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await seed_sub(npo_id);
    await seed_orphan_dist(id);

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "admin",
      share: whole,
      alert_from: "refund-action",
      notice,
    });

    expect(res).toMatchObject({ status: "failed", reason: "incomplete" });
    expect((await sub()).status).toBe("inactive");
    expect(deactivated()).toHaveLength(1);
  });

  test("a full refund held on an unsent refund reverses nothing and still stops the billing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await seed_sub(npo_id);

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      unsent_refunds: ["re_2"],
      alert_from: "charge-refunded",
      notice,
    });

    expect(res).toEqual({ status: "held" });
    expect(await state(id, npo_id)).toEqual({
      don: "settled",
      dist: ["settled", null],
      liq: 1000,
      bal_txs: 0,
    });
    expect((await sub()).status).toBe("inactive");
  });

  test("part of the charge held on an unsent refund records nothing and leaves the billing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    await seed_sub(npo_id);

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: { taken: 40, of: 100 },
      unsent_refunds: ["re_1"],
      alert_from: "charge-refunded",
      notice,
    });

    expect(res).toEqual({ status: "held" });
    expect(await owed_rows()).toEqual([]);
    expect((await sub()).status).toBe("active");
  });

  test("a gift whose settlement isn't on record yet ends the billing of the payment intent named", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await seed_sub(npo_id);
    await test_db
      .current!.db.delete(donation_settlements)
      .where(eq(donation_settlements.donation_id, id));

    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "refund",
      share: whole,
      intent_id: "pi_1",
      alert_from: "charge-refunded",
      notice,
    });

    expect(vi.mocked(stripe.invoicePayments.list)).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: { payment_intent: "pi_1", type: "payment_intent" },
      })
    );
    expect((await sub()).status).toBe("inactive");
  });
});

describe("reverse_charge — the ops notice of a full reversal", () => {
  const queued = () =>
    enqueue.mock.calls
      .flat()
      .filter((m) => m.id === "fiat-notice")
      .map((m) => m.payload);

  test("a lost dispute reports the reversal", async () => {
    const { id } = await seed("stripe:card");

    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: whole,
      alert_from: "charge-dispute",
      notice,
    });

    const [n, ...rest] = queued();
    expect(rest).toEqual([]);
    expect(n.id).toBe("evt_1_0");
    expect(n.alert.title).toBe(
      `Dispute lost, donation reversed · Test NPO ${counter}`
    );
    expect(n.alert.note.split("\n")).toEqual([
      "All 1 dists reversed.",
      ...notice.lines,
    ]);
  });

  test("a lost dispute that doesn't finish reports what failed", async () => {
    const { id } = await seed("stripe:card");
    await seed_orphan_dist(id);

    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: whole,
      alert_from: "charge-dispute",
      notice,
    });

    const [n] = queued();
    expect(n.id).toBe("evt_1_1");
    expect(n.alert.title).toMatch(
      /^Dispute lost, reversal did not complete · /
    );
    expect(n.alert.note.split("\n")[0]).toBe(
      "1 of 2 dists failed to reverse, and the donation stays settled."
    );
  });

  test("a lost dispute on a paid grant says what the npo owes", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);

    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: whole,
      alert_from: "charge-dispute",
      notice,
    });

    const [n] = queued();
    expect(n.alert.table.rows).toEqual([
      [`Test NPO ${counter} (#${npo_id})`, "90.00", "3.20", "0.00", "93.20"],
      ["Total", "—", "—", "—", "93.20"],
    ]);
  });

  test("a lost dispute's table includes the dispute fee written after the reversal", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);

    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: whole,
      dispute_fee_usd: 15,
      source_ref: "du_1",
      alert_from: "charge-dispute",
      notice,
    });

    const [n] = queued();
    expect(n.alert.table.rows).toEqual([
      [`Test NPO ${counter} (#${npo_id})`, "90.00", "3.20", "15.00", "108.20"],
      ["Total", "—", "—", "—", "108.20"],
    ]);
  });

  test("a lost dispute still alerts, from the rows it already holds, when the fresh read fails", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    owed_read.fail = true;
    report_error.mockClear();

    try {
      const res = await reverse_charge({
        donation_id: id,
        rail: "stripe",
        source: "dispute",
        share: whole,
        source_ref: "du_1",
        alert_from: "charge-dispute",
        notice,
      });
      expect(res.status).toBe("reversed");
    } finally {
      owed_read.fail = false;
    }

    const [n] = queued();
    expect(n.alert.table.rows.at(-1)).toEqual([
      "Total",
      "—",
      "—",
      "—",
      "93.20",
    ]);
    expect(report_error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "owed read failed" }),
      expect.objectContaining({ donation_id: id })
    );
  });

  test("a lost dispute whose notice can't be queued is reported, and the reversal stands", async () => {
    const { id } = await seed("stripe:card");
    enqueue.mockRejectedValueOnce(new Error("qstash 503"));
    report_error.mockClear();

    const res = await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: whole,
      alert_from: "charge-dispute",
      notice,
    });

    expect(res.status).toBe("reversed");
    expect(report_error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "qstash 503" }),
      expect.objectContaining({ donation_id: id })
    );
  });

  test("a full refund queues no notice of its own", async () => {
    const { id } = await seed("paypal");

    const res = await reverse_charge({
      donation_id: id,
      rail: "paypal",
      source: "refund",
      share: whole,
      alert_from: "paypal-refund",
      notice,
    });

    expect(res.status).toBe("reversed");
    expect(queued()).toEqual([]);
  });
});

describe("has_settled_dists — whether a reversal has anything to take back", () => {
  test("a distributed gift has", async () => {
    const { id } = await seed("stripe:card");

    expect(await has_settled_dists(id)).toBe(true);
  });

  test("a gift not distributed yet hasn't", async () => {
    const { id } = await seed("stripe:card");
    await test_db.current!.db.delete(dists).where(eq(dists.donation_id, id));

    expect(await has_settled_dists(id)).toBe(false);
  });
});

describe("reversal_preview — what an admin refund would reverse", () => {
  test("lists a settled gift's dists in usd with what reversing each does", async () => {
    const { id, npo_id } = await seed("stripe:card");
    const don = (await donation_get(id))!;

    const preview = await reversal_preview(don, null);

    expect(preview).toEqual({
      dists: [
        {
          id: `dist-${id}`,
          npo_id,
          npo_name: `Test NPO ${counter}`,
          amount: 100,
          net: 100,
          refund_status: null,
          refund_error: null,
          owed: 0,
          effects: [
            expect.objectContaining({ label: "Savings balance", pass: true }),
          ],
          blockers: [],
          warnings: [],
        },
      ],
    });
    // a preview writes nothing
    expect((await state(id, npo_id)).dist).toEqual(["settled", null]);
  });

  test("a paid grant previews what its npo would owe, not a platform loss", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await grant_paid(id, npo_id);
    const don = (await donation_get(id))!;

    const preview = await reversal_preview(don, null);

    expect(preview.dists).toEqual([
      expect.objectContaining({ npo_id, amount: 100, net: 90, owed: 93.2 }),
    ]);
    expect(await owed_rows()).toEqual([]);
  });

  test("a paid commission previews as recovered from the referrer's next commission, not owed by the npo", async () => {
    const { id, npo_id } = await seed("stripe:card");
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ referral_id: "NPO-REF" })
      .where(eq(npos.id, npo_id));
    await db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-07-01T00:00:00.000Z",
      donation_id: `dist-${id}`,
      npo_id,
      amount: 5,
      status: "paid",
      ref: "ref-1",
    });
    const don = (await donation_get(id))!;

    const preview = await reversal_preview(don, null);

    expect(preview.dists).toEqual([
      expect.objectContaining({
        owed: 0,
        warnings: [
          {
            label: "Commission",
            pass: false,
            reason:
              "$5.00 was already paid to its referrer, so it will be recovered from the referrer's next commission",
          },
        ],
      }),
    ]);
    expect(await owed_rows()).toEqual([]);
  });

  test("lists nothing for a gift not distributed yet", async () => {
    const { id } = await seed("stripe:card");
    await test_db.current!.db.delete(dists).where(eq(dists.donation_id, id));
    const don = (await donation_get(id))!;

    expect(await reversal_preview(don, null)).toEqual({ dists: [] });
  });
});

/** the whole charge back, as the provider's refund `re_1` */
const refund_whole = (id: string) =>
  reverse_charge({
    donation_id: id,
    rail: "stripe",
    source: "refund",
    share: whole,
    source_ref: "re_1",
    alert_from: "test",
    notice,
  });

const as_db = (x: unknown) => x as DbOrTx;
const dons = () => test_db.current!.db.select().from(donations);
const match_events = () =>
  test_db.current!.db.select().from(donation_match_events);

describe("reverse_charge — the match event a reversal voids", () => {
  const FILED = "2026-07-02T00:00:00.000Z";

  /** the donor's claim workflow on `id`, named so the heads-up has someone to
   * report; `submitted_at` set means the donor had already filed */
  async function with_match_event(id: string, filed: boolean) {
    const db = test_db.current!.db;
    await db
      .update(donation_donors)
      .set({ name: "Ada Lovelace", company_name: "Acme Inc" })
      .where(eq(donation_donors.donation_id, id));
    await db.insert(donation_match_events).values({
      id: `evt-${id}`,
      donation_id: id,
      pack_sent_at: "2026-07-01T00:00:00.000Z",
      ...(filed && { submitted_at: FILED }),
    });
  }

  test("a reversal stamps the void alongside the status flip", async () => {
    const { id } = await seed("stripe:card");
    await with_match_event(id, false);

    await refund_whole(id);

    expect((await dons())[0]!.status).toBe("refunded");
    const [ev] = await match_events();
    expect(ev!.voided_at).not.toBeNull();
    expect(ev!.void_reason).toBe("refunded");
  });

  test("a donation that never entered the workflow still flips", async () => {
    const { id } = await seed("stripe:card");

    await refund_whole(id);

    expect((await dons())[0]!.status).toBe("refunded");
    expect(await match_events()).toHaveLength(0);
  });

  test("mails the team when the donor had already filed", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await with_match_event(id, true);

    await refund_whole(id);

    expect(send_email).toHaveBeenCalledTimes(1);
    const sent = send_email.mock.calls[0]![0];
    // internal only: the beneficiary has nothing to answer, and the donor asked
    // for their own money back
    expect(sent.to).toEqual(["hi@better.giving"]);
    const [npo] = await test_db
      .current!.db.select()
      .from(npos)
      .where(eq(npos.id, npo_id));
    const data = sent.node.props;
    expect(data.employer_name).toBe("Acme Inc");
    expect(data.donor_email).toBe("donor@test.com");
    expect(data.to_name).toBe(npo!.name);
    expect(data.filed_at).toBe(FILED);
    expect(data.void_reason).toBe("refunded");
  });

  test("says nothing when the claim was never filed", async () => {
    // the pack went out and the donor never came back — there is no claim
    // outstanding anywhere, so a refund is unremarkable
    const { id } = await seed("stripe:card");
    await with_match_event(id, false);

    await refund_whole(id);

    expect(send_email).not.toHaveBeenCalled();
  });

  test("says nothing when there is no event at all", async () => {
    const { id } = await seed("stripe:card");

    await refund_whole(id);

    expect(send_email).not.toHaveBeenCalled();
  });

  test("a refused send is reported and does not fail the refund", async () => {
    const { id } = await seed("stripe:card");
    await with_match_event(id, true);
    // send_email swallows provider errors into its return
    send_email.mockResolvedValue({ data: null, error: new Error("550") });

    const res = await refund_whole(id);

    expect(res).toMatchObject({ status: "reversed" });
    expect(report_error).toHaveBeenCalled();
    // the money is already back; a missing notice is not a failed refund
    expect((await dons())[0]!.status).toBe("refunded");
  });

  test("a throwing send does not fail the refund either", async () => {
    const { id } = await seed("stripe:card");
    await with_match_event(id, true);
    send_email.mockRejectedValue(new Error("connection reset"));

    expect(await refund_whole(id)).toMatchObject({ status: "reversed" });
    expect((await dons())[0]!.status).toBe("refunded");
  });
});

/** `seed`'s gift reshaped to one cash dist of $100 net whose whole grant is a
 * payout of `type`; `gift` is the pledge, which the settled USD can differ from */
async function cash_grant(
  id: string,
  npo_id: number,
  type: "pending" | "processing" | "settled",
  gift: { amount: number; amount_usd: number | null; denom: string } = {
    amount: 100,
    amount_usd: 100,
    denom: "USD",
  }
) {
  const db = test_db.current!.db;
  await db.update(npos).set({ cash: 100 }).where(eq(npos.id, npo_id));
  await db
    .update(dists)
    .set({
      to_name: "npo",
      amount: gift.amount,
      amount_usd: gift.amount_usd,
      amount_denom: gift.denom,
      alloc: { liq: 0, lock: 0, cash: 100 },
    })
    .where(eq(dists.donation_id, id));
  await db.insert(payouts).values({
    id: `payout-${id}`,
    source_id: `dist-${id}`,
    npo_id,
    source: "donation",
    date: "2026-07-01T00:00:00.000Z",
    amount: 100,
    type,
    ...(type === "settled" && { settled_date: "2026-07-02T00:00:00.000Z" }),
  });
}

describe("reverse_charge — a refused owed alert", () => {
  test("is reported, not thrown: the reversal stands and the delivery succeeds", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await cash_grant(id, npo_id, "settled");
    fiat_alert.mockRejectedValueOnce(new Error("slack 429"));
    report_error.mockClear();

    const res = await refund_whole(id);

    expect(res.status).toBe("reversed");
    expect(report_error).toHaveBeenCalledWith(
      expect.objectContaining({ message: "slack 429" }),
      expect.objectContaining({ donation_id: id })
    );
  });
});

describe("reverse_charge — a payout settled before the refund", () => {
  test("the ops notice says the amount was recorded as owed by the npo", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await cash_grant(id, npo_id, "settled");
    await test_db
      .current!.db.update(donation_donors)
      .set({ name: "Jane Doe" })
      .where(eq(donation_donors.donation_id, id));

    await refund_whole(id);

    const npo = `Test NPO ${counter}`;
    expect(fiat_alert).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: `Refund recorded as owed · ${npo}`,
        summary: `Refund recorded as owed: ${npo}`,
        fields: [
          expect.objectContaining({
            name: "Nonprofit",
            value: `${npo} (#${npo_id})`,
          }),
          { name: "Donor", value: "Jane Doe", inline: true },
          expect.objectContaining({ name: "Donated" }),
        ],
        table: expect.objectContaining({
          rows: [
            [`${npo} (#${npo_id})`, "100.00", "0.00", "0.00", "100.00"],
            ["Total", "—", "—", "—", "100.00"],
          ],
        }),
        note: expect.stringMatching(
          /^What's owed comes out of each party's next grants or commission\.\nnpo: /
        ),
        context: [
          expect.stringMatching(new RegExp(`^donation ${id} · refund `)),
        ],
      })
    );
  });

  test("a fund gift split across three npos whose grants were paid owes one row per npo", async () => {
    const { id, npo_id } = await seed("stripe:card");
    const db = test_db.current!.db;
    await db.delete(dists).where(eq(dists.donation_id, id));
    const others = await db
      .insert(npos)
      .values(
        [2, 3].map((n) => ({
          registration_number: `EIN-FUND-${n}`,
          name: `Fund NPO ${n}`,
          endow_designation: "Charity" as const,
          overview_pt: "[]",
          hq_country: "United States",
        }))
      )
      .returning();
    const members = [npo_id, ...others.map((o) => o.id)];
    for (const [i, to_id] of members.entries()) {
      await db.insert(dists).values({
        id: `dist-${i}`,
        donation_id: id,
        status: "settled",
        date_created: "2026-07-01T00:00:00.000Z",
        to_id,
        to_name: `npo ${i}`,
        amount: 50,
        amount_usd: 50,
        amount_denom: "USD",
        net: 45 + i,
        fee_base: 2,
        fee_fsa: 1,
        fee_processing: 1.5,
        alloc: { liq: 0, lock: 0, cash: 100 },
      });
      await db.insert(payouts).values({
        id: `payout-${i}`,
        source_id: `dist-${i}`,
        npo_id: to_id,
        source: "donation",
        date: "2026-07-01T00:00:00.000Z",
        amount: 45 + i,
        type: "settled",
        settled_date: "2026-07-02T00:00:00.000Z",
      });
    }

    const res = await refund_whole(id);

    expect(res).toMatchObject({ status: "reversed", applied: 3 });
    const rows = await owed_rows();
    expect(
      rows
        .map((r) => [r.npo_id, r.received_usd, r.fee_processing_usd])
        .sort((a, b) => a[0]! - b[0]!)
    ).toEqual([
      [members[0], 45, 1.5],
      [members[1], 46, 1.5],
      [members[2], 47, 1.5],
    ]);
  });

  // amount_usd is the pledge at the donation-time rate; the loss is what settled
  test("a non-USD gift refunded after its grant owes its settled USD and alerts it formatted", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await cash_grant(id, npo_id, "settled", {
      amount: 50_000,
      amount_usd: 333.33,
      denom: "JPY",
    });

    const res = await refund_whole(id);

    const [owed] = await owed_rows();
    expect(owed!.received_usd).toBe(100);
    expect(res).toMatchObject({
      status: "reversed",
      owed_msgs: [
        expect.stringContaining(
          `$100.00 recorded as owed by npo (npo ${npo_id})`
        ),
      ],
    });
  });

  test("a legacy dist with no USD amount owes its net", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await cash_grant(id, npo_id, "settled", {
      amount: 110,
      amount_usd: null,
      denom: "USD",
    });

    await refund_whole(id);

    const [owed] = await owed_rows();
    expect(owed!.outstanding_usd).toBe(100);
  });
});

describe("reverse_charge — a gift's referral commission", () => {
  /** `seed`'s dist earned `commission` for the npo's referrer */
  async function referred(
    id: string,
    npo_id: number,
    commission: {
      status: "pending" | "processing" | "paid";
      ref: string | null;
    }
  ) {
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ referral_id: "NPO-REF" })
      .where(eq(npos.id, npo_id));
    await db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-07-01T00:00:00.000Z",
      donation_id: `dist-${id}`,
      npo_id,
      amount: 5,
      ...commission,
    });
  }

  const ref_user = () =>
    test_db.current!.db.insert(user).values({
      id: "u-ref",
      name: "Ref User",
      email: "ref@test.com",
      first_name: "Ref",
      last_name: "User",
      referral_code: "REF-USER",
    });

  // pairs with the paid case below: the same read, no row
  test("an unpaid commission is reversed and its referrer owes nothing", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await referred(id, npo_id, { status: "pending", ref: null });

    const res = await refund_whole(id);

    expect(res).toMatchObject({ status: "reversed" });
    const [comm] = await test_db
      .current!.db.select()
      .from(referrer_commissions);
    expect(comm!.status).toBe("refunded");
    expect(await owed_rows()).toEqual([]);
    expect(fiat_alert).not.toHaveBeenCalled();
  });

  test("a user referrer's paid commission is owed by that user, not the gift's nonprofit", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await referred(id, npo_id, { status: "paid", ref: "ref-1" });
    await ref_user();
    await test_db
      .current!.db.update(referrer_commissions)
      .set({ referrer_npo: null, referrer_user: "REF-USER" })
      .where(eq(referrer_commissions.donation_id, `dist-${id}`));

    await refund_whole(id);

    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        donation_id: id,
        npo_id: null,
        referrer_user: "REF-USER",
        referrer_npo: null,
        received_usd: 5,
      }),
    ]);
  });

  test("a commission already paid to its referrer stays paid and is recorded as owed by the referrer", async () => {
    const { id, npo_id } = await seed("stripe:card");
    await referred(id, npo_id, { status: "paid", ref: "ref-1" });

    const res = await refund_whole(id);

    expect(res).toMatchObject({ status: "reversed" });
    const db = test_db.current!.db;
    const [comm] = await db.select().from(referrer_commissions);
    expect(comm!.status).toBe("paid");
    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        donation_id: id,
        npo_id: null,
        referrer_user: null,
        referrer_npo: "NPO-REF",
        source: "refund",
        source_ref: "re_1",
        received_usd: 5,
        fee_processing_usd: 0,
        outstanding_usd: 5,
      }),
    ]);
    const [dist] = await db.select().from(dists);
    expect(dist!.refund_status).toBe("completed");
    expect((await dons())[0]!.status).toBe("refunded");
    expect(fiat_alert).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: expect.stringMatching(/^Refund recorded as owed · /),
        table: expect.objectContaining({
          rows: [
            [
              expect.stringMatching(/\(referrer\)$/),
              "5.00",
              "0.00",
              "0.00",
              "5.00",
            ],
            ["Total", "—", "—", "—", "5.00"],
          ],
        }),
      })
    );
    expect(alert_text(fiat_alert.mock.calls[0]![0])).not.toContain("loss");
  });

  // one row per gift per party, so the row carries the gift's whole figure
  test("a fund gift whose two nonprofits share a referrer owes that referrer both paid commissions in one row", async () => {
    const { id, npo_id } = await seed("stripe:card");
    const db = test_db.current!.db;
    await db.delete(dists).where(eq(dists.donation_id, id));
    const [other] = await db
      .insert(npos)
      .values({
        registration_number: "EIN-FUND-2",
        name: "Fund NPO 2",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      })
      .returning();
    await ref_user();
    for (const [i, to_id] of [npo_id, other!.id].entries()) {
      await db.update(npos).set({ liq: 100 }).where(eq(npos.id, to_id));
      await db.insert(dists).values({
        id: `dist-${i}`,
        donation_id: id,
        status: "settled",
        date_created: "2026-07-01T00:00:00.000Z",
        to_id,
        to_name: `npo ${i}`,
        amount: 50,
        amount_denom: "USD",
        net: 50,
        fee_base: 0,
        fee_fsa: 0,
        fee_processing: 0,
        alloc: { liq: 100, lock: 0, cash: 0 },
      });
      await db.insert(referrer_commissions).values({
        referrer_user: "REF-USER",
        date: "2026-07-01T00:00:00.000Z",
        donation_id: `dist-${i}`,
        npo_id: to_id,
        amount: [5, 3][i]!,
        status: "paid",
        ref: "ref-1",
      });
    }

    const res = await refund_whole(id);

    expect(res).toMatchObject({
      status: "reversed",
      owed_msgs: [
        "$5.00 commission dist-0 recorded as owed by referrer REF-USER, to recover from its next commission; the gift's row for that referrer totals $5.00",
        "$3.00 commission dist-1 recorded as owed by referrer REF-USER, to recover from its next commission; the gift's row for that referrer totals $8.00",
      ],
    });
    expect(await owed_rows()).toEqual([
      expect.objectContaining({
        donation_id: id,
        referrer_user: "REF-USER",
        received_usd: 8,
        outstanding_usd: 8,
      }),
    ]);
  });
});

describe("reverse_unfunded_payout_loss — a refund owed while its payout was in flight, whose transfer went unfunded", () => {
  /** `seed`'s $100 dist, `alloc` split, refunded while its payout is in a
   * transfer, so the npo owes it; that transfer then goes unfunded */
  async function refund_in_flight(o: {
    alloc: { liq: number; lock: number; cash: number };
    bal: { liq: number; lock_units?: number };
    fee_processing?: number;
    /** a dispute opened with this fee ahead of its loss reversing the gift */
    dispute_fee?: number;
  }) {
    const { id, npo_id } = await seed("stripe:card");
    const db = test_db.current!.db;
    const cash = o.alloc.cash;
    await db
      .update(npos)
      .set({ ...o.bal, cash })
      .where(eq(npos.id, npo_id));
    await db
      .update(dists)
      .set({ fee_processing: o.fee_processing ?? 0, alloc: o.alloc })
      .where(eq(dists.donation_id, id));
    await db.insert(payouts).values({
      id: "payout-1",
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: "2026-07-01T00:00:00.000Z",
      amount: cash,
      type: "processing",
    });
    if (o.dispute_fee === undefined) {
      await refund_whole(id);
      return { id, npo_id };
    }
    await dispute_opened({
      donation_id: id,
      rail: "stripe",
      dispute_id: "du_1",
      opened_at: "2026-07-02T00:00:00.000Z",
      disputed: whole,
      fee_usd: o.dispute_fee,
    });
    await reverse_charge({
      donation_id: id,
      rail: "stripe",
      source: "dispute",
      share: whole,
      dispute_id: "du_1",
      dispute_fee_usd: o.dispute_fee,
      source_ref: "du_1",
      alert_from: "test",
      notice,
    });
    return { id, npo_id };
  }

  const unfund = () =>
    test_db.current!.db.transaction((tx) =>
      reverse_unfunded_payout_loss(as_db(tx), "payout-1")
    );

  // the order `dists_locked` in ./share documents: a refund-failed credit
  // holds the donation while it waits on the dist
  test("locks the donation, then its dist, payout and npo", async () => {
    await refund_in_flight({
      alloc: { liq: 0, lock: 0, cash: 100 },
      bal: { liq: 0 },
    });
    const { db, queries } = logged_db(test_db.current!);

    const r = await db.transaction((tx) =>
      reverse_unfunded_payout_loss(as_db(tx), "payout-1")
    );

    expect(r).toEqual({ status: "reversed" });
    expect(
      lock_order(queries, ["donations", "dists", "payouts", "npos"])
    ).toEqual(["donations", "dists", "payouts", "npos"]);
  });

  test("clears what the npo owed: credited back, outstanding $0, refunded as if the payout had been pending", async () => {
    const { id, npo_id } = await refund_in_flight({
      alloc: { liq: 0, lock: 0, cash: 100 },
      bal: { liq: 0 },
      fee_processing: 3.2,
    });
    const [recorded] = await owed_rows();
    expect(recorded).toMatchObject({ outstanding_usd: 103.2 });

    expect(await unfund()).toEqual({ status: "reversed" });

    const [owed] = await owed_rows();
    expect(owed).toMatchObject({
      credited_back_usd: 103.2,
      outstanding_usd: 0,
    });
    expect(owed!.credited_back_at).not.toBeNull();
    const db = test_db.current!.db;
    const [po] = await db.select().from(payouts);
    expect(po!.type).toBe("refunded");
    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo!.cash).toBe(0);
    const [dist] = await db.select().from(dists);
    expect(dist!.refund_status).toBe("completed");
    const [don] = await dons();
    expect([don!.id, don!.status]).toEqual([id, "refunded"]);
  });

  test("a dispute's loss credits back only what the npo received, its card and dispute fees still owed", async () => {
    await refund_in_flight({
      alloc: { liq: 0, lock: 0, cash: 100 },
      bal: { liq: 0 },
      fee_processing: 3.2,
      dispute_fee: 15,
    });
    expect((await owed_rows())[0]).toMatchObject({ outstanding_usd: 118.2 });

    expect(await unfund()).toEqual({ status: "reversed" });

    const [owed] = await owed_rows();
    expect(owed).toMatchObject({
      credited_back_usd: 100,
      outstanding_usd: 18.2,
    });
  });

  test("a savings shortfall stays owed: the payout is cancelled, its cash taken back and credited", async () => {
    const { npo_id } = await refund_in_flight({
      alloc: { liq: 60, lock: 0, cash: 40 },
      bal: { liq: 10 },
    });

    expect(await unfund()).toEqual({ status: "owed_reduced" });

    const db = test_db.current!.db;
    const [po] = await db.select().from(payouts);
    expect(po!.type).toBe("refunded");
    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo).toMatchObject({ liq: 10, cash: 0 });
    const [owed] = await owed_rows();
    expect(owed).toMatchObject({ credited_back_usd: 40, outstanding_usd: 60 });
    expect(await db.select().from(loss_logs)).toEqual([]);
    const [dist] = await db.select().from(dists);
    expect(dist!.refund_status).toBe("loss");
    expect((await dons())[0]!.status).toBe("refunded_loss");
  });

  // what the refund would do now, had the payout been pending: the savings cover it
  test("a shortfall the savings cover by now reverses in full and clears what is owed", async () => {
    const { npo_id } = await refund_in_flight({
      alloc: { liq: 60, lock: 0, cash: 40 },
      bal: { liq: 10 },
    });
    const db = test_db.current!.db;
    await db.update(npos).set({ liq: 500 }).where(eq(npos.id, npo_id));

    expect(await unfund()).toEqual({ status: "reversed" });

    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo).toMatchObject({ liq: 440, cash: 0 });
    const [owed] = await owed_rows();
    expect(owed!.outstanding_usd).toBe(0);
  });

  test("a payout-only refund whose savings have run short since keeps the savings share owed", async () => {
    const { npo_id } = await refund_in_flight({
      alloc: { liq: 60, lock: 0, cash: 40 },
      bal: { liq: 100 },
    });
    const db = test_db.current!.db;
    await db.update(npos).set({ liq: 0 }).where(eq(npos.id, npo_id));

    expect(await unfund()).toEqual({ status: "owed_reduced" });

    const [owed] = await owed_rows();
    expect(owed).toMatchObject({ credited_back_usd: 40, outstanding_usd: 60 });
  });

  // the units it would have redeemed were priced at refund time, which nothing records
  test("a partly invested dist keeps its invested share owed, its cash credited", async () => {
    const { npo_id } = await refund_in_flight({
      alloc: { liq: 0, lock: 50, cash: 50 },
      bal: { liq: 0, lock_units: 1000 },
    });

    expect(await unfund()).toEqual({ status: "owed_reduced" });

    const db = test_db.current!.db;
    const [npo] = await db.select().from(npos).where(eq(npos.id, npo_id));
    expect(npo).toMatchObject({ lock_units: 1000, cash: 0 });
    const [owed] = await owed_rows();
    expect(owed).toMatchObject({ credited_back_usd: 50, outstanding_usd: 50 });
  });

  /** one cash dist whose payout is in flight, refunded as a loss, then that payout's transfer goes unfunded */
  async function refund_then_unfund(commission: {
    status: "pending" | "processing" | "paid";
    ref: string | null;
  }) {
    const { id, npo_id } = await seed("stripe:card");
    const db = test_db.current!.db;
    await db
      .update(npos)
      .set({ cash: 100, referral_id: "NPO-REF" })
      .where(eq(npos.id, npo_id));
    await db
      .update(dists)
      .set({ alloc: { liq: 0, lock: 0, cash: 100 } })
      .where(eq(dists.donation_id, id));
    await db.insert(payouts).values({
      id: "payout-1",
      source_id: `dist-${id}`,
      npo_id,
      source: "donation",
      date: "2026-07-01T00:00:00.000Z",
      amount: 100,
      type: "processing",
    });
    await db.insert(referrer_commissions).values({
      referrer_npo: "NPO-REF",
      date: "2026-07-01T00:00:00.000Z",
      donation_id: `dist-${id}`,
      npo_id,
      amount: 5,
      ...commission,
    });
    await refund_whole(id);
    const [refunded] = await db.select().from(referrer_commissions);

    expect(await unfund()).toEqual({ status: "reversed" });

    const [dist] = await db.select().from(dists);
    expect(dist!.refund_status).toBe("completed");
    const [comm] = await db.select().from(referrer_commissions);
    return { after_refund: refunded!.status, after_reversal: comm!.status };
  }

  // its payout's transfer went unfunded, but the commission's transfer is its own
  test("an unfunded payout's loss reversal leaves a commission claimed for a transfer refunded_loss", async () => {
    const res = await refund_then_unfund({
      status: "processing",
      ref: "ref-1",
    });

    expect(res).toEqual({
      after_refund: "refunded_loss",
      after_reversal: "refunded_loss",
    });
  });

  // its loss came only from the npo's payout, which the reversal undoes
  test("an unfunded payout's loss reversal returns an unclaimed commission to refunded", async () => {
    const res = await refund_then_unfund({ status: "pending", ref: null });

    expect(res).toEqual({
      after_refund: "refunded_loss",
      after_reversal: "refunded",
    });
  });

  // the referrer was paid either way, and the npo never owed it
  test("an unfunded payout's loss reversal leaves a paid commission paid and owed by its referrer", async () => {
    const res = await refund_then_unfund({ status: "paid", ref: "ref-1" });

    expect(res).toEqual({ after_refund: "paid", after_reversal: "paid" });
    expect(await test_db.current!.db.select().from(loss_logs)).toEqual([]);
    const rows = await owed_rows();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ referrer_npo: null, outstanding_usd: 0 }),
        expect.objectContaining({
          referrer_npo: "NPO-REF",
          received_usd: 5,
          outstanding_usd: 5,
        }),
      ])
    );
  });
});
