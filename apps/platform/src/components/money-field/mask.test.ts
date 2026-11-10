import { decimal } from "@better-giving/ui/masks";
import { reformat } from "@better-giving/ui/reformat";
import { describe, expect, test } from "vitest";

describe("decimal.format", () => {
  test.each([
    ["9627.92", "9,627.92"],
    ["9627", "9,627"],
    ["1234567.5", "1,234,567.5"],
    ["999", "999"],
    ["9627.", "9,627."],
    [".5", "0.5"],
    [".", "0."],
    ["007", "7"],
    ["0.50", "0.50"],
    ["", ""],
  ])("shows %j as %j", (raw, out) => {
    expect(decimal.format(raw)).toBe(out);
  });

  test.each([
    ["$9,627.92", "9,627.92"],
    [" 100 ", "100"],
    ["$1,000", "1,000"],
    ["abc", ""],
    ["12abc34", "1,234"],
    ["1.2.3", "1.23"],
    ["9627.927", "9,627.92"],
    ["-5", "5"],
  ])("cleans a paste of %j to %j", (raw, out) => {
    expect(decimal.format(raw)).toBe(out);
  });

  test("places caps the decimals, none caps nothing", () => {
    expect(decimal.format("1.23456789", 8)).toBe("1.23456789");
    expect(decimal.format("1.239", 2)).toBe("1.23");
    expect(decimal.format("1.5", 0)).toBe("1.");
    expect(decimal.format("0.123456789123", Number.POSITIVE_INFINITY)).toBe(
      "0.123456789123"
    );
  });
});

describe("decimal.unmask", () => {
  test.each([
    ["9,627.92", "9627.92"],
    ["$1,000", "1000"],
    ["abc", ""],
    ["9,627.", "9627."],
  ])("stores %j as %j", (masked, out) => {
    expect(decimal.unmask(masked)).toBe(out);
  });

  test("decimals(n) carries the cap on both sides", () => {
    const m = decimal.decimals(3);
    expect(m.format("1234.5678")).toBe("1,234.567");
    expect(m.unmask("1,234.5678")).toBe("1234.567");
  });
});

const m = decimal.decimals(2);
const edit = (value: string, cursor: number, prev: string, type?: string) =>
  reformat(m, { value, cursor, prev, type });

describe("caret", () => {
  test("typing the digit that adds a comma keeps the caret after it", () => {
    // "962" + "7" at the end
    expect(edit("9627", 4, "962")).toEqual({ value: "9,627", cursor: 5 });
  });

  test("typing in the middle stays in place", () => {
    // "9,627" with a "1" typed after the 9
    expect(edit("91,627", 2, "9,627")).toEqual({ value: "91,627", cursor: 2 });
    // "1,000" with a "5" typed after the 1 regroups the rest
    expect(edit("15,000", 2, "1,000")).toEqual({ value: "15,000", cursor: 2 });
  });

  test("a dot typed at the end lands after the digits, not before the dot", () => {
    expect(edit("9,627.", 6, "9,627")).toEqual({ value: "9,627.", cursor: 6 });
  });

  test("a refused letter leaves the value and the caret where they were", () => {
    expect(edit("9,6a27", 4, "9,627")).toEqual({ value: "9,627", cursor: 3 });
  });

  test("backspace over a comma removes the digit before it", () => {
    // "9,627" caret after the comma, backspace removes the comma
    expect(edit("9627", 1, "9,627", "deleteContentBackward")).toEqual({
      value: "627",
      cursor: 0,
    });
    // "1,234,567" caret after the 2nd comma
    expect(edit("1,234567", 5, "1,234,567", "deleteContentBackward")).toEqual({
      value: "123,567",
      cursor: 3,
    });
  });

  test("delete forward over a comma removes the digit after it", () => {
    expect(edit("9627", 1, "9,627", "deleteContentForward")).toEqual({
      value: "927",
      cursor: 1,
    });
  });

  test("an ordinary backspace over a digit just regroups", () => {
    expect(edit("1,00", 4, "1,000", "deleteContentBackward")).toEqual({
      value: "100",
      cursor: 3,
    });
  });

  test("emptying the field", () => {
    expect(edit("", 0, "5", "deleteContentBackward")).toEqual({
      value: "",
      cursor: 0,
    });
  });
});
