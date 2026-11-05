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
import { doc_args } from "#/__tests__/fixtures/route-args";
import type { TestDb } from "$/pg/test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));
const stripe = vi.hoisted(() => ({
  transfers: { retrieve: vi.fn() },
}));
const report_degraded = vi.hoisted(() => vi.fn());

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
vi.mock("$/kit/stripe", () => ({ stripe }));
vi.mock("$/env", async (importOriginal) => {
  const real = await importOriginal<typeof import("$/env")>();
  return { ...real, stripe: { ...real.stripe, connect_routing: true } };
});
vi.mock("#/errors/report", () => ({ report_degraded }));
vi.mock("#/.server/auth", async () =>
  (await import("$/auth/test-utils")).make_auth_mock()
);
vi.mock("remix-client-cache", () => ({
  CacheRoute: (Component: any) => Component,
  createClientLoaderCache: () => undefined,
}));

import { seed_npo } from "#/__tests__/fixtures/funds";
import type { INpoSent } from "@/stripe-connect/sent";
import { admin_ctx } from "$/auth/test-utils";
import { encode_date_cursor } from "$/pg/queries/helpers";
import { dists } from "$/pg/schema/dist";
import { donations } from "$/pg/schema/donation";
import { npos } from "$/pg/schema/npo";
import { payouts } from "$/pg/schema/payout";
import { create_test_db } from "$/pg/test-utils/pglite";
import { RETRIEVE_BATCH } from "$/stripe-connect/sent";
import { loader } from "./route";

const db = () => test_db.current!.db;

interface IRecord {
  amount: number;
  amount_reversed: number;
  created: number;
  reversals: { data: { amount: number }[]; has_more: boolean };
}

const records = new Map<string, IRecord>();
const unix = (iso: string) => Date.parse(iso) / 1000;

let npo_id: number;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  records.clear();
  vi.clearAllMocks();
  stripe.transfers.retrieve.mockImplementation(async (id: string) => {
    const t = records.get(id);
    if (!t) throw new Error(`missing transfer ${id}`);
    return { id, ...t };
  });
  await db().delete(payouts);
  await db().delete(dists);
  await db().delete(donations);
  await db().delete(npos);
});

/** a reversal list stripe returned in full */
const listed = (amounts: number[]): IRecord["reversals"] => ({
  data: amounts.map((amount) => ({ amount })),
  has_more: false,
});

async function npo(o: { acct?: string | null; off?: string | null } = {}) {
  const row = await seed_npo(db(), {
    registration_number: "EIN-SENT",
    // ready, so a linked account routes
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    stripe_details_submitted: true,
    ...(o.acct !== undefined && { stripe_account_id: o.acct }),
    ...(o.off !== undefined && { stripe_deauthorized_at: o.off }),
  });
  npo_id = row!.id;
  return row!;
}

async function transfer(id: string, net: number, date: string, rec: IRecord) {
  records.set(id, rec);
  const donation_id = `don-${id}`;
  await db().insert(donations).values({
    id: donation_id,
    upusd: 1,
    status: "settled",
    amount_base: net,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db()
    .insert(dists)
    .values({
      id: `dist-${id}`,
      donation_id,
      status: "settled",
      date_created: date,
      to_id: npo_id,
      amount_denom: "USD",
      net,
      stripe_routed_to: "acct_sent",
      stripe_transfer_id: id,
      stripe_transfer_created_at: new Date(rec.created * 1000).toISOString(),
    });
}

async function load(search = "") {
  return loader({
    ...doc_args(
      new Request(`https://app.test/admin/${npo_id}/dashboard/payouts${search}`)
    ),
    context: { get: (k: unknown) => (k === admin_ctx ? npo_id : undefined) },
  } as any);
}

async function sent(search = ""): Promise<INpoSent | null> {
  const data = await load(search);
  if (!("sent" in data)) throw new Error("loader omitted sent");
  return data.sent;
}

describe("payouts loader — routed transfer standing", () => {
  test("no reversal is paid out", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_none", 90, "2026-07-01T00:00:00.000Z", {
      amount: 9_000,
      // a decoy: the reversal records are the source, and there are none
      amount_reversed: 500,
      created: unix("2026-07-01T00:00:00.000Z"),
      reversals: listed([]),
    });
    await db().insert(payouts).values({
      id: "p-1",
      source_id: "src-1",
      npo_id,
      source: "donation",
      date: "2026-07-04T00:00:00.000Z",
      amount: 12.5,
      type: "pending",
    });

    const data = await load();
    expect(data.items.map((p) => p.id)).toEqual(["p-1"]);
    expect("sent" in data && data.sent).toEqual({
      truncated: false,
      on_stripe: true,
      connected: true,
      items: [
        {
          id: "tr_none",
          amount: 90,
          date: "2026-07-01T00:00:00.000Z",
          standing: { kind: "paid" },
        },
      ],
    });
    expect(stripe.transfers.retrieve).toHaveBeenCalledExactlyOnceWith(
      "tr_none",
      { expand: ["reversals"] }
    );
  });

  test("a partial reversal names the reversed amount", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_part", 40, "2026-07-02T00:00:00.000Z", {
      amount: 4_000,
      amount_reversed: 0,
      created: unix("2026-07-02T00:00:00.000Z"),
      reversals: listed([2_500]),
    });

    expect(await sent()).toEqual({
      truncated: false,
      on_stripe: true,
      connected: true,
      items: [
        {
          id: "tr_part",
          amount: 40,
          date: "2026-07-02T00:00:00.000Z",
          standing: { kind: "partial", reversed: 25 },
        },
      ],
    });
  });

  test("reversal records that take the whole transfer are fully reversed", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_full", 15, "2026-07-03T00:00:00.000Z", {
      amount: 1_500,
      amount_reversed: 0,
      created: unix("2026-07-03T00:00:00.000Z"),
      reversals: listed([1_000, 500]),
    });

    expect(await sent()).toEqual({
      truncated: false,
      on_stripe: true,
      connected: true,
      items: [
        {
          id: "tr_full",
          amount: 15,
          date: "2026-07-03T00:00:00.000Z",
          standing: { kind: "reversed" },
        },
      ],
    });
  });

  test("an incomplete reversal page uses stripe's reversed total", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_more", 100, "2026-07-04T00:00:00.000Z", {
      amount: 10_000,
      amount_reversed: 3_000,
      created: unix("2026-07-04T00:00:00.000Z"),
      reversals: { data: [{ amount: 10_000 }], has_more: true },
    });

    expect((await sent())?.items[0]?.standing).toEqual({
      kind: "partial",
      reversed: 30,
    });
  });

  test("lists newest first", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_old", 10, "2026-07-01T00:00:00.000Z", {
      amount: 1_000,
      amount_reversed: 0,
      created: unix("2026-07-01T00:00:00.000Z"),
      reversals: listed([]),
    });
    await transfer("tr_new", 20, "2026-07-02T00:00:00.000Z", {
      amount: 2_000,
      amount_reversed: 0,
      created: unix("2026-07-09T00:00:00.000Z"),
      reversals: listed([]),
    });

    expect((await sent())?.items.map((t) => t.id)).toEqual([
      "tr_new",
      "tr_old",
    ]);
  });

  test("a connected nonprofit with nothing sent gets an empty list", async () => {
    await npo({ acct: "acct_sent" });
    expect(await sent()).toEqual({
      items: [],
      truncated: false,
      on_stripe: true,
      connected: true,
    });
    expect(stripe.transfers.retrieve).not.toHaveBeenCalled();
  });

  test("a nonprofit not on Connect is unchanged, transfers or not", async () => {
    await npo();
    expect(await sent()).toBeNull();

    await db().update(npos).set({
      stripe_account_id: "acct_sent",
      stripe_deauthorized_at: "2026-08-01T00:00:00.000Z",
    });
    expect(await sent()).toBeNull();
    expect(stripe.transfers.retrieve).not.toHaveBeenCalled();
  });

  test("a disconnected nonprofit keeps the transfers it was sent", async () => {
    await npo({
      acct: "acct_sent",
      off: "2026-08-01T00:00:00.000Z",
    });
    await transfer("tr_kept", 90, "2026-07-01T00:00:00.000Z", {
      amount: 9_000,
      amount_reversed: 0,
      created: unix("2026-07-01T00:00:00.000Z"),
      reversals: listed([]),
    });

    expect((await sent())?.items.map((t) => t.id)).toEqual(["tr_kept"]);
  });

  test("a stripe miss shows the transfer's creation time", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_down", 90, "2026-06-01T00:00:00.000Z", {
      amount: 9_000,
      amount_reversed: 0,
      created: unix("2026-07-01T12:00:00.000Z"),
      reversals: listed([]),
    });
    stripe.transfers.retrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ message: "socket hang up" })
    );

    expect(await sent()).toEqual({
      truncated: false,
      on_stripe: true,
      connected: true,
      items: [
        {
          id: "tr_down",
          amount: 90,
          date: "2026-07-01T12:00:00.000Z",
          standing: { kind: "unknown" },
        },
      ],
    });
    expect(report_degraded).toHaveBeenCalledOnce();
  });

  test("a stripe miss with no stored transfer time keeps the donation date", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_legacy", 90, "2026-07-01T12:00:00.000Z", {
      amount: 9_000,
      amount_reversed: 0,
      created: unix("2026-08-01T00:00:00.000Z"),
      reversals: listed([]),
    });
    await db()
      .update(dists)
      .set({ stripe_transfer_created_at: null })
      .where(eq(dists.id, "dist-tr_legacy"));
    stripe.transfers.retrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ message: "socket hang up" })
    );

    expect((await sent())?.items[0]?.date).toBe("2026-07-01T12:00:00.000Z");
  });

  test("anything other than stripe still fails the page", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_bug", 90, "2026-07-01T00:00:00.000Z", {
      amount: 9_000,
      amount_reversed: 0,
      created: unix("2026-07-01T00:00:00.000Z"),
      reversals: listed([]),
    });
    stripe.transfers.retrieve.mockRejectedValueOnce(new Error("boom"));

    await expect(sent()).rejects.toThrow("boom");
    expect(report_degraded).not.toHaveBeenCalled();
  });

  test("load-more does not read stripe again", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_none", 90, "2026-07-01T00:00:00.000Z", {
      amount: 9_000,
      amount_reversed: 0,
      created: unix("2026-07-01T00:00:00.000Z"),
      reversals: listed([]),
    });
    const next = encode_date_cursor("2026-08-01T00:00:00.000Z");

    const data = await load(`?next=${next}`);

    expect(data.sent).toBeNull();
    expect(stripe.transfers.retrieve).not.toHaveBeenCalled();
  });

  test("stops after the most recent hundred", async () => {
    await npo({ acct: "acct_sent" });
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    for (let i = 0; i <= 100; i++) {
      const date = new Date(start + i * 3_600_000).toISOString();
      await transfer(`tr-${i}`, 10, date, {
        amount: 1_000,
        amount_reversed: 0,
        created: unix(date),
        reversals: listed([]),
      });
    }

    const page = await sent();
    const ids = stripe.transfers.retrieve.mock.calls.map((c) => c[0]);
    expect(page?.truncated).toBe(true);
    expect(page?.items).toHaveLength(100);
    expect(page?.items[0]?.id).toBe("tr-100");
    expect(ids).toHaveLength(100);
    expect(ids).not.toContain("tr-0");
  });

  test("orders by when the transfer was created, not the donation", async () => {
    await npo({ acct: "acct_sent" });
    await transfer("tr_donated_later", 10, "2026-08-01T00:00:00.000Z", {
      amount: 1_000,
      amount_reversed: 0,
      created: unix("2026-07-01T00:00:00.000Z"),
      reversals: listed([]),
    });
    await transfer("tr_sent_later", 20, "2026-06-01T00:00:00.000Z", {
      amount: 2_000,
      amount_reversed: 0,
      created: unix("2026-07-15T00:00:00.000Z"),
      reversals: listed([]),
    });

    const page = await sent();
    expect(page?.items.map((t) => t.id)).toEqual([
      "tr_sent_later",
      "tr_donated_later",
    ]);
    expect(page?.items[0]?.date).toBe("2026-07-15T00:00:00.000Z");
  });

  test("keeps a later transfer of an older donation in the recent hundred", async () => {
    await npo({ acct: "acct_sent" });
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    for (let i = 0; i < 100; i++) {
      const sent_at = new Date(start + i * 3_600_000).toISOString();
      await transfer(`tr-${i}`, 10, "2026-08-01T00:00:00.000Z", {
        amount: 1_000,
        amount_reversed: 0,
        created: unix(sent_at),
        reversals: listed([]),
      });
    }
    const newest = new Date(start + 100 * 3_600_000).toISOString();
    await transfer("tr-late", 10, "2020-01-01T00:00:00.000Z", {
      amount: 1_000,
      amount_reversed: 0,
      created: unix(newest),
      reversals: listed([]),
    });

    const page = await sent();
    expect(page?.truncated).toBe(true);
    expect(page?.items).toHaveLength(100);
    expect(page?.items[0]?.id).toBe("tr-late");
    expect(page?.items[0]?.date).toBe(newest);
    expect(page?.items.map((t) => t.id)).not.toContain("tr-0");
  });

  test("retrieves transfers a few at a time, in transfer order", async () => {
    await npo({ acct: "acct_sent" });
    const n = RETRIEVE_BATCH + 5;
    const start = Date.parse("2026-07-01T00:00:00.000Z");
    for (let i = 0; i < n; i++) {
      const date = new Date(start + i * 60_000).toISOString();
      await transfer(`tr-${i}`, 10, "2026-01-01T00:00:00.000Z", {
        amount: 1_000,
        amount_reversed: 0,
        created: unix(date),
        reversals: listed([]),
      });
    }

    let in_flight = 0;
    let max_in_flight = 0;
    stripe.transfers.retrieve.mockImplementation(async (id: string) => {
      in_flight += 1;
      max_in_flight = Math.max(max_in_flight, in_flight);
      await new Promise((r) => setTimeout(r, 0));
      in_flight -= 1;
      const t = records.get(id);
      if (!t) throw new Error(`missing transfer ${id}`);
      return { id, ...t };
    });

    const page = await sent();
    expect(max_in_flight).toBe(RETRIEVE_BATCH);
    expect(page?.items).toHaveLength(n);
    expect(page?.items.map((t) => t.id)).toEqual(
      Array.from({ length: n }, (_, i) => `tr-${n - 1 - i}`)
    );
    expect(stripe.transfers.retrieve).toHaveBeenCalledTimes(n);
  });
});
