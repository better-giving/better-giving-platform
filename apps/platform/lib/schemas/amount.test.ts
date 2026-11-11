import * as v from "valibot";
import { describe, expect, test } from "vitest";
import {
  amount_format_err,
  amount_num,
  amount_places_err,
  decimal_str,
} from "./amount";

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
    "12,50",
    "1,5",
    "1,0,0,0",
    "$",
    "",
    "1e3",
    "--5",
    // a decimal comma, as the mask reads it, not 500
    "0,500",
    "00,500",
  ])("refuses %j", (input) => {
    const r = run(input);
    expect(r.success).toBe(false);
    expect(r.issues?.[0].message).toBe(amount_format_err());
  });

  test("places caps the decimals, under its own message", () => {
    expect(run("1.234", 3).success).toBe(true);
    expect(run("1.234", 2).issues?.[0].message).toBe(amount_places_err(2));
    expect(run("1,000.234", 2).issues?.[0].message).toBe(amount_places_err(2));
    expect(run("1.5", 0).issues?.[0].message).toBe(amount_places_err(0));
    expect(run("1.", 0).success).toBe(true);
    expect(run("0.12345678", Number.POSITIVE_INFINITY).success).toBe(true);
  });

  test("a whole-number field never shows a decimal example", () => {
    expect(run("abc", 0).issues?.[0].message).toBe(amount_format_err(0));
    expect(amount_format_err(0)).not.toMatch(/\./);
    expect(amount_places_err(0)).not.toMatch(/\d\.\d/);
  });
});

describe("decimal_str", () => {
  test.each([
    [1e-7, "0.0000001"],
    [0.1, "0.1"],
    [1234.567, "1234.567"],
    [1e21, "1000000000000000000000"],
    [100, "100"],
  ])("writes %d as %j", (n, out) => {
    expect(decimal_str(n)).toBe(out);
  });
});
