import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IOwed } from "../pg/queries/owed";

const { lookups, report_error } = vi.hoisted(() => ({
  lookups: vi.fn(),
  report_error: vi.fn(),
}));

vi.mock("../env", () => ({ base_url: "https://app.test" }));
vi.mock("#/errors/report", () => ({ report_error }));
// every name lookup resolves to the next queued answer
vi.mock("../pg/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => lookups() }) }),
  },
}));

import { alert_date, amount_label, owed_table, recipient_name } from "./alert";

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
  lookups.mockReset();
  report_error.mockReset();
});

describe("owed_table", () => {
  test("names each party and totals what is owed", async () => {
    lookups
      .mockResolvedValueOnce([{ id: 4, name: "Save the Kids" }])
      .mockResolvedValueOnce([{ id: "REF-N", name: "Helpers" }])
      .mockResolvedValueOnce([{ id: "REF-U", name: "Una User" }]);
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
    lookups.mockResolvedValue([]);
    expect(
      await parties([
        owed({ npo_id: 4 }),
        owed({ referrer_npo: "REF-N" }),
        owed({ referrer_user: "REF-U" }),
      ])
    ).toEqual(["#4", "npo REF-N (referrer)", "user REF-U (referrer)", "Total"]);
  });

  test("keeps the table, with ids, when the name lookup fails", async () => {
    lookups.mockRejectedValue(new Error("db down"));
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
