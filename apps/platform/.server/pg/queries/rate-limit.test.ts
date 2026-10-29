import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { rate_limit_windows } from "../schema/rate-limit";
import { create_test_db, type TestDb } from "../test-utils/pglite";
import type { DbOrTx } from "./helpers";
import {
  rate_limit_release,
  rate_limit_sweep,
  rate_limit_take,
} from "./rate-limit";

const as_db = (x: unknown) => x as DbOrTx;

let test_db: TestDb;

beforeAll(async () => {
  test_db = await create_test_db();
}, 30_000);

afterAll(async () => {
  await test_db?.client.close();
});

beforeEach(async () => {
  await test_db.db.delete(rate_limit_windows);
});

const W1 = {
  start: "2027-01-01T00:00:00.000Z",
  end: "2027-01-01T00:10:00.000Z",
};

describe("rate_limit_take", () => {
  test("counts up to max, then denies without counting the denial", async () => {
    const take = () => rate_limit_take("k", W1, 2, as_db(test_db.db));

    expect(await take()).toBe(1);
    expect(await take()).toBe(2);
    expect(await take()).toBeNull();
    expect(await take()).toBeNull();

    // had either denial counted, one release would leave the window full
    await rate_limit_release("k", W1.start, as_db(test_db.db));
    expect(await take()).toBe(2);
  });
});

describe("rate_limit_sweep", () => {
  const W2 = {
    start: "2027-01-01T00:10:00.000Z",
    end: "2027-01-01T00:20:00.000Z",
  };

  test("deletes windows that have ended and keeps the live one", async () => {
    const conn = as_db(test_db.db);
    await rate_limit_take("old", W1, 5, conn);
    await rate_limit_take("old", W1, 5, conn);
    await rate_limit_take("live", W2, 5, conn);

    // W1's end, to the millisecond: an ended window, W2 still running
    expect(await rate_limit_sweep(W1.end, conn)).toBe(1);

    // a deleted row restarts at 1; the kept one carries on from its count
    expect(await rate_limit_take("old", W1, 5, conn)).toBe(1);
    expect(await rate_limit_take("live", W2, 5, conn)).toBe(2);
  });

  test("stops at its batch size", async () => {
    const conn = as_db(test_db.db);
    for (const key of ["a", "b", "c"]) await rate_limit_take(key, W1, 5, conn);

    expect(await rate_limit_sweep(W2.end, conn, 2)).toBe(2);
    expect(await rate_limit_sweep(W2.end, conn, 2)).toBe(1);
  });
});
