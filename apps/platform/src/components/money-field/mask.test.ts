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
    ["0.50", "0.50"],
    ["", ""],
    // the field's own display read back: its commas are always grouping
    ["$9,627.92", "9,627.92"],
    ["0,000", "0,000"],
  ])("shows %j as %j", (raw, out) => {
    expect(decimal.format(raw)).toBe(out);
  });

  test("keeps leading zeros, so a deleted first digit can be retyped", () => {
    expect(decimal.format("000")).toBe("000");
    expect(decimal.format("0000")).toBe("0,000");
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
    ["0,000", "0000"],
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

// what the browser hands `onInput` for each keystroke on `disp`
const type = (disp: string, caret: number, text: string, mask = m) =>
  reformat(mask, {
    value: disp.slice(0, caret) + text + disp.slice(caret),
    cursor: caret + text.length,
    prev: disp,
    type: "insertText",
  });
const paste = (text: string, disp = "", mask = m) =>
  reformat(mask, {
    value: disp + text,
    cursor: disp.length + text.length,
    prev: disp,
    type: "insertFromPaste",
  });
const back = (disp: string, caret: number) =>
  reformat(m, {
    value: disp.slice(0, caret - 1) + disp.slice(caret),
    cursor: caret - 1,
    prev: disp,
    type: "deleteContentBackward",
  });
const del = (disp: string, caret: number) =>
  reformat(m, {
    value: disp.slice(0, caret) + disp.slice(caret + 1),
    cursor: caret,
    prev: disp,
    type: "deleteContentForward",
  });
const typing = (keys: string, mask = m) =>
  [...keys].reduce((s, k) => type(s.value, s.cursor, k, mask), {
    value: "",
    cursor: 0,
  });

describe("paste", () => {
  test.each([
    ["$9,627.92", "9,627.92"],
    [" 100 ", "100"],
    ["$1,000", "1,000"],
    ["abc", ""],
    ["12abc34", "1,234"],
    ["1.2.3", "1.23"],
    ["9627.927", "9,627.92"],
    ["1,234,567.89", "1,234,567.89"],
    ["12,34,567", "1,234,567"],
  ])("cleans %j to %j", (text, out) => {
    expect(paste(text).value).toBe(out);
  });

  test.each([
    ["12,50", "12.50"],
    ["1,5", "1.5"],
    ["$1,2", "1.2"],
    ["1.234,56", "1,234.56"],
    ["$1.234,56", "1,234.56"],
    ["1 000,00", "1,000.00"],
    ["12,", "12."],
  ])("reads the decimal comma in %j: %j", (text, out) => {
    expect(paste(text).value).toBe(out);
  });

  test("a comma before exactly 3 digits is thousands", () => {
    expect(paste("1,234").value).toBe("1,234");
  });

  test("a comma after a leading 0 is never thousands", () => {
    expect(paste("0,125", "", decimal.decimals(3)).value).toBe("0.125");
  });

  test("a minus is refused whole, never flipped to a positive", () => {
    expect(paste("-50")).toEqual({ value: "", cursor: 0 });
    expect(paste("-5", "12")).toEqual({ value: "12", cursor: 2 });
    expect(type("12", 0, "-")).toEqual({ value: "12", cursor: 0 });
  });
});

describe("typing", () => {
  test("a typed comma is the decimal separator, as a comma keypad sends it", () => {
    expect(typing("1,5")).toEqual({ value: "1.5", cursor: 3 });
    expect(typing("12,50")).toEqual({ value: "12.50", cursor: 5 });
  });

  test("a comma typed before a full group changes nothing", () => {
    expect(type("1,234", 1, ",")).toEqual({ value: "1,234", cursor: 1 });
  });

  test("a dot typed into an empty field puts the caret after the dot", () => {
    expect(type("", 0, ".")).toEqual({ value: "0.", cursor: 2 });
    expect(typing(".5")).toEqual({ value: "0.5", cursor: 3 });
    expect(typing(".50")).toEqual({ value: "0.50", cursor: 4 });
  });

  test("a dot that would push digits past the cap is refused", () => {
    expect(type("1,234", 1, ".")).toEqual({ value: "1,234", cursor: 1 });
    expect(type("1,234", 1, ",")).toEqual({ value: "1,234", cursor: 1 });
    // with room for the decimals it is an ordinary dot
    expect(type("1,234", 1, ".", decimal.decimals(3))).toEqual({
      value: "1.234",
      cursor: 2,
    });
  });

  test("a second dot is refused rather than merging the decimals", () => {
    expect(type("12.5", 1, ".")).toEqual({ value: "12.5", cursor: 1 });
  });

  test("a digit typed between decimals at the cap is refused", () => {
    expect(type("12.34", 4, "9")).toEqual({ value: "12.34", cursor: 4 });
    // at the end it simply stops
    expect(type("12.34", 5, "9")).toEqual({ value: "12.34", cursor: 5 });
  });
});

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
    // the last digit of a group: the comma it leaves is not a decimal comma
    expect(back("1,234", 5)).toEqual({ value: "123", cursor: 3 });
  });

  test("backspacing the first digit keeps the zeros for a retyped one", () => {
    const gone = back("1,000", 1);
    expect(gone).toEqual({ value: "000", cursor: 0 });
    expect(type(gone.value, gone.cursor, "2")).toEqual({
      value: "2,000",
      cursor: 1,
    });

    const hundred = back("100", 1);
    expect(hundred).toEqual({ value: "00", cursor: 0 });
    expect(type(hundred.value, hundred.cursor, "2").value).toBe("200");
  });

  test("deleting the leading 0 of a decimal keeps the dot", () => {
    expect(del("0.5", 0)).toEqual({ value: "0.5", cursor: 1 });
    expect(del("0.50", 0).value).toBe("0.50");
    expect(back("0.5", 1).value).toBe("0.5");
  });

  test("emptying the field", () => {
    expect(edit("", 0, "5", "deleteContentBackward")).toEqual({
      value: "",
      cursor: 0,
    });
  });
});
