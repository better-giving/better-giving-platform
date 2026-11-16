import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
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

import { registrations } from "../schema/registration";
import { create_test_db } from "../test-utils/pglite";
import { regs } from "./registration";

const iso = (days_ago: number) =>
  new Date(
    Date.parse("2026-11-16T12:00:00.000Z") - days_ago * 86_400_000
  ).toISOString();

beforeAll(async () => {
  test_db.current = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

beforeEach(async () => {
  await test_db.current!.db.delete(registrations);
});

/** every page of a search, following `next` */
async function all_pages(opts: Parameters<typeof regs>[0] = {}) {
  const pages: string[][] = [];
  let next: string | undefined;
  do {
    const page = await regs({ ...opts, next });
    pages.push(page.items.map((r) => r.id));
    next = page.next;
  } while (next && pages.length < 20);
  return pages;
}

const seed_many = async (n: number) => {
  const statuses = ["01", "02", "03", "04"] as const;
  const countries = ["Algeria", "Canada", null, "Kenya"];
  await test_db.current!.db.insert(registrations).values(
    Array.from({ length: n }, (_, i) => ({
      id: `reg-${String(i).padStart(3, "0")}`,
      r_id: `user-${i}`,
      status: statuses[i % 4],
      // names repeat, and some are missing: ties and nulls both page
      o_name: i % 7 === 0 ? null : `Org ${i % 5}`,
      o_hq_country: countries[i % 4],
      created_at: iso(i),
      // pairs share a time, so the id has to break the tie
      updated_at: iso(Math.floor(i / 2)),
    }))
  );
};

describe("regs: no status shows every status, newest first", () => {
  test("an absent status returns all rows by updated_at desc", async () => {
    await test_db.current!.db.insert(registrations).values([
      { id: "a", r_id: "u1", status: "01", o_name: "A", updated_at: iso(5) },
      { id: "b", r_id: "u2", status: "02", o_name: "B", updated_at: iso(3) },
      { id: "c", r_id: "u3", status: "03", o_name: "C", updated_at: iso(1) },
      { id: "d", r_id: "u4", status: "04", o_name: "D", updated_at: iso(2) },
    ]);

    const { items } = await regs();

    expect(items.map((r) => r.id)).toEqual(["c", "d", "b", "a"]);
  });

  test("an explicit empty status is the same view, and a status still filters", async () => {
    await test_db.current!.db.insert(registrations).values([
      { id: "a", r_id: "u1", status: "02", updated_at: iso(2) },
      { id: "b", r_id: "u2", status: "03", updated_at: iso(1) },
    ]);

    expect((await regs({ status: "" })).items).toHaveLength(2);
    expect((await regs({ status: "02" })).items.map((r) => r.id)).toEqual([
      "a",
    ]);
  });
});

describe("regs: every sort pages without repeating or skipping a row", () => {
  test.each([
    ["status", "desc"],
    ["status", "asc"],
    ["o_name", "desc"],
    ["o_name", "asc"],
    ["o_hq_country", "desc"],
    ["o_hq_country", "asc"],
    ["updated_at", "desc"],
    ["updated_at", "asc"],
  ] as const)("sort_key %s %s", async (sort_key, sort_dir) => {
    await seed_many(40);

    const pages = await all_pages({ sort_key, sort_dir });
    const ids = pages.flat();

    // page 2 shares no id with page 1, and nothing is lost
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[1]!.filter((id) => pages[0]!.includes(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(40);
  });

  test("a status-sorted second page continues the order, nulls last", async () => {
    await seed_many(40);

    const first = await regs({ sort_key: "o_name", sort_dir: "asc" });
    const second = await regs({
      sort_key: "o_name",
      sort_dir: "asc",
      next: first.next,
    });
    const names: (string | null)[] = [...first.items, ...second.items].map(
      (r) => r.o_name
    );

    const present = names.filter((n) => n !== null);
    expect(present).toEqual([...present].sort());
    // once a null appears, only nulls follow
    const first_null = names.indexOf(null);
    if (first_null >= 0) {
      expect(names.slice(first_null).every((n) => n === null)).toBe(true);
    }
  });

  test("filters narrow every page: country and status together", async () => {
    await seed_many(60);

    const ids = (
      await all_pages({ status: "01", country: "Algeria", sort_key: "status" })
    ).flat();
    const rows = (await regs({ status: "01", country: "Algeria" })).items;

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of rows) {
      expect(r.status).toBe("01");
      expect(r.o_hq_country).toBe("Algeria");
    }
  });

  test("a cursor from before keyset paging (a bare date) still pages the newest-first view", async () => {
    await seed_many(20);
    const first = await regs();
    const last = first.items[first.items.length - 1]!;
    const old_cursor = btoa(last.updated_at!)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const page = await regs({ next: old_cursor });

    expect(page.items.every((r) => r.updated_at! < last.updated_at!)).toBe(
      true
    );
  });
});

describe("regs: filters", () => {
  test("a query that matches nothing returns an empty page", async () => {
    await seed_many(5);
    expect((await regs({ query: "zzzzzz" })).items).toEqual([]);
  });
});
