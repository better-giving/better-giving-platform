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
import { encode_cursor } from "./helpers";
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
      (r) => r.o_name ?? null
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

describe("regs: cursor edge cases", () => {
  test("names with characters beyond Latin-1 page across the boundary under a name sort", async () => {
    const names = [
      "Children’s Fund",
      "Łódź Aid",
      "Café – Kenya",
      "日本 Relief",
      "Zeta",
    ];
    await test_db.current!.db.insert(registrations).values(
      Array.from({ length: 20 }, (_, i) => ({
        id: `reg-${String(i).padStart(2, "0")}`,
        r_id: `user-${i}`,
        status: "03" as const,
        // the 15th row of the page is always a wide-character name
        o_name: i < 14 ? `Alpha ${String(i).padStart(2, "0")}` : names[i - 14],
        updated_at: iso(i),
      }))
    );

    const pages = await all_pages({ sort_key: "o_name", sort_dir: "asc" });
    const ids = pages.flat();

    expect(new Set(ids).size).toBe(20);
    expect(pages).toHaveLength(2);
  });

  test("a malformed next is ignored, not an error", async () => {
    await seed_many(5);

    const page = await regs({ next: "%%%not-a-cursor" });

    expect(page.items).toHaveLength(5);
  });

  test("a cursor for another sort is ignored, not an error", async () => {
    await seed_many(30);
    const by_name = await regs({ sort_key: "o_name", sort_dir: "asc" });

    const page = await regs({ sort_key: "updated_at", next: by_name.next });

    expect(page.items.length).toBeGreaterThan(0);
  });

  test("a cursor made under another sort or direction starts the list over", async () => {
    await seed_many(40);
    const by_name = await regs({ sort_key: "o_name", sort_dir: "asc" });
    const newest_first = await regs();

    // another sort key
    const wrong_key = await regs({
      sort_key: "updated_at",
      next: by_name.next,
    });
    expect(wrong_key.items.map((r) => r.id)).toEqual(
      newest_first.items.map((r) => r.id)
    );
    // the same key flipped
    const flipped = await regs({
      sort_key: "o_name",
      sort_dir: "desc",
      next: by_name.next,
    });
    const desc_first = await regs({ sort_key: "o_name", sort_dir: "desc" });
    expect(flipped.items.map((r) => r.id)).toEqual(
      desc_first.items.map((r) => r.id)
    );
  });

  test.each([
    ["a number that reads as a date", "MQ"],
    ["an impossible timestamp", btoa("2026-13-45T99:99").replace(/=+$/, "")],
    [
      "text with a NUL",
      encode_cursor({ k: "o_name", d: "asc", v: "a\u0000b", i: "reg-001" })!,
    ],
    [
      "a keyset with a NUL id",
      encode_cursor({ k: "o_name", d: "asc", v: "a", i: "x\u0000" })!,
    ],
    [
      "a timestamp that is not one",
      encode_cursor({
        k: "updated_at",
        d: "desc",
        v: "2026-13-45T99:99",
        i: "r",
      })!,
    ],
  ])("an unreadable cursor (%s) starts the list over", async (_name, next) => {
    await seed_many(20);
    const first = await regs();

    const page = await regs({ next, sort_key: "updated_at" });

    expect(page.items.map((r) => r.id)).toEqual(first.items.map((r) => r.id));
  });

  describe("a legacy cursor's inferred status carries to later pages", () => {
    const legacy_cursor = (at: string) =>
      btoa(at).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const seed_mixed = async () => {
      await test_db.current!.db.insert(registrations).values(
        Array.from({ length: 60 }, (_, i) => ({
          id: `reg-${String(i).padStart(2, "0")}`,
          r_id: `user-${i}`,
          // two in three are under review, the rest every other status
          status: (i % 3 === 0
            ? (["01", "03", "04"] as const)[(i / 3) % 3]
            : "02") as "01" | "02" | "03" | "04",
          o_name: `Org ${i}`,
          updated_at: iso(i),
        }))
      );
    };

    test("a bare date with no status, then two more pages, stays under review on every page", async () => {
      await seed_mixed();
      const pages: Awaited<ReturnType<typeof regs>>["items"][] = [];
      let next: string | undefined = legacy_cursor(iso(-1));
      while (next && pages.length < 6) {
        const page = await regs({ next });
        pages.push(page.items);
        next = page.next;
      }

      expect(pages.length).toBeGreaterThanOrEqual(3);
      for (const items of pages) {
        for (const r of items) expect(r.status).toBe("02");
      }
      const ids = pages.flat().map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(40);
    });

    test("an explicit status with such a cursor uses the explicit one, on every page", async () => {
      await seed_mixed();
      const pages: string[][] = [];
      let next: string | undefined = legacy_cursor(iso(-1));
      while (next && pages.length < 6) {
        const page = await regs({ next, status: "" });
        pages.push(page.items.map((r) => r.status as string));
        next = page.next;
      }

      // every status, not just under review
      expect(new Set(pages.flat()).size).toBeGreaterThan(1);
      expect(pages.flat()).toHaveLength(60);
    });

    test("an explicit status wins over a legacy cursor, and a stale or unknown carried status never overrides it", async () => {
      await seed_mixed();

      const explicit = await regs({
        next: legacy_cursor(iso(-1)),
        status: "03",
      });
      expect(explicit.items.length).toBeGreaterThan(0);
      expect(explicit.items.every((r) => r.status === "03")).toBe(true);

      // a keyset cursor claiming under review, read for a request that asks for approved
      const carried = encode_cursor({
        k: "updated_at",
        d: "desc",
        v: iso(-1),
        i: "zzz",
        s: "02",
      });
      const asked = await regs({ next: carried, status: "03" });
      expect(asked.items.every((r) => r.status === "03")).toBe(true);

      // an unknown carried status is ignored: the list is unfiltered
      const unknown = encode_cursor({
        k: "updated_at",
        d: "desc",
        v: iso(-1),
        i: "zzz",
        s: "99",
      });
      const all = await regs({ next: unknown });
      expect(new Set(all.items.map((r) => r.status)).size).toBeGreaterThan(1);
    });

    test("a normal cursor carries no inferred status and the list stays unfiltered", async () => {
      await seed_mixed();
      const first = await regs();
      expect(
        JSON.parse(atob(first.next!.replace(/-/g, "+").replace(/_/g, "/")))
      ).not.toHaveProperty("s");

      const statuses = new Set<string>();
      let next: string | undefined = first.next;
      for (const r of first.items) statuses.add(r.status as string);
      while (next) {
        const page = await regs({ next });
        for (const r of page.items) statuses.add(r.status as string);
        next = page.next;
      }

      expect([...statuses].sort()).toEqual(["01", "02", "03", "04"]);
    });
  });

  test("a keyset cursor is followed under a filter that matches more than a page", async () => {
    await test_db.current!.db.insert(registrations).values(
      Array.from({ length: 20 }, (_, i) => ({
        id: `reg-k-${String(i).padStart(2, "0")}`,
        r_id: `user-k-${i}`,
        status: "03" as const,
        o_name: `Kenya Org ${i}`,
        o_hq_country: "Kenya",
        updated_at: iso(i),
      }))
    );

    const pages = await all_pages({
      status: "03",
      country: "Kenya",
      sort_key: "o_name",
    });

    expect(pages.map((p) => p.length)).toEqual([15, 5]);
    expect(new Set(pages.flat()).size).toBe(20);
  });

  test("a bare date cursor from an old tab keeps the old default: under review", async () => {
    await test_db.current!.db.insert(registrations).values([
      { id: "a", r_id: "u1", status: "02", updated_at: iso(3) },
      { id: "b", r_id: "u2", status: "03", updated_at: iso(4) },
      { id: "c", r_id: "u3", status: "02", updated_at: iso(5) },
    ]);
    const old_cursor = btoa(iso(2))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const page = await regs({ next: old_cursor });

    expect(page.items.map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("regs: filters", () => {
  test("a query that matches nothing returns an empty page", async () => {
    await seed_many(5);
    expect((await regs({ query: "zzzzzz" })).items).toEqual([]);
  });
});
