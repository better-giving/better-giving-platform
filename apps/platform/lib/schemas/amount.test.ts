import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { amount_format_err, amount_num } from "./amount";

const run = (x: string, places?: number) => v.safeParse(amount_num(places), x);

describe("amount_num", () => {
  test.each([
    ["9,627.92", 9627.92],
    ["$100", 100],
    [" 100 ", 100],
    ["1,000", 1000],
    ["$ 1,234,567.5", 1234567.5],
    ["9627.", 9627],
    [".5", 0.5],
    ["0", 0],
    ["-5", -5],
  ])("reads %j as %d", (input, out) => {
    const r = run(input);
    expect(r.success && r.output).toBe(out);
  });

  test.each([
    "abc",
    "1.2.3",
    "1.234",
    "12,50",
    "1,5",
    "1,0,0,0",
    "$",
    "",
    "1e3",
    "--5",
  ])("refuses %j", (input) => {
    const r = run(input);
    expect(r.success).toBe(false);
    expect(r.issues?.[0].message).toBe(amount_format_err);
  });

  test("places caps the decimals", () => {
    expect(run("1.234", 3).success).toBe(true);
    expect(run("1.234", 2).success).toBe(false);
    expect(run("1.5", 0).success).toBe(false);
    expect(run("1.", 0).success).toBe(true);
    expect(run("0.12345678", Number.POSITIVE_INFINITY).success).toBe(true);
  });
});
