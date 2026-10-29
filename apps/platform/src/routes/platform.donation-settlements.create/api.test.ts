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
import { user } from "$/pg/schema/auth";
import { bal_txs } from "$/pg/schema/bal-tx";
import { dists } from "$/pg/schema/dist";
import {
  donation_donors,
  donation_recipients,
  donation_settlements,
  donations,
} from "$/pg/schema/donation";
import { funds } from "$/pg/schema/fund";
import { donation_match_events } from "$/pg/schema/match";
import { nav_holders, nav_log_positions, nav_logs } from "$/pg/schema/nav";
import { npos } from "$/pg/schema/npo";
import { payouts } from "$/pg/schema/payout";
import { rev_logs } from "$/pg/schema/revenue";
import type { TestDb } from "$/pg/test-utils/pglite";

// --- mocks (hoisted) ---

const test_db = vi.hoisted(() => ({ current: null as TestDb | null }));

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

// the only faked seam: the donation row, the settlement records and the arrival
// claim all run against real postgres, because the refusal this action has to
// report is a db gate and a stubbed query could not demonstrate it.
const send_email = vi.hoisted(() =>
  vi.fn(async (_i: { node: any; to: string[]; subject: string }) => ({
    data: { id: "email-1", response: "250 ok" },
    error: null,
  }))
);
vi.mock("$/email", () => ({ send_email, sender: "test@test.com" }));

// the other faked seam: `enqueue` is a live qstash call, and constructing its
// client at import time already needs credentials this suite has none of. what
// the route has to be shown doing is handing the msgs over at all — the queue's
// own behaviour is not under test here.
const enqueue = vi.hoisted(() => vi.fn(async (..._msgs: unknown[]) => {}));
vi.mock("$/kit/queue", () => ({ enqueue }));

// --- imports (after mocks) ---

import { create_test_db } from "$/pg/test-utils/pglite";
import { action, loader } from "./api";

// --- setup ---

let npo_id: number;
let other_npo_id: number;
let counter = 0;

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  const db = test_db.current!.db;
  await db.delete(donation_match_events);
  await db.delete(payouts);
  await db.delete(bal_txs);
  await db.delete(rev_logs);
  await db.delete(dists);
  await db.delete(donation_settlements);
  await db.delete(donation_donors);
  await db.delete(donation_recipients);
  await db.delete(donations);
  // funds sit between the recipient rows above and the npos/user rows below
  await db.delete(funds);
  await db.delete(user);
  await db.delete(nav_holders);
  await db.delete(nav_log_positions);
  await db.delete(nav_logs);
  await db.delete(npos);
  counter = 0;

  const rows = await db
    .insert(npos)
    .values([
      {
        registration_number: "EIN-MATCH-STTL",
        name: "Freegan Food Foundation",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
        allocation: { liq: 100, lock: 0, cash: 0 },
      },
      {
        registration_number: "EIN-MATCH-OTHER",
        name: "Zebra Wildlife Trust",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
        allocation: { liq: 100, lock: 0, cash: 0 },
      },
    ])
    .returning({ id: npos.id });
  npo_id = rows[0]!.id;
  other_npo_id = rows[1]!.id;

  // a fund needs a creator; nothing under test reads it
  await db.insert(user).values({
    id: "u-fund-creator",
    name: "Fund Creator",
    email: "creator@test.com",
    first_name: "Fund",
    last_name: "Creator",
  });

  // a nav log without its positions is refused by a deferred check, so the pair
  // goes in together
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.insert(nav_logs).values({
      date: now,
      reason: "test",
      units: 100,
      price: 1,
      price_updated: now,
    });
    await tx.insert(nav_log_positions).values({
      date: now,
      ticker: "CASH",
      qty: 1000,
      price: 1,
      value: 1000,
      price_date: now,
    });
  });
});

/** the donor's original gift — the one an employer is asked to match */
async function seed_gift(o?: {
  company_name?: string | null;
  to_npo?: number;
  status?: "settled" | "refunded";
  stamps?: Partial<typeof donation_match_events.$inferInsert>;
}) {
  counter++;
  const db = test_db.current!.db;
  const id = `gift-${counter}`;
  const to = o?.to_npo ?? npo_id;
  await db.insert(donations).values({
    id,
    upusd: 1,
    status: o?.status ?? "settled",
    amount_base: 50,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db.insert(donation_recipients).values({
    donation_id: id,
    npo_id: to,
    name: to === npo_id ? "Freegan Food Foundation" : "Zebra Wildlife Trust",
    type: "npo",
  });
  await db.insert(donation_donors).values({
    donation_id: id,
    email: "donor@test.com",
    name: "Ada Lovelace",
    company_name:
      o?.company_name === null ? null : (o?.company_name ?? "Acme Inc"),
  });
  if (o?.stamps) {
    await db.insert(donation_match_events).values({
      id: `evt-${counter}`,
      donation_id: id,
      ...o.stamps,
    });
  }
  return id;
}

/**
 * the same gift, given to a fund instead of one nonprofit — employer capture is
 * offered on these too, so a match for one has to reach the fund's members.
 */
async function seed_fund_gift(members: number[]) {
  counter++;
  const db = test_db.current!.db;
  const id = `gift-${counter}`;
  const fund_id = `fund-${counter}`;
  await db.insert(funds).values({
    id: fund_id,
    name: "Rainforest Fund",
    description_pt: "[]",
    banner: "banner.jpg",
    logo: "logo.jpg",
    creator_id: "u-fund-creator",
  });
  await db.insert(donations).values({
    id,
    upusd: 1,
    status: "settled",
    amount_base: 50,
    amount_tip: 0,
    amount_fee_allowance: 0,
    currency: "USD",
    frequency: "one-time",
    source: "bg-marketplace",
    via: "stripe:card",
  });
  await db.insert(donation_recipients).values({
    donation_id: id,
    fund_id,
    name: "Rainforest Fund",
    type: "fund",
    members,
  });
  await db.insert(donation_donors).values({
    donation_id: id,
    email: "donor@test.com",
    name: "Ada Lovelace",
    company_name: "Acme Inc",
  });
  return { id, fund_id };
}

type Fields = {
  from?: string;
  npo_id?: string;
  donor_name?: string;
  donor_email?: string;
  net?: string;
  reference?: string;
  for_donation_id?: string;
  /** the confirm's idempotency key; a fresh one per call unless named, and
   * left off the body when null, as a page loaded before the key existed posts */
  key?: string | null;
};

function settle(f: Fields) {
  const body = new URLSearchParams({
    npo_id: (f.npo_id ?? npo_id).toString(),
    net: f.net ?? "50",
    reference: f.reference ?? "Employer cheque #1",
    ...(f.from ? { from: f.from } : {}),
    // sent whenever the field is named, blank included — the form posts every
    // key it holds, so "" is what an untouched box actually arrives as
    ...(f.donor_name !== undefined ? { donor_name: f.donor_name } : {}),
    ...(f.donor_email !== undefined ? { donor_email: f.donor_email } : {}),
    ...(f.for_donation_id ? { for_donation_id: f.for_donation_id } : {}),
  });
  if (f.key !== null) body.set("idempotency_key", f.key ?? crypto.randomUUID());
  const url = "http://localhost/platform/donation-settlements/create";
  return action({
    request: new Request(url, { method: "POST", body }),
    params: {},
    context: {} as any,
  } as any);
}

function preview(p: Record<string, string>) {
  const url = `http://localhost/platform/donation-settlements/create?${new URLSearchParams(p)}`;
  return loader({
    request: new Request(url),
    params: {},
    context: {} as any,
  } as any);
}

const events = () => test_db.current!.db.select().from(donation_match_events);
const dons = () => test_db.current!.db.select().from(donations);
const dist_rows = () => test_db.current!.db.select().from(dists);
const payout_rows = () => test_db.current!.db.select().from(payouts);
const bal_tx_rows = () => test_db.current!.db.select().from(bal_txs);
const recipient_of = async (donation_id: string) => {
  const [row] = await test_db
    .current!.db.select()
    .from(donation_recipients)
    .where(eq(donation_recipients.donation_id, donation_id));
  return row!;
};
// `donation_put` splits the payer across subtables — who paid lives here
const donor_of = async (donation_id: string) => {
  const [row] = await test_db
    .current!.db.select()
    .from(donation_donors)
    .where(eq(donation_donors.donation_id, donation_id));
  return row!;
};

describe("settlement create — an employer's match arrives", () => {
  test("records the gift, stamps the arrival, and tells the donor once", async () => {
    const gift = await seed_gift();

    const res = await settle({ from: "match", for_donation_id: gift });

    expect(res).toEqual({ ok: true });

    // the employer's money is its own donation row, keyed `match` — the string
    // `match_funnel` excludes so the funnel's denominator stays the donor gifts
    const rows = await dons();
    const match = rows.find((d) => d.id !== gift)!;
    expect(match.via).toBe("match");
    expect(match.status).toBe("settled");

    // the event hangs off the donor's gift and points at the employer's row
    const [evt] = await events();
    expect(evt!.donation_id).toBe(gift);
    expect(evt!.matched_donation_id).toBe(match.id);
    expect(evt!.matched_at).not.toBeNull();

    expect(send_email).toHaveBeenCalledTimes(1);
    expect(send_email.mock.calls[0]![0].to).toEqual(["donor@test.com"]);
  });
});

describe("settlement create — a match the gift can't take", () => {
  test("a second arrival is refused, and leaves no donation behind", async () => {
    const gift = await seed_gift({
      stamps: {
        matched_donation_id: null,
        matched_at: null,
      },
    });
    await settle({ from: "match", for_donation_id: gift });
    vi.clearAllMocks();

    const res = await settle({
      from: "match",
      for_donation_id: gift,
      reference: "Employer cheque #2",
    });

    // the admin is holding a cheque: "already recorded" and "refunded" are
    // different problems and must not arrive as the same sentence
    expect(res).toEqual({
      ok: false,
      error: `A match is already recorded for donation ${gift}`,
    });

    // the refusal is the last write in the transaction, so the employer's row
    // and the npo credit go back with it — a settlement reported as failed that
    // left money recorded is the one outcome worth rolling back for
    const rows = await dons();
    expect(rows.filter((d) => d.via === "match")).toHaveLength(1);
    expect(send_email).not.toHaveBeenCalled();
    // and the nonprofit hears nothing either: the msgs the rolled-back
    // `settle_npo` produced would announce a distribution that no longer exists
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a refunded gift is refused, and says so in its own words", async () => {
    const gift = await seed_gift({
      status: "refunded",
      stamps: { voided_at: "2026-07-08T00:00:00Z", void_reason: "refunded" },
    });

    const res = await settle({ from: "match", for_donation_id: gift });

    expect(res).toEqual({
      ok: false,
      error: `Donation ${gift} was refunded — there is nothing left to match`,
    });
    expect((await dons()).filter((d) => d.via === "match")).toHaveLength(0);
    expect(send_email).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("an id that resolves to nothing is refused before anything is written", async () => {
    const res = await settle({
      from: "match",
      for_donation_id: "no-such-gift",
    });

    expect(res).toEqual({
      ok: false,
      error: "Donation no-such-gift not found",
    });
    expect(await dons()).toHaveLength(0);
  });

  test("an npo that disagrees with the gift's is refused", async () => {
    const gift = await seed_gift({ to_npo: undefined });

    // an employer's match goes to the nonprofit the gift went to; a form naming
    // a different one is a mis-keyed id, not a second intent
    const res = await settle({
      from: "match",
      for_donation_id: gift,
      npo_id: other_npo_id.toString(),
    });

    expect(res).toEqual({
      ok: false,
      error: `Donation ${gift} went to Freegan Food Foundation — a match goes to the same nonprofit as the gift it matches`,
    });
    expect((await dons()).filter((d) => d.via === "match")).toHaveLength(0);
    expect(await events()).toHaveLength(0);
    expect(send_email).not.toHaveBeenCalled();
  });
});

describe("settlement create — a match for a gift that went to a fund", () => {
  test("reaches every active member, and stamps the arrival once", async () => {
    const { id: gift, fund_id } = await seed_fund_gift([npo_id, other_npo_id]);

    // no nonprofit is picked: a fund gift has none of its own, and the gift is
    // what decides where the employer's money goes
    const res = await settle({
      from: "match",
      for_donation_id: gift,
      npo_id: "",
    });

    expect(res).toEqual({ ok: true });

    const rows = await dist_rows();
    expect(rows.map((r) => r.to_id).sort()).toEqual(
      [npo_id, other_npo_id].sort()
    );

    // the 50 is *split*, not handed to each member: a fan-out that credited
    // every destination the full amount reaches the right nonprofits with twice
    // the money, and passes every id-only assertion above
    expect(rows.map((r) => r.amount)).toEqual([25, 25]);
    expect(rows.reduce((t, r) => t + r.amount!, 0)).toBe(50);
    expect(rows.reduce((t, r) => t + r.net!, 0)).toBeCloseTo(50, 6);
    // and each member's balance is credited once, not once per destination —
    // a 100% liq allocation raises one savings entry per member and no grant
    const bals = await bal_tx_rows();
    expect(bals.map((b) => b.account)).toEqual(["liq", "liq"]);
    expect(bals.reduce((t, b) => t + b.amount, 0)).toBeCloseTo(50, 6);
    expect(await payout_rows()).toHaveLength(0);

    // the employer's row is the fund donation the gift was, not a nonprofit one
    // — the fan-out is a settlement detail and does not reshape the parent
    const match = (await dons()).find((d) => d.via === "match")!;
    const recip = await recipient_of(match.id);
    expect(recip.type).toBe("fund");
    expect(recip.fund_id).toBe(fund_id);
    expect(recip.members).toEqual([npo_id, other_npo_id]);

    // one gift, one arrival, one donor told — however many members shared it
    const evts = await events();
    expect(evts).toHaveLength(1);
    expect(evts[0]!.donation_id).toBe(gift);
    expect(evts[0]!.matched_donation_id).toBe(match.id);
    expect(send_email).toHaveBeenCalledTimes(1);
  });

  test("a fund with no active members is refused, and writes nothing", async () => {
    const { id: gift } = await seed_fund_gift([npo_id, other_npo_id]);
    await test_db.current!.db.update(npos).set({ active: false });

    const res = await settle({
      from: "match",
      for_donation_id: gift,
      npo_id: "",
    });

    // an employer's row recorded against no recipient is money credited to
    // nobody — refuse it rather than bank it and lose track
    expect(res).toEqual({
      ok: false,
      error: `Donation ${gift} went to Rainforest Fund, which has no active nonprofits left — there is nowhere to settle its match`,
    });
    expect(await dons()).toHaveLength(1);
    expect(await dist_rows()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
    expect(send_email).not.toHaveBeenCalled();
  });

  test("a nonprofit picked beside a fund gift is refused, not dropped", async () => {
    const { id: gift } = await seed_fund_gift([npo_id, other_npo_id]);

    // symmetric with the npo case: a form that names a recipient the gift
    // disagrees with is a mis-keyed id. dropping it silently would put that
    // nonprofit's name on the success screen having sent it nothing.
    const res = await settle({
      from: "match",
      for_donation_id: gift,
      npo_id: npo_id.toString(),
    });

    expect(res).toEqual({
      ok: false,
      error: `Donation ${gift} went to Rainforest Fund — a match follows the fund the gift was given to, not a nonprofit picked beside it`,
    });
    expect((await dons()).filter((d) => d.via === "match")).toHaveLength(0);
    expect(await events()).toHaveLength(0);
    expect(send_email).not.toHaveBeenCalled();
  });
});

describe("settlement create — a match for a gift whose nonprofit went inactive", () => {
  test("is refused, not banked with the donor told it arrived", async () => {
    const gift = await seed_gift();
    await test_db
      .current!.db.update(npos)
      .set({ active: false })
      .where(eq(npos.id, npo_id));

    const res = await settle({
      from: "match",
      for_donation_id: gift,
      npo_id: "",
    });

    // `settle_npo` skips an inactive npo and writes nothing, so without a
    // destination check the employer's row lands, the stamp burns and the donor
    // is mailed that their match arrived — against no distribution at all
    expect(res).toEqual({
      ok: false,
      error: `Donation ${gift} went to Freegan Food Foundation, which is no longer active — there is nowhere to settle its match`,
    });
    expect((await dons()).filter((d) => d.via === "match")).toHaveLength(0);
    expect(await dist_rows()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
    expect(send_email).not.toHaveBeenCalled();
  });

  test("previews no records for it either", async () => {
    const gift = await seed_gift();
    await test_db
      .current!.db.update(npos)
      .set({ active: false })
      .where(eq(npos.id, npo_id));

    const res = await preview({ net: "50", for_donation_id: gift });

    // showing a full set of records for a settlement that will be refused is
    // the same lie one step earlier
    expect(res).toEqual({
      preview: null,
      previews: [],
      error: `Donation ${gift} went to Freegan Food Foundation, which is no longer active — there is nowhere to settle its match`,
    });
  });
});

describe("settlement create — a nonprofit picked in the form that went inactive", () => {
  const deactivate = () =>
    test_db
      .current!.db.update(npos)
      .set({ active: false })
      .where(eq(npos.id, npo_id));

  test("is refused rather than recorded against nobody", async () => {
    await deactivate();

    const res = await settle({ from: "cheque" });

    // the selector only ever offers active nonprofits, so this one deactivated
    // while the form was open. `settle_npo` skips the write, so without this
    // check the cheque is banked, no distribution exists behind it and the
    // admin is told it worked
    expect(res).toEqual({
      ok: false,
      error:
        "Freegan Food Foundation is no longer active — there is nowhere to settle this",
    });
    expect(await dons()).toHaveLength(0);
    expect(await dist_rows()).toHaveLength(0);
  });

  test("previews no records for it either", async () => {
    await deactivate();

    const res = await preview({ net: "50", npo_id: npo_id.toString() });

    expect(res).toEqual({
      preview: null,
      previews: [],
      error:
        "Freegan Food Foundation is no longer active — there is nowhere to settle this",
    });
  });

  test("an active nonprofit is unaffected", async () => {
    const res = await settle({ from: "cheque" });

    expect(res).toEqual({ ok: true });
    expect(await dist_rows()).toHaveLength(1);
  });
});

describe("settlement preview — a load that resolves to nothing says why", () => {
  test("an id that resolves to no gift", async () => {
    const res = await preview({ net: "50", for_donation_id: "no-such-gift" });

    // the preview step is where an admin finds out they mis-keyed the id, and
    // a completed load with no records and no sentence is a dead end
    expect(res).toEqual({
      preview: null,
      previews: [],
      error: "Donation no-such-gift not found",
    });
  });

  test("a fund whose members have all gone inactive", async () => {
    const { id: gift } = await seed_fund_gift([npo_id, other_npo_id]);
    await test_db.current!.db.update(npos).set({ active: false });

    const res = await preview({ net: "50", for_donation_id: gift });

    // word for word what the action refuses with — the two steps must not
    // disagree about why the same settlement can't happen
    expect(res).toEqual({
      preview: null,
      previews: [],
      error: `Donation ${gift} went to Rainforest Fund, which has no active nonprofits left — there is nowhere to settle its match`,
    });
  });

  test("a nonprofit id that resolves to nothing", async () => {
    const res = await preview({ net: "50", npo_id: "999999" });

    expect(res).toEqual({
      preview: null,
      previews: [],
      error: "NPO not found",
    });
  });

  test("an untouched form stays silent", async () => {
    const res = await preview({ net: "", npo_id: "" });

    // nothing was asked for, so there is nothing to complain about
    expect(res).toEqual({ preview: null, previews: [], error: null });
  });

  test("a fund gift previews one destination per active member", async () => {
    const { id: gift } = await seed_fund_gift([npo_id, other_npo_id]);

    const res = await preview({ net: "50", for_donation_id: gift });

    expect(res.error).toBeNull();
    expect(res.previews.map((p) => p.npo_name).sort()).toEqual([
      "Freegan Food Foundation",
      "Zebra Wildlife Trust",
    ]);
    // the field every bundle before this one reads still carries a preview
    expect(res.preview).toBe(res.previews[0]);
  });
});

/** every msg handed to the queue across the whole action, kind-filtered */
const enqueued = (id: string) =>
  enqueue.mock.calls.flat().filter((m): m is { id: string; payload: any } => {
    return !!m && typeof m === "object" && (m as { id?: string }).id === id;
  });

describe("settlement create — the nonprofit is told about the money", () => {
  test("a match enqueues a don-dist naming the gift's nonprofit", async () => {
    const gift = await seed_gift();

    const res = await settle({ from: "match", for_donation_id: gift });

    expect(res).toEqual({ ok: true });

    // `don-dist` is what mails the nonprofit, moves country metrics and fires
    // webhooks — a settled npo whose msgs were dropped is a recipient that
    // never hears about money already sitting in its balance
    const msgs = enqueued("don-dist");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.payload.to_id).toBe(npo_id);
    expect(msgs[0]!.payload.net).toBeCloseTo(50, 6);
  });

  test("a fund match enqueues one don-dist per active member", async () => {
    const { id: gift } = await seed_fund_gift([npo_id, other_npo_id]);

    const res = await settle({
      from: "match",
      for_donation_id: gift,
      npo_id: "",
    });

    expect(res).toEqual({ ok: true });

    // one msg per settled destination — collecting only the last loop's msgs
    // would leave every member but one unnotified
    const msgs = enqueued("don-dist");
    expect(msgs.map((m) => m.payload.to_id).sort()).toEqual(
      [npo_id, other_npo_id].sort()
    );
    expect(msgs.map((m) => m.payload.net)).toEqual([25, 25]);
  });

  test.each(["cheque", "daf"] as const)(
    "%s enqueues too — the notification is not a match feature",
    async (from) => {
      const res = await settle({ from, net: "250" });

      expect(res).toEqual({ ok: true });

      const msgs = enqueued("don-dist");
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.payload.to_id).toBe(npo_id);
      expect(msgs[0]!.payload.net).toBeCloseTo(250, 6);
    }
  );

  test("a queue that refuses does not fail a settlement already committed", async () => {
    enqueue.mockRejectedValueOnce(new Error("qstash down"));
    const gift = await seed_gift();

    const res = await settle({ from: "match", for_donation_id: gift });

    // the money is written and the stamp is burned; there is no retry on this
    // rail, so an error here would send the admin to re-key a recorded payment
    expect(res).toEqual({ ok: true });
    expect((await dons()).filter((d) => d.via === "match")).toHaveLength(1);
    expect(await dist_rows()).toHaveLength(1);
  });
});

describe("settlement create — no nonprofit named", () => {
  test("a cheque with no nonprofit says which box is empty", async () => {
    const res = await settle({ from: "cheque", npo_id: "" });

    expect(res).toEqual({ ok: false, error: "Select a nonprofit" });
    expect(await dons()).toHaveLength(0);
  });

  test("an npo gift's match needs no nonprofit picked", async () => {
    const gift = await seed_gift();

    const res = await settle({
      from: "match",
      for_donation_id: gift,
      npo_id: "",
    });

    expect(res).toEqual({ ok: true });
    expect((await dist_rows()).map((r) => r.to_id)).toEqual([npo_id]);
  });
});

describe("settlement create — what the employer's row carries", () => {
  test("the employer name the donor typed, and the settlement placeholder", async () => {
    const gift = await seed_gift({ company_name: "Globex" });

    await settle({ from: "match", for_donation_id: gift });

    const match = (await dons()).find((d) => d.via === "match")!;
    const payer = await donor_of(match.id);
    expect(payer.name).toBe("Globex");
    // the employer is not a donor — no address is held for them, so the row
    // keeps the settlement placeholder rather than borrowing the donor's
    expect(payer.email).toBe("settlement@better.giving");

    // and the donor is told, with their own employer echoed back
    const data = send_email.mock.calls[0]![0].node.props;
    expect(data.employer_name).toBe("Globex");
    expect(data.to_name).toBe("Freegan Food Foundation");
    expect(data.donation_id).toBe(gift);
    expect(data.amount.value).toBe(50);
  });

  test("falls back to the admin's reference when no employer was named", async () => {
    const gift = await seed_gift({ company_name: null });

    await settle({
      from: "match",
      for_donation_id: gift,
      reference: "Benevity disbursement #77",
    });

    const match = (await dons()).find((d) => d.via === "match")!;
    expect((await donor_of(match.id)).name).toBe("Benevity disbursement #77");
    // an internal reference is not something to show a donor as their employer
    expect(
      send_email.mock.calls[0]![0].node.props.employer_name
    ).toBeUndefined();
  });
});

describe("settlement create — an unattributable match", () => {
  test("is recorded as `match` with nothing attached, and mails no one", async () => {
    const res = await settle({
      from: "match",
      donor_name: "Northwind Traders",
      reference: "Cheque #9, no donation quoted",
    });

    expect(res).toEqual({ ok: true });

    // an employer's cheque that names no donation is still money that arrived,
    // and it is still not a gift anyone was asked to match — so it stays out of
    // the funnel's denominator by carrying the same `via`
    const rows = await dons();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.via).toBe("match");
    expect((await donor_of(rows[0]!.id)).name).toBe("Northwind Traders");

    // nothing to stamp and no donor to tell: there is no donation to attach to
    expect(await events()).toHaveLength(0);
    expect(send_email).not.toHaveBeenCalled();
  });

  test.each(["cheque", "daf", "stocks"] as const)(
    "an id typed against a %s is inert",
    async (from) => {
      const gift = await seed_gift();

      const res = await settle({ from, for_donation_id: gift });

      // recorded on its own rail, not refused and not attached to the gift
      expect(res).toEqual({ ok: true });
      expect((await dons()).filter((d) => d.via === from)).toHaveLength(1);
      expect(await events()).toHaveLength(0);
      expect(send_email).not.toHaveBeenCalled();
    }
  );
});

describe("settlement create — the paths that came before", () => {
  test.each(["cheque", "daf", "stocks"] as const)(
    "%s still records the donor's own details and sends nothing",
    async (from) => {
      const res = await settle({
        from,
        donor_name: "Doug Mendenhall",
        reference: "Fidelity deposit #789",
        net: "250",
      });

      expect(res).toEqual({ ok: true });
      const [row] = await dons();
      expect(row!.via).toBe(from);
      expect((await donor_of(row!.id)).name).toBe("Doug Mendenhall");
      expect(row!.via_extra).toBe("Fidelity deposit #789");
      expect(row!.amount_base).toBe(250);
      expect(await events()).toHaveLength(0);
      expect(send_email).not.toHaveBeenCalled();
    }
  );

  test("an omitted donor name still lands as Anonymous", async () => {
    await settle({ from: "cheque" });

    const [row] = await dons();
    expect((await donor_of(row!.id)).name).toBe("Anonymous");
  });

  test("a blank donor name lands as Anonymous too", async () => {
    // the form promises blank is fine — it places `Anonymous` in the box and
    // never marks it required — and posts "" rather than dropping the key
    const res = await settle({ from: "cheque", donor_name: "  " });

    expect(res).toEqual({ ok: true });
    const [row] = await dons();
    expect((await donor_of(row!.id)).name).toBe("Anonymous");
  });

  test("a blank donor email lands as the settlement placeholder", async () => {
    const res = await settle({ from: "cheque", donor_email: "" });

    expect(res).toEqual({ ok: true });
    const [row] = await dons();
    expect((await donor_of(row!.id)).email).toBe("settlement@better.giving");
  });

  test("a malformed donor email is refused, and named", async () => {
    // the control hands the browser no rule of its own, so this schema is the
    // only thing between a typo and a donor record nobody can write back to
    const res = await settle({ from: "cheque", donor_email: "not-an-address" });

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/^donor_email: /);
  });

  test("a field the schema refuses is named in the refusal", async () => {
    // an admin holding a cheque needs to know which box was rejected, not that
    // something somewhere in the form was
    const res = await settle({ from: "cheque", net: "0" });

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/^net: /);
  });
});

describe("settlement create — a confirm sent twice", () => {
  const sttl_rows = () =>
    test_db.current!.db.select().from(donation_settlements);

  test.each([
    ["cheque", {}],
    ["daf", {}],
    ["stocks", {}],
    ["match", { for_donation_id: "" }],
  ] as const)(
    "a %s replayed under the same key settles once, and reports the success it already had",
    async (from, extra) => {
      const key = crypto.randomUUID();
      const first = await settle({ from, key, ...extra });
      expect(first).toEqual({ ok: true });
      const bal_after_first = await bal_tx_rows();
      vi.clearAllMocks();

      const replay = await settle({ from, key, ...extra });

      // ok, not a refusal: the money committed, and an admin told otherwise
      // goes back and previews again — under a new key, settling it twice
      expect(replay).toEqual({ ok: true, replayed: true });
      expect(await dons()).toHaveLength(1);
      expect(await sttl_rows()).toHaveLength(1);
      expect(await bal_tx_rows()).toEqual(bal_after_first);
      expect(enqueue).not.toHaveBeenCalled();
      expect(send_email).not.toHaveBeenCalled();
    }
  );

  test("a matched gift replayed under the same key mails the donor once", async () => {
    const gift = await seed_gift();
    const key = crypto.randomUUID();
    expect(await settle({ from: "match", for_donation_id: gift, key })).toEqual(
      { ok: true }
    );
    vi.clearAllMocks();

    const replay = await settle({ from: "match", for_donation_id: gift, key });

    expect(replay).toEqual({ ok: true, replayed: true });
    expect(send_email).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await sttl_rows()).toHaveLength(1);
  });

  test("two different keys are two settlements", async () => {
    expect(await settle({ key: crypto.randomUUID() })).toEqual({ ok: true });
    expect(await settle({ key: crypto.randomUUID() })).toEqual({ ok: true });

    expect(await dons()).toHaveLength(2);
    expect(await sttl_rows()).toHaveLength(2);
  });

  test("a key that is not a uuid is refused, and named", async () => {
    const res = await settle({ key: "not-a-uuid" });

    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/^idempotency_key: /);
    expect(await dons()).toHaveLength(0);
  });

  test("a page from before the key existed is told to reload, and writes nothing", async () => {
    const res = await settle({ key: null });

    expect(res).toEqual({
      ok: false,
      error: "This page is out of date. Reload it and confirm again.",
    });
    expect(await dons()).toHaveLength(0);
  });
});

describe("settlement create — fees on a manual settlement", () => {
  test("a fiscally sponsored nonprofit's cheque is charged on the net it settled", async () => {
    await test_db
      .current!.db.update(npos)
      .set({ fiscal_sponsored: true, hide_bg_tip: true })
      .where(eq(npos.id, npo_id));

    const res = await settle({ from: "cheque", net: "97.50" });

    expect(res).toEqual({ ok: true });
    const [dist] = await dist_rows();
    expect(dist!.fee_processing).toBe(0);
    expect(dist!.fee_fsa).toBeCloseTo(97.5 * 0.029, 10);
    expect(dist!.fee_base).toBeCloseTo(97.5 * 0.015, 10);
    expect(dist!.net).toBeCloseTo(97.5 * (1 - 0.029 - 0.015), 10);
  });
});
