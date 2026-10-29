import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { Db } from "$/pg/db";
import { rate_limit_windows } from "$/pg/schema/rate-limit";
import { create_test_db, type TestDb } from "$/pg/test-utils/pglite";
import { limit_shared, reserve_shared } from "./rate-limit";

const as_db = (x: unknown) => x as Db;

let test_db: TestDb;
let conn: Db;

beforeAll(async () => {
  test_db = await create_test_db();
  conn = as_db(test_db.db);
}, 30_000);

afterAll(async () => {
  await test_db?.client.close();
});

beforeEach(async () => {
  await test_db.db.delete(rate_limit_windows);
  // Date only: pglite keeps its own timers
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const QUOTA = { max: 2, window_s: 600 };

describe("reserve_shared", () => {
  test("release hands one use back, once", async () => {
    const first = await reserve_shared("k", QUOTA, conn);
    expect(await reserve_shared("k", QUOTA, conn)).not.toBeNull();
    expect(await reserve_shared("k", QUOTA, conn)).toBeNull();

    await first!.release();
    await first!.release();

    expect(await reserve_shared("k", QUOTA, conn)).not.toBeNull();
    expect(await reserve_shared("k", QUOTA, conn)).toBeNull();
  });

  test("a new window starts empty", async () => {
    await reserve_shared("k", QUOTA, conn);
    await reserve_shared("k", QUOTA, conn);
    expect(await reserve_shared("k", QUOTA, conn)).toBeNull();

    vi.setSystemTime(new Date("2027-01-01T00:10:00.000Z"));

    expect(await reserve_shared("k", QUOTA, conn)).not.toBeNull();
  });

  test("a release after rollover leaves the new window's count alone", async () => {
    const old = await reserve_shared("k", QUOTA, conn);

    vi.setSystemTime(new Date("2027-01-01T00:10:00.000Z"));
    await reserve_shared("k", QUOTA, conn);
    await reserve_shared("k", QUOTA, conn);
    await old!.release();

    expect(await reserve_shared("k", QUOTA, conn)).toBeNull();
  });

  test("each key has its own count", async () => {
    await reserve_shared("a", QUOTA, conn);
    await reserve_shared("a", QUOTA, conn);

    expect(await reserve_shared("a", QUOTA, conn)).toBeNull();
    expect(await reserve_shared("b", QUOTA, conn)).not.toBeNull();
  });

  test("two instances share one count", async () => {
    const instance_a = as_db(drizzle(test_db.client));
    const instance_b = as_db(drizzle(test_db.client));
    const quota = { max: 20, window_s: 600 };

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        reserve_shared("shared", quota, i % 2 ? instance_a : instance_b)
      )
    );

    expect(results.filter((r) => r !== null)).toHaveLength(20);
    // the count lives in the table, not in either instance
    expect(
      await test_db.db
        .select({
          key: rate_limit_windows.key,
          count: rate_limit_windows.count,
        })
        .from(rate_limit_windows)
    ).toEqual([{ key: "shared", count: 20 }]);
    expect(await reserve_shared("shared", quota, instance_a)).toBeNull();
    expect(await reserve_shared("shared", quota, instance_b)).toBeNull();
  });
});

describe("limit_shared", () => {
  test("denies past max with the seconds left in the window", async () => {
    vi.setSystemTime(new Date("2027-01-01T00:01:40.250Z"));

    expect(await limit_shared("ip", QUOTA, conn)).toEqual({ ok: true });
    expect(await limit_shared("ip", QUOTA, conn)).toEqual({ ok: true });
    // 499.75s to 00:10:00, rounded up
    expect(await limit_shared("ip", QUOTA, conn)).toEqual({
      ok: false,
      retry_after_s: 500,
    });
  });
});

describe("expired-window sweep", () => {
  const rows = async () =>
    (await test_db.db.select().from(rate_limit_windows)).map((r) => r.key);

  async function ended_window_then_take() {
    await reserve_shared("old", QUOTA, conn);
    vi.setSystemTime(new Date("2027-01-01T00:10:00.000Z"));
    await reserve_shared("new", QUOTA, conn);
  }

  test("a sampled take deletes windows that have ended", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await ended_window_then_take();

    expect(await rows()).toEqual(["new"]);
  });

  test("an unsampled take leaves them", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await ended_window_then_take();

    expect((await rows()).sort()).toEqual(["new", "old"]);
  });

  test("a failed sweep still returns the reservation", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // the take's insert succeeds; the sweep's delete raises
    await test_db.client.exec(`
      create function fail_delete() returns trigger language plpgsql
        as $$ begin raise exception 'sweep refused'; end $$;
      create trigger fail_delete before delete on rate_limit_windows
        for each statement execute function fail_delete();
    `);
    try {
      expect(await reserve_shared("k", QUOTA, conn)).not.toBeNull();
      expect(log).toHaveBeenCalledOnce();
    } finally {
      await test_db.client.exec(`
        drop trigger fail_delete on rate_limit_windows;
        drop function fail_delete();
      `);
    }
  });
});
