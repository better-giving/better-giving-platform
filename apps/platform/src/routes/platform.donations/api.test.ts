import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
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

import { donations } from "$/pg/schema/donation";
import { create_test_db } from "$/pg/test-utils/pglite";
import { loader } from "./api";

// one row per (status, via); ids are "<status>|<via>"
const ROWS: [string, string][] = [
  ["settled", "stripe:card"],
  ["settled", "stripe"],
  ["settled", "paypal:paypal"],
  ["settled", "venmo"],
  ["settled", "chariot"],
  ["settled", "daf"],
  ["settled", "crypto:eth"],
  ["settled", "stocks"],
  ["settled", "match"],
  ["settled", "cash"],
  ["settled", "unknown"],
  ["settled", "wire:weird"],
  ["intent", "crypto:eth"],
  ["confirmed", "crypto:eth"],
  ["created", "stripe:card"],
  ["refunded", "stripe:card"],
  ["refunded_loss", "paypal:paypal"],
  ["failed", "crypto:bnb"],
  ["expired", "crypto:hbar"],
  ["cancelled", "chariot"],
];

beforeAll(async () => {
  test_db.current = await create_test_db();
  await test_db.current.db.insert(donations).values(
    ROWS.map(([status, via], i) => ({
      id: `${status}|${via}`,
      upusd: 1,
      status,
      amount_base: 1,
      amount_tip: 0,
      amount_fee_allowance: 0,
      currency: "USD",
      frequency: "one-time",
      source: "bg-marketplace",
      via,
      created_at: new Date(2026, 0, 1, 0, i).toISOString(),
    }))
  );
}, 30_000);

afterAll(async () => {
  await test_db.current?.client.close();
});

const ids = async (qs: string) => {
  const r = await loader({
    url: new URL(`http://x/platform/donations${qs}`),
  } as any);
  return r.items.map((i) => i.id).sort();
};

const where = (pred: (status: string, via: string) => boolean) =>
  ROWS.filter(([s, v]) => pred(s, v))
    .map(([s, v]) => `${s}|${v}`)
    .sort();

describe("status filter", () => {
  test("the default lists settled only", async () => {
    expect(await ids("")).toEqual(where((s) => s === "settled"));
  });

  test.each([
    ["settled", ["settled"]],
    ["awaiting", ["intent", "confirmed"]],
    ["unpaid", ["created"]],
    ["refunded", ["refunded", "refunded_loss"]],
    ["failed", ["failed"]],
    ["closed", ["expired", "cancelled"]],
  ])("?status=%s", async (v, statuses) => {
    expect(await ids(`?status=${v}`)).toEqual(
      where((s) => statuses.includes(s))
    );
  });

  test("all lists every status", async () => {
    expect(await ids("?status=all")).toEqual(where(() => true));
  });

  test("an unknown value falls back to settled", async () => {
    expect(await ids("?status=bogus")).toEqual(await ids(""));
    expect(await ids("?status=")).toEqual(await ids(""));
  });

  test("a list is the union of its groups", async () => {
    expect(await ids("?status=awaiting,failed")).toEqual(
      where((s) => ["intent", "confirmed", "failed"].includes(s))
    );
    expect(await ids("?status=settled,refunded,closed")).toEqual(
      where((s) =>
        [
          "settled",
          "refunded",
          "refunded_loss",
          "expired",
          "cancelled",
        ].includes(s)
      )
    );
  });

  test("every group named is every status", async () => {
    expect(
      await ids("?status=settled,awaiting,unpaid,refunded,failed,closed")
    ).toEqual(where(() => true));
  });

  test("unknown values in a list are dropped", async () => {
    expect(await ids("?status=failed,bogus")).toEqual(
      where((s) => s === "failed")
    );
  });
});

describe("method filter", () => {
  const groups: Record<string, (v: string) => boolean> = {
    stripe: (v) => v === "stripe" || v.startsWith("stripe:"),
    paypal: (v) => v.startsWith("paypal") || v === "venmo",
    daf: (v) => v.startsWith("chariot") || v === "daf",
    crypto: (v) => v.startsWith("crypto:"),
    stocks: (v) => v === "stocks",
    match: (v) => v === "match",
  };

  test.each(Object.keys(groups))("?method=%s", async (m) => {
    expect(await ids(`?status=all&method=${m}`)).toEqual(
      where((_, v) => groups[m]!(v))
    );
  });

  test("other is every via outside the named groups", async () => {
    const got = await ids("?status=all&method=other");
    expect(got).toEqual(
      where((_, v) => !Object.values(groups).some((g) => g(v)))
    );
    expect(got).toEqual(
      ["settled|cash", "settled|unknown", "settled|wire:weird"].sort()
    );
  });

  test("an unknown value falls back to all", async () => {
    expect(await ids("?status=all&method=bogus")).toEqual(
      await ids("?status=all")
    );
  });

  test("a list is the OR of its predicates", async () => {
    expect(await ids("?status=all&method=stripe,crypto")).toEqual(
      where((_, v) => groups.stripe!(v) || groups.crypto!(v))
    );
    expect(await ids("?status=all&method=paypal,daf,match")).toEqual(
      where((_, v) => groups.paypal!(v) || groups.daf!(v) || groups.match!(v))
    );
  });

  test("other beside a group keeps both", async () => {
    expect(await ids("?status=all&method=match,other")).toEqual(
      where(
        (_, v) => groups.match!(v) || !Object.values(groups).some((g) => g(v))
      )
    );
  });

  test("an empty list, all, or every method applies no filter", async () => {
    const every = await ids("?status=all");
    expect(await ids("?status=all&method=")).toEqual(every);
    expect(await ids("?status=all&method=all")).toEqual(every);
    expect(
      await ids(
        "?status=all&method=stripe,paypal,daf,crypto,stocks,match,other"
      )
    ).toEqual(every);
  });

  test("unknown values in a list are dropped", async () => {
    expect(await ids("?status=all&method=stocks,bogus")).toEqual(
      where((_, v) => groups.stocks!(v))
    );
  });

  test("status and method combine", async () => {
    expect(await ids("?status=awaiting&method=crypto")).toEqual(
      ["confirmed|crypto:eth", "intent|crypto:eth"].sort()
    );
    expect(await ids("?status=failed&method=match")).toEqual([]);
  });
});
