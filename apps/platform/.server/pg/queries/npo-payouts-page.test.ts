import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { npos } from "../schema/npo";
import { payouts } from "../schema/payout";
import { create_test_db, type TestDb } from "../test-utils/pglite";
import { encode_date_cursor } from "./helpers";
import { npo_payouts } from "./payout";

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
  await db.delete(npos);
  const [npo] = await db
    .insert(npos)
    .values({
      registration_number: "EIN-PAGE",
      name: "Page Test NPO",
      endow_designation: "Charity",
      overview_pt: "[]",
      hq_country: "United States",
    })
    .returning();
  npo_id = npo!.id;
});

const seed = (ids: string[], date: string) =>
  test_db.db.insert(payouts).values(
    ids.map((id) => ({
      id,
      source_id: `liq-${id}`,
      npo_id,
      source: "liq" as const,
      date,
      amount: 5,
      type: "pending" as const,
    }))
  );

async function all_pages(limit: number) {
  const seen: string[] = [];
  let next: string | undefined;
  do {
    const page = await npo_payouts(npo_id, { limit, next });
    seen.push(...page.items.map((p) => p.id));
    next = page.next;
  } while (next);
  return seen;
}

describe("npo_payouts paging", () => {
  test("a settlement batch sharing one date pages through whole", async () => {
    // one settlement stamps every payout in it with the same date
    await seed(
      ["b1", "b2", "b3", "b4", "b5", "b6", "b7"],
      "2026-07-01T00:00:00.000Z"
    );

    const seen = await all_pages(5);

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  test("a tie at the page edge carries over before older dates", async () => {
    await seed(["n1", "n2", "n3"], "2026-07-02T00:00:00.000Z");
    await seed(["o1", "o2"], "2026-07-01T00:00:00.000Z");

    const seen = await all_pages(2);

    expect(seen).toEqual(["n3", "n2", "n1", "o2", "o1"]);
  });

  test("a date-only cursor an older page still holds pages strictly older rows", async () => {
    await seed(["n1"], "2026-07-02T00:00:00.000Z");
    await seed(["o1"], "2026-07-01T00:00:00.000Z");

    const page = await npo_payouts(npo_id, {
      next: encode_date_cursor("2026-07-02T00:00:00.000Z"),
    });

    expect(page.items.map((p) => p.id)).toEqual(["o1"]);
  });
});
