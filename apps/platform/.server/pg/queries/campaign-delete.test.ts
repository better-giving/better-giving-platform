import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TestDb } from "../test-utils/pglite";

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

vi.mock("../db", () => ({
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

import { user } from "../schema/auth";
import { campaigns } from "../schema/campaign";
import { donations } from "../schema/donation";
import { funds } from "../schema/fund";
import { npos } from "../schema/npo";
import { subscriptions } from "../schema/subscription";
import { create_test_db } from "../test-utils/pglite";
import { campaign_delete, campaign_gift_count } from "./campaign";

/** statuses a checkout can be left in without ever paying */
const ABANDONED = ["expired", "failed", "cancelled"] as const;

/** every status that was, or may yet be, paid */
const BLOCKING = ["confirmed", "settled", "refunded", "refunded_loss"] as const;

/** owner of every campaign under test */
let acme: number;
/** a second org, to prove ownership is enforced */
let other: number;

async function present(id: string): Promise<boolean> {
  const rows = await test_db
    .current!.db.select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, id));
  return rows.length > 0;
}

beforeAll(async () => {
  test_db.current = await create_test_db();
  const { db } = test_db.current;
  await db.insert(user).values({
    id: "user-del",
    name: "Ada Admin",
    email: "ada-del@test.com",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    first_name: "Ada",
    last_name: "Admin",
  });
  const orgs = await db
    .insert(npos)
    .values(
      (["acme", "other"] as const).map((slug) => ({
        registration_number: `EIN-DEL-${slug}`,
        name: slug,
        slug,
        endow_designation: "Charity" as const,
        overview_pt: "[]",
        hq_country: "United States",
        active: true,
        published: true,
      }))
    )
    .returning({ id: npos.id });
  [acme, other] = orgs.map((r) => r.id) as [number, number];

  // the legacy fund a folded campaign points back at
  await db.insert(funds).values({
    id: "fund-legacy",
    name: "Legacy fund",
    description_pt: "[]",
    banner: "",
    logo: "",
    creator_id: "user-del",
  });

  const campaign = (
    id: string,
    legacy_fund_id: string | null = null
  ): typeof campaigns.$inferInsert => ({
    id,
    owner_npo_id: acme,
    creator_id: "user-del",
    name: id,
    slug: id,
    legacy_fund_id,
  });
  await db
    .insert(campaigns)
    .values([
      campaign("plain"),
      campaign("folded", "fund-legacy"),
      campaign("with-gift"),
      campaign("owned-elsewhere"),
      campaign("abandoned"),
      campaign("abandoned-monthly"),
      campaign("mixed"),
      campaign("open-created"),
      campaign("open-intent"),
      campaign("open-unclosable"),
      campaign("open-paypal"),
      campaign("open-races"),
      campaign("open-monthly"),
      campaign("open-late"),
      campaign("crypto-expired"),
      campaign("paypal-expired"),
      ...BLOCKING.map((st) => campaign(`gift-${st}`)),
    ]);
  const donation = (
    id: string,
    campaign_id: string,
    status: string,
    via = "stripe"
  ): typeof donations.$inferInsert => ({
    id,
    campaign_id,
    upusd: 1,
    status,
    amount_base: 10,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via,
  });
  // one checkout abandoned per status that never settled
  await db
    .insert(donations)
    .values(
      ABANDONED.map((st) => donation(`don-abandoned-${st}`, "abandoned", st))
    );
  // an abandoned monthly checkout leaves its subscription row behind
  await db.insert(subscriptions).values({
    id: "sub-abandoned",
    interval: "month",
    interval_count: 1,
    next_billing: new Date().toISOString(),
    amount: 10,
    amount_usd: 10,
    currency: "USD",
    product_id: "prod-1",
    to_npo_id: acme,
    campaign_id: "abandoned-monthly",
    to_name: "acme",
    platform: "stripe",
    status: "active",
    from_id: "donor@test.com",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await db.insert(donations).values([
    donation("don-monthly-created", "abandoned-monthly", "created"),
    donation("don-mixed-expired", "mixed", "expired"),
    donation("don-mixed-settled", "mixed", "settled"),
    donation("don-open-created", "open-created", "created"),
    donation("don-open-intent", "open-intent", "intent"),
    donation("don-open-unclosable", "open-unclosable", "created"),
    donation("don-open-paypal", "open-paypal", "created", "paypal"),
    donation("don-open-races", "open-races", "created"),
    donation("don-open-late-1", "open-late", "created"),
    {
      ...donation("don-open-monthly", "open-monthly", "created"),
      frequency: "monthly",
    },
    donation("don-crypto-expired", "crypto-expired", "expired", "crypto:eth"),
    donation("don-paypal-expired", "paypal-expired", "expired", "paypal"),
  ]);
  await db
    .insert(donations)
    .values(BLOCKING.map((st) => donation(`don-${st}`, `gift-${st}`, st)));
  // a gift of its own keeps "with-gift" undeletable
  await db.insert(donations).values({
    id: "don-1",
    campaign_id: "with-gift",
    upusd: 1,
    status: "settled",
    amount_base: 10,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

async function row_of(donation_id: string) {
  const [row] = await test_db
    .current!.db.select({
      campaign_id: donations.campaign_id,
      status: donations.status,
    })
    .from(donations)
    .where(eq(donations.id, donation_id));
  return row;
}

/** stands in for stripe: reports every id closed */
const closes_all = vi.fn(async (rows: { id: string }[]) =>
  rows.map((r) => r.id)
);

describe("campaign_delete", () => {
  it("deletes a campaign with no gifts and no legacy fund", async () => {
    expect(await campaign_delete(acme, "plain")).toBe(true);
    expect(await present("plain")).toBe(false);
  });

  it("refuses a campaign folded from a legacy fund, leaving it in place", async () => {
    expect(await campaign_delete(acme, "folded")).toBe(false);
    expect(await present("folded")).toBe(true);
  });

  it("refuses a campaign that has its own gifts", async () => {
    expect(await campaign_delete(acme, "with-gift")).toBe(false);
    expect(await present("with-gift")).toBe(true);
  });

  it("refuses when another nonprofit owns it", async () => {
    expect(await campaign_delete(other, "owned-elsewhere")).toBe(false);
    expect(await present("owned-elsewhere")).toBe(true);
  });

  it("deletes a campaign whose only donations are closed checkouts, detaching them", async () => {
    expect(await campaign_gift_count("abandoned")).toBe(0);
    expect(await campaign_delete(acme, "abandoned")).toBe(true);
    expect(await present("abandoned")).toBe(false);
    for (const st of ABANDONED) {
      expect(await row_of(`don-abandoned-${st}`)).toEqual({
        campaign_id: null,
        status: st,
      });
    }
  });

  it("refuses when a closed row sits beside a settled gift, detaching nothing", async () => {
    closes_all.mockClear();
    expect(await campaign_delete(acme, "mixed", closes_all)).toBe(false);
    expect(closes_all).not.toHaveBeenCalled();
    expect(await present("mixed")).toBe(true);
    expect((await row_of("don-mixed-expired"))?.campaign_id).toBe("mixed");
  });

  it.each(BLOCKING)("refuses a campaign with a %s gift", async (st) => {
    expect(await campaign_gift_count(`gift-${st}`)).toBe(1);
    expect(await campaign_delete(acme, `gift-${st}`, closes_all)).toBe(false);
    expect(await present(`gift-${st}`)).toBe(true);
  });
});

describe("campaign_delete with open payments", () => {
  it.each([
    ["created", "open-created", "don-open-created"],
    ["intent", "open-intent", "don-open-intent"],
  ])(
    "closes an open stripe %s payment, then deletes and detaches it",
    async (_, campaign, donation) => {
      closes_all.mockClear();
      // an open stripe payment does not hide the delete from the page
      expect(await campaign_gift_count(campaign)).toBe(0);

      expect(await campaign_delete(acme, campaign, closes_all)).toBe(true);

      expect(closes_all).toHaveBeenCalledTimes(1);
      expect(await present(campaign)).toBe(false);
      // closed for good: cancelled, and no longer pointing at the campaign
      expect(await row_of(donation)).toEqual({
        campaign_id: null,
        status: "cancelled",
      });
    }
  );

  it("refuses, changing nothing, when stripe can't close the payment", async () => {
    const refuses = vi.fn(async () => null);
    expect(await campaign_delete(acme, "open-unclosable", refuses)).toBe(false);
    expect(refuses).toHaveBeenCalledTimes(1);
    expect(await present("open-unclosable")).toBe(true);
    expect(await row_of("don-open-unclosable")).toEqual({
      campaign_id: "open-unclosable",
      status: "created",
    });
  });

  it("refuses when nothing is there to close payments", async () => {
    expect(await campaign_delete(acme, "open-unclosable")).toBe(false);
    expect(await present("open-unclosable")).toBe(true);
  });

  it("keeps a campaign whose open payment is another provider's, without asking stripe", async () => {
    const never = vi.fn(async () => []);
    expect(await campaign_gift_count("open-paypal")).toBe(1);
    expect(await campaign_delete(acme, "open-paypal", never)).toBe(false);
    expect(never).not.toHaveBeenCalled();
    expect(await present("open-paypal")).toBe(true);
    expect(await row_of("don-open-paypal")).toEqual({
      campaign_id: "open-paypal",
      status: "created",
    });
  });

  it("refuses a payment that settles after it was closed, and keeps it attached", async () => {
    const settles_meanwhile = vi.fn(async (rows: { id: string }[]) => {
      await test_db
        .current!.db.update(donations)
        .set({ status: "settled" })
        .where(eq(donations.id, "don-open-races"));
      return rows.map((r) => r.id);
    });
    expect(await campaign_delete(acme, "open-races", settles_meanwhile)).toBe(
      false
    );
    expect(await present("open-races")).toBe(true);
    expect(await row_of("don-open-races")).toEqual({
      campaign_id: "open-races",
      status: "settled",
    });
  });

  it("refuses a checkout that opens while the others are being closed, closing none of it for good", async () => {
    const opens_another = vi.fn(async (rows: { id: string }[]) => {
      await test_db.current!.db.insert(donations).values({
        id: "don-open-late-2",
        campaign_id: "open-late",
        upusd: 1,
        status: "created",
        amount_base: 10,
        amount_tip: 0,
        amount_fee_allowance: 0,
        currency: "USD",
        frequency: "one-time",
        source: "bg-marketplace",
        via: "stripe",
      });
      return rows.map((r) => r.id);
    });
    expect(await campaign_delete(acme, "open-late", opens_another)).toBe(false);
    expect(await present("open-late")).toBe(true);
    expect(await row_of("don-open-late-1")).toEqual({
      campaign_id: "open-late",
      status: "created",
    });
    expect(await row_of("don-open-late-2")).toEqual({
      campaign_id: "open-late",
      status: "created",
    });
  });

  it("refuses before touching stripe when a subscription still points at it", async () => {
    closes_all.mockClear();
    expect(await campaign_delete(acme, "abandoned-monthly", closes_all)).toBe(
      false
    );
    expect(closes_all).not.toHaveBeenCalled();
    expect(await present("abandoned-monthly")).toBe(true);
    expect(await row_of("don-monthly-created")).toEqual({
      campaign_id: "abandoned-monthly",
      status: "created",
    });
  });

  it("hands a recurring open payment to the closer with its frequency, and keeps the campaign when refused", async () => {
    const asked = vi.fn(async () => null);
    expect(await campaign_delete(acme, "open-monthly", asked)).toBe(false);
    expect(asked).toHaveBeenCalledWith([
      { id: "don-open-monthly", frequency: "monthly" },
    ]);
    expect(await row_of("don-open-monthly")).toEqual({
      campaign_id: "open-monthly",
      status: "created",
    });
  });

  it("keeps a campaign whose crypto deposit expired: it can still be paid and settle", async () => {
    expect(await campaign_gift_count("crypto-expired")).toBe(1);
    expect(await campaign_delete(acme, "crypto-expired", closes_all)).toBe(
      false
    );
    expect(await row_of("don-crypto-expired")).toEqual({
      campaign_id: "crypto-expired",
      status: "expired",
    });
  });

  it("detaches an expired paypal checkout", async () => {
    expect(await campaign_delete(acme, "paypal-expired")).toBe(true);
    expect(await row_of("don-paypal-expired")).toEqual({
      campaign_id: null,
      status: "expired",
    });
  });
});
