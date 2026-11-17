import { describe, expect, test } from "vitest";
import { long_date_of } from "./format";

describe("long_date_of", () => {
  test("reads the stored calendar date in UTC, so the first of a month stays put", () => {
    expect(long_date_of("2026-01-01")).toBe("January 1, 2026");
    expect(long_date_of("2026-11-16")).toBe("November 16, 2026");
  });
});
