import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IOwed } from "../pg/queries/owed";

const { store, report_error } = vi.hoisted(() => ({
  // rows as the database holds them, by its own column names
  store: {
    npos: [] as Record<string, unknown>[],
    users: [] as Record<string, unknown>[],
    fail: false,
  },
  report_error: vi.fn(),
}));

vi.mock("../env", () => ({ base_url: "https://app.test" }));
vi.mock("#/errors/report", () => ({ report_error }));
// a select answers with the columns it asked for, under the keys it chose, so
// a lookup that reads a column it never selected, or the wrong one, finds nothing
vi.mock("../pg/db", async () => {
  const { npos } = await import("../pg/schema/npo");
  const { user } = await import("../pg/schema/auth");
  return {
    db: {
      select: (cols: Record<string, { name: string }>) => ({
        from: (table: unknown) => ({
          where: async () => {
            if (store.fail) throw new Error("db down");
            const rows =
              table === npos ? store.npos : table === user ? store.users : [];
            return rows.map((row) =>
              Object.fromEntries(
                Object.entries(cols).map(([key, col]) => [key, row[col.name]])
              )
            );
          },
        }),
      }),
    },
  };
});

import {
  alert_date,
  alert_deadline,
  amount_label,
  owed_table,
  recipient_name,
} from "./alert";

const owed = (o: Partial<IOwed>): IOwed =>
  ({
    npo_id: null,
    referrer_user: null,
    referrer_npo: null,
    received_usd: 4,
    fee_processing_usd: 0.5,
    fee_dispute_usd: 0,
    ...o,
  }) as IOwed;

const parties = async (rows: IOwed[]) =>
  (await owed_table(rows)).rows.map((r) => r[0]);

beforeEach(() => {
  store.npos = [];
  store.users = [];
  store.fail = false;
  report_error.mockReset();
});

describe("owed_table", () => {
  test("names each party and totals what is owed", async () => {
    store.npos = [
      { id: 4, name: "Save the Kids", referral_id: null },
      { id: 9, name: "Helpers", referral_id: "REF-N" },
    ];
    store.users = [{ referral_code: "REF-U", name: "Una User" }];
    const t = await owed_table([
      owed({ npo_id: 4 }),
      owed({ referrer_npo: "REF-N" }),
      owed({ referrer_user: "REF-U" }),
    ]);
    expect(t.rows).toEqual([
      ["Save the Kids (#4)", "4.00", "0.50", "0.00", "4.50"],
      ["Helpers (referrer)", "4.00", "0.50", "0.00", "4.50"],
      ["Una User (referrer)", "4.00", "0.50", "0.00", "4.50"],
      ["Total", "—", "—", "—", "13.50"],
    ]);
  });

  test("falls back to ids when a name is missing", async () => {
    expect(
      await parties([
        owed({ npo_id: 4 }),
        owed({ referrer_npo: "REF-N" }),
        owed({ referrer_user: "REF-U" }),
      ])
    ).toEqual(["#4", "npo REF-N (referrer)", "user REF-U (referrer)", "Total"]);
  });

  test("keeps the table, with ids, when the name lookup fails", async () => {
    store.fail = true;
    expect(await parties([owed({ npo_id: 4 })])).toEqual(["#4", "Total"]);
    expect(report_error).toHaveBeenCalledTimes(1);
  });
});

describe("alert helpers", () => {
  test("alert_date reads a UTC calendar day, and nothing for no or bad dates", () => {
    expect(alert_date("2026-11-20T23:30:00Z")).toBe("Nov 20, 2026");
    expect(alert_date(undefined)).toBeUndefined();
    expect(alert_date("not a date")).toBeUndefined();
  });

  test("alert_deadline keeps the UTC time, on either side of midnight", () => {
    // in a US zone a local-time reading moves both of these to the day before
    const zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(alert_deadline("2026-12-10T23:30:00Z")).toBe(
        "Dec 10, 2026, 23:30 UTC"
      );
      expect(alert_deadline("2026-12-11T00:30:00Z")).toBe(
        "Dec 11, 2026, 00:30 UTC"
      );
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
    expect(alert_deadline(new Date("2026-12-10T07:00:00Z"))).toBe(
      "Dec 10, 2026, 07:00 UTC"
    );
    expect(alert_deadline(undefined)).toBeUndefined();
    expect(alert_deadline("not a date")).toBeUndefined();
  });

  test("amount_label shows dollars for usd, a code otherwise, and unknown for none", () => {
    expect(amount_label("6")).toBe("$6.00");
    expect(amount_label("6", "EUR")).toBe("6.00 EUR");
    expect(amount_label(undefined)).toBe("unknown amount");
  });

  test("recipient_name falls back to the id, then to unknown", () => {
    const don = {
      id: "d",
      to_id: "4",
      to_type: "npo",
      created_at: "",
    } as const;
    expect(recipient_name({ ...don, to_name: "Save the Kids" })).toBe(
      "Save the Kids"
    );
    expect(recipient_name({ ...don, to_name: "" })).toBe("#4");
    expect(recipient_name(undefined)).toBe("unknown nonprofit");
  });
});
