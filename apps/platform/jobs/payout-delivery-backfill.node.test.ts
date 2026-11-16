import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "$/pg/test-utils/pglite";

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

const { run, target_for } = await import("./payout-delivery-backfill");
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { npos } = await import("$/pg/schema/npo");
const { payouts, settlements } = await import("$/pg/schema/payout");

const NOW = Date.parse("2026-11-16T00:00:00.000Z");
let npo_id = 0;
const db = () => test_db.current!.db;

beforeAll(async () => {
  test_db.current = await create_test_db();
  const [npo] = await db()
    .insert(npos)
    .values({
      registration_number: "EIN-BF-1",
      name: "Backfill Org",
      slug: "backfill-org",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  npo_id = npo!.id;
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await db().delete(payouts);
  await db().delete(settlements);
});

const seed = async (
  id: string,
  status: string,
  o: { other_id?: string | null; date?: string; payout_type?: string } = {}
) => {
  await db()
    .insert(settlements)
    .values({
      id,
      other_id: o.other_id === undefined ? `ref-${id}` : o.other_id,
      npo_id,
      date: o.date ?? "2026-11-11T00:00:00.000Z",
      amount: 100,
      status,
    });
  await db()
    .insert(payouts)
    .values({
      id: `p-${id}`,
      source_id: `d-${id}`,
      npo_id,
      source: "donation",
      date: "2026-11-01T00:00:00.000Z",
      amount: 100,
      type: (o.payout_type ?? "settled") as "settled",
      settled_id: id,
      settled_date: "2026-11-11T00:00:00.000Z",
    });
};

const types = async () =>
  Object.fromEntries(
    (await db().select().from(payouts)).map((p) => [p.id, p.type])
  );

describe("target_for", () => {
  it.each([
    ["outgoing_payment_sent", null],
    ["returned", null],
    ["awaiting_repair", null],
    ["processing", "processing"],
    ["funds_converted", "processing"],
    ["bounced_back", "bounced"],
    ["cancelled", "bounced"],
    ["charged_back", "bounced"],
    ["something_new", "bounced"],
  ])("state %s", (state, to) => {
    expect(target_for(state, "2026-11-11T00:00:00.000Z", NOW)).toBe(to);
  });

  it("a run is processing or bounced inside the poll window and stale outside it, whatever its state", () => {
    expect(target_for("", "2026-11-11T00:00:00.000Z", NOW)).toBe("processing");
    for (const state of ["", "processing", "bounced_back"]) {
      expect(target_for(state, "2026-01-01T00:00:00.000Z", NOW)).toBe("stale");
    }
    // delivered history stays settled however old
    expect(
      target_for("outgoing_payment_sent", "2026-01-01T00:00:00.000Z", NOW)
    ).toBeNull();
  });
});

describe("run", () => {
  const seed_all = async () => {
    await seed("t-sent", "outgoing_payment_sent");
    await seed("t-flight", "funds_converted");
    await seed("t-bounce", "bounced_back");
    await seed("t-returned", "returned", { payout_type: "returned" });
    await seed("t-recovered", "", { other_id: null });
    await seed("t-old", "", { date: "2026-01-01T00:00:00.000Z" });
    await seed("t-old-bounce", "bounced_back", {
      date: "2026-01-01T00:00:00.000Z",
    });
  };

  it("a dry run lists what it would change and writes nothing", async () => {
    await seed_all();
    const lines: string[] = [];

    const sum = await run({ commit: false, now: NOW }, { log: (l) => lines.push(l) });

    expect(await types()).toEqual({
      "p-t-sent": "settled",
      "p-t-flight": "settled",
      "p-t-bounce": "settled",
      "p-t-returned": "returned",
      "p-t-recovered": "settled",
      "p-t-old": "settled",
      "p-t-old-bounce": "settled",
    });
    expect(sum).toMatchObject({
      to_change: 2,
      changed: 0,
      stale: 2,
      bounced_npos: [npo_id],
    });
    const changes = lines
      .filter((l) => l.startsWith("{") && l.includes('"to"'))
      .map((l) => JSON.parse(l))
      .sort((a, b) => a.payout_id.localeCompare(b.payout_id));
    expect(changes).toEqual([
      {
        payout_id: "p-t-bounce",
        npo_id,
        settlement_id: "t-bounce",
        state: "bounced_back",
        from: "settled",
        to: "bounced",
        amount: 100,
      },
      {
        payout_id: "p-t-flight",
        npo_id,
        settlement_id: "t-flight",
        state: "funds_converted",
        from: "settled",
        to: "processing",
        amount: 100,
      },
    ]);
  });

  it("a commit keeps delivered history settled, moves in-flight and bounced runs, and a rerun changes nothing", async () => {
    await seed_all();

    const first = await run({ commit: true, now: NOW }, { log: () => {} });
    expect(first).toMatchObject({ to_change: 2, changed: 2 });
    expect(await types()).toEqual({
      "p-t-sent": "settled",
      "p-t-flight": "processing",
      "p-t-bounce": "bounced",
      "p-t-returned": "returned",
      "p-t-recovered": "settled",
      "p-t-old": "settled",
      "p-t-old-bounce": "settled",
    });

    const second = await run({ commit: true, now: NOW }, { log: () => {} });
    expect(second).toMatchObject({ to_change: 0, changed: 0 });
  });
});
