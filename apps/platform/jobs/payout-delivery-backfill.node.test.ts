import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TestDb } from "$/pg/test-utils/pglite";

// the job opens its own connection and loads no app env, so the test hands it
// a pglite database and mocks nothing
const test_db = { current: null as TestDb | null };

const { bounced_admitted, run, target_for } = await import(
  "./payout-delivery-backfill"
);
const { create_test_db } = await import("$/pg/test-utils/pglite");
const { npos } = await import("$/pg/schema/npo");
const { payouts, settlements } = await import("$/pg/schema/payout");

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
    ["charged_back", "bounced"],
    // stored before wise's own states were kept, and a manual cancel: history
    ["settled", null],
    // paid by another route: delivered, never touched
    ["paid", null],
    ["cancelled", null],
    ["something_new", "bounced"],
  ])("state %s", (state, to) => {
    expect(target_for(state)).toBe(to);
  });

  it("age plays no part: an old open run moves on like a new one, delivered history stays", () => {
    expect(target_for("")).toBe("processing");
    expect(target_for("bounced_back")).toBe("bounced");
    expect(target_for("outgoing_payment_sent")).toBeNull();
  });
});

describe("the deploy-order guard", () => {
  const without_bounced = async () => {
    await db().execute(
      sql`alter table payouts drop constraint type_check`
    );
    await db().execute(
      sql`alter table payouts add constraint type_check check (type in ('pending','processing','settled','error','refunded','refunded_loss','cancelled','returned','void'))`
    );
  };
  const with_bounced = async () => {
    await db().execute(sql`alter table payouts drop constraint type_check`);
    await db().execute(
      sql`alter table payouts add constraint type_check check (type in ('pending','processing','settled','error','refunded','refunded_loss','cancelled','returned','bounced','void'))`
    );
  };

  it("sees whether the payouts type check admits bounced", async () => {
    expect(await bounced_admitted(db() as never)).toBe(true);
    await without_bounced();
    try {
      expect(await bounced_admitted(db() as never)).toBe(false);
    } finally {
      await with_bounced();
    }
  });

  it("refuses --commit before migration 0081, writes nothing, and a dry run still lists and says so first", async () => {
    await seed("t-flight", "funds_converted");
    await without_bounced();
    try {
      await expect(run({ commit: true }, { db: db() as never, log: () => {} })).rejects.toThrow(
        /0081/
      );
      expect(await types()).toEqual({ "p-t-flight": "settled" });
      const lines: string[] = [];
      await run({ commit: false }, { db: db() as never, log: (l) => lines.push(l) });
      expect(lines[0]).toMatch(/does not admit 'bounced'.*0081/);
    } finally {
      await with_bounced();
    }
  });

  it("says at the top of its output that the check admits bounced", async () => {
    const lines: string[] = [];
    await run({ commit: false }, { db: db() as never, log: (l) => lines.push(l) });
    expect(lines[0]).toMatch(/admits 'bounced'/);
  });
});

describe("run", () => {
  const seed_all = async () => {
    await seed("t-sent", "outgoing_payment_sent");
    await seed("t-flight", "funds_converted");
    await seed("t-bounce", "bounced_back");
    await seed("t-returned", "returned", { payout_type: "returned" });
    await seed("t-recovered", "", { other_id: null });
    // blank-status and bounced runs of any age move on: the poll resolves them
    await seed("t-old", "", { date: "2026-01-01T00:00:00.000Z" });
    await seed("t-old-bounce", "bounced_back", {
      date: "2026-01-01T00:00:00.000Z",
    });
    await seed("t-legacy", "settled", { date: "2026-03-01T00:00:00.000Z" });
    await seed("t-cancel", "cancelled");
    await seed("t-paid", "paid", { date: "2026-02-01T00:00:00.000Z" });
  };

  it("a dry run lists what it would change and writes nothing", async () => {
    await seed_all();
    const lines: string[] = [];

    const sum = await run({ commit: false }, { db: db() as never, log: (l) => lines.push(l) });

    expect(await types()).toEqual({
      "p-t-sent": "settled",
      "p-t-flight": "settled",
      "p-t-bounce": "settled",
      "p-t-returned": "returned",
      "p-t-recovered": "settled",
      "p-t-old": "settled",
      "p-t-old-bounce": "settled",
      "p-t-legacy": "settled",
      "p-t-cancel": "settled",
      "p-t-paid": "settled",
    });
    expect(sum).toMatchObject({
      to_change: 4,
      changed: 0,
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
      {
        payout_id: "p-t-old",
        npo_id,
        settlement_id: "t-old",
        state: "",
        from: "settled",
        to: "processing",
        amount: 100,
      },
      {
        payout_id: "p-t-old-bounce",
        npo_id,
        settlement_id: "t-old-bounce",
        state: "bounced_back",
        from: "settled",
        to: "bounced",
        amount: 100,
      },
    ]);
  });

  it("a commit keeps delivered history settled, moves in-flight and bounced runs, and a rerun changes nothing", async () => {
    await seed_all();

    const first = await run({ commit: true }, { db: db() as never, log: () => {} });
    expect(first).toMatchObject({ to_change: 4, changed: 4 });
    const rows = Object.fromEntries(
      (await db().select().from(payouts)).map((p) => [p.id, p])
    );
    // processing keeps the run's ref and has no settled date; bounced has no ref
    expect(rows["p-t-flight"]).toMatchObject({
      message: "ref-t-flight",
      settled_date: null,
      settled_id: "t-flight",
    });
    expect(rows["p-t-bounce"]).toMatchObject({
      message: null,
      settled_id: "t-bounce",
    });
    expect(await types()).toEqual({
      "p-t-sent": "settled",
      "p-t-flight": "processing",
      "p-t-bounce": "bounced",
      "p-t-returned": "returned",
      "p-t-recovered": "settled",
      "p-t-old": "processing",
      "p-t-old-bounce": "bounced",
      "p-t-legacy": "settled",
      "p-t-cancel": "settled",
      "p-t-paid": "settled",
    });

    const second = await run({ commit: true }, { db: db() as never, log: () => {} });
    expect(second).toMatchObject({ to_change: 0, changed: 0 });
  });
});
