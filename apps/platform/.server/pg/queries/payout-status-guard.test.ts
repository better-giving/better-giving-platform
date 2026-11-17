import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { IPayout } from "@/payouts";
import { npos } from "../schema/npo";
import { payouts, settlements } from "../schema/payout";
import { create_test_db, type TestDb } from "../test-utils/pglite";
import type { DbOrTx } from "./helpers";
import {
  npo_returned_payouts,
  payout_get,
  payout_mark_refunded_loss,
  payout_move_from_unsent,
  pending_payouts_locked,
  processing_payouts,
} from "./payout";

// pglite's drizzle handle differs from neon's only in the result-type HKT,
// which these queries do not read.
const as_db = (x: unknown) => x as DbOrTx;

// the module-level db the unscoped readers use
const current = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({
  db: new Proxy(
    {},
    { get: (_, prop) => (current.db as Record<PropertyKey, unknown>)[prop] }
  ),
}));

let test_db: TestDb;
let npo_id: number;

beforeAll(async () => {
  test_db = await create_test_db();
  current.db = test_db.db;
}, 30_000);

afterAll(async () => {
  await test_db?.client.close();
});

beforeEach(async () => {
  const db = test_db.db;
  await db.delete(payouts);
  await db.delete(settlements);
  await db.delete(npos);
  const [npo] = await db
    .insert(npos)
    .values({
      registration_number: "EIN-PAYOUT",
      name: "Payout Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  npo_id = npo!.id;
});

async function seed_payout(
  id: string,
  type: "pending" | "processing" | "settled" | "refunded" | "returned" | "void"
) {
  if (type === "settled") {
    await test_db.db.insert(settlements).values({
      id: `sttl-${id}`,
      npo_id,
      date: "2026-09-02T00:00:00.000Z",
      amount: 100,
      status: "",
    });
  }
  await test_db.db.insert(payouts).values({
    id,
    source_id: `dist-${id}`,
    npo_id,
    source: "donation",
    date: "2026-09-01T00:00:00.000Z",
    amount: 100,
    type,
    ...(type === "settled" && {
      settled_date: "2026-09-02T00:00:00.000Z",
      settled_id: `sttl-${id}`,
    }),
  });
}

async function type_of(id: string) {
  const [row] = await test_db.db
    .select({ type: payouts.type })
    .from(payouts)
    .where(eq(payouts.id, id));
  return row?.type;
}

const to_refunded = { type: "refunded" } as Partial<Omit<IPayout, "id">>;

describe("payout_move_from_unsent", () => {
  test.each(["pending", "returned"] as const)(
    "moves a %s payout and reports the change",
    async (type) => {
      await seed_payout("p1", type);

      const changed = await payout_move_from_unsent(
        as_db(test_db.db),
        "p1",
        to_refunded
      );

      expect(changed).toBe(true);
      expect(await type_of("p1")).toBe("refunded");
    }
  );

  test.each(["settled", "refunded", "void"] as const)(
    "leaves a %s payout untouched and reports no change",
    async (type) => {
      await seed_payout("p1", type);

      const changed = await payout_move_from_unsent(as_db(test_db.db), "p1", {
        type: "cancelled",
      } as Partial<Omit<IPayout, "id">>);

      expect(changed).toBe(false);
      expect(await type_of("p1")).toBe(type);
    }
  );
});

describe("payout_mark_refunded_loss", () => {
  test.each(["processing", "settled"] as const)(
    "marks a %s payout, its grant gone out",
    async (type) => {
      await seed_payout("p1", type);

      expect(await payout_mark_refunded_loss(as_db(test_db.db), "p1")).toBe(
        true
      );
      expect(await type_of("p1")).toBe("refunded_loss");
    }
  );

  test.each(["pending", "returned", "void"] as const)(
    "leaves a %s payout, its cash not paid out, and reports no change",
    async (type) => {
      await seed_payout("p1", type);

      expect(await payout_mark_refunded_loss(as_db(test_db.db), "p1")).toBe(
        false
      );
      expect(await type_of("p1")).toBe(type);
    }
  );
});

describe("pending_payouts_locked", () => {
  test("returns only the pending payouts among the ids given", async () => {
    await seed_payout("given-pending", "pending");
    await seed_payout("given-settled", "settled");
    await seed_payout("given-refunded", "refunded");
    await seed_payout("other-pending", "pending");

    const locked = await test_db.db.transaction((tx) =>
      pending_payouts_locked(as_db(tx), [
        "given-pending",
        "given-settled",
        "given-refunded",
        "missing",
      ])
    );

    expect(locked.map((p) => [p.id, p.type])).toEqual([
      ["given-pending", "pending"],
    ]);
  });

  test("locks and returns rows in id order whatever order the ids came in", async () => {
    for (const id of ["p-c", "p-a", "p-b"]) await seed_payout(id, "pending");

    const locked = await test_db.db.transaction((tx) =>
      pending_payouts_locked(as_db(tx), ["p-c", "p-a", "p-b"])
    );

    expect(locked.map((p) => p.id)).toEqual(["p-a", "p-b", "p-c"]);
  });

  // a row lock stamps the locker's xid into xmax; a plain read leaves it 0
  test("holds the returned rows locked by the calling transaction", async () => {
    await seed_payout("p1", "pending");

    const [row] = await test_db.db.transaction(async (tx) => {
      await pending_payouts_locked(as_db(tx), ["p1"]);
      return tx
        .select({
          xmax: sql<string>`xmax::text`,
          xid: sql<string>`pg_current_xact_id()::text`,
        })
        .from(payouts)
        .where(eq(payouts.id, "p1"));
    });

    expect(row!.xmax).toBe(row!.xid);
  });
});

describe("payout_get", () => {
  test("reads a processing payout as processing, not pending", async () => {
    await seed_payout("p1", "processing");

    const po = await payout_get("p1");

    expect(po?.type).toBe("processing");
  });

  test.each(["returned", "void"] as const)(
    "reads a %s payout as %s, not pending",
    async (type) => {
      await seed_payout("p1", type);

      const po = await payout_get("p1");

      expect(po?.type).toBe(type);
    }
  );
});

describe("processing_payouts", () => {
  test("returns every processing payout and nothing else", async () => {
    await seed_payout("p-pending", "pending");
    await seed_payout("p-proc-b", "processing");
    await seed_payout("p-settled", "settled");
    await seed_payout("p-proc-a", "processing");

    const rows = await processing_payouts();

    expect(rows.map((p) => [p.id, p.type, p.npo_id, p.date])).toEqual([
      ["p-proc-a", "processing", npo_id, "2026-09-01T00:00:00.000Z"],
      ["p-proc-b", "processing", npo_id, "2026-09-01T00:00:00.000Z"],
    ]);
  });
});

describe("npo_returned_payouts", () => {
  test("null when the npo has no returned payout waiting for a new account", async () => {
    await seed_payout("p-pending", "pending");
    await seed_payout("p-settled", "settled");
    await seed_payout("p-void", "void");

    expect(await npo_returned_payouts(npo_id)).toBeNull();
  });

  test("counts and sums only the npo's returned payouts, dated by the latest", async () => {
    await seed_payout("p-r1", "returned");
    await seed_payout("p-r2", "returned");
    await seed_payout("p-pending", "pending");
    await test_db.db
      .update(payouts)
      .set({ amount: 25.5, date: "2026-10-02T00:00:00.000Z" })
      .where(eq(payouts.id, "p-r2"));
    const [other] = await test_db.db
      .insert(npos)
      .values({
        registration_number: "EIN-OTHER",
        name: "Other NPO",
        endow_designation: "Charity",
        overview_pt: "[]",
        hq_country: "United States",
      })
      .returning();
    await test_db.db.insert(payouts).values({
      id: "p-other",
      source_id: "dist-other",
      npo_id: other!.id,
      source: "donation",
      date: "2026-11-01T00:00:00.000Z",
      amount: 999,
      type: "returned",
    });

    expect(await npo_returned_payouts(npo_id)).toEqual({
      count: 2,
      total: 125.5,
      latest_date: "2026-10-02T00:00:00.000Z",
    });
  });
});
