import { runInNewContext } from "node:vm";
import { decimal, dollar } from "@better-giving/ui/masks";
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

type IMask = Parameters<typeof reformat>[0];
// a visitor whose locale writes a decimal point; `comma` is one whose locale
// writes a decimal comma. only a typed comma tells them apart
const m = decimal.decimals(2, ".");
const comma = decimal.decimals(2, ",");
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
const back = (disp: string, caret: number, mask: IMask = m) =>
  reformat(mask, {
    value: disp.slice(0, caret - 1) + disp.slice(caret),
    cursor: caret - 1,
    prev: disp,
    type: "deleteContentBackward",
  });
const del = (disp: string, caret: number, mask: IMask = m) =>
  reformat(mask, {
    value: disp.slice(0, caret) + disp.slice(caret + 1),
    cursor: caret,
    prev: disp,
    type: "deleteContentForward",
  });
// a caret loop that never ends blocks the thread, so no test timeout can fire;
// vm's watchdog terminates it and the test fails instead of hanging the run
const bounded = <T>(f: () => T): T =>
  runInNewContext("f()", { f }, { timeout: 1000 });
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

  test.each([
    ["\u221250", "unicode minus"],
    ["\u201350", "en dash"],
    ["\u201450", "em dash"],
    ["\uff0d50", "full-width hyphen"],
    ["(50)", "accounting parentheses"],
    ["$(1,234.56)", "accounting parentheses with a sign"],
  ])("%j (%s) is refused like a minus", (text) => {
    expect(paste(text)).toEqual({ value: "", cursor: 0 });
    expect(paste(text, "12")).toEqual({ value: "12", cursor: 2 });
  });

  test.each(["1.234.567", "1.2.3", "1,234.56.7"])(
    "%j, with more than one dot, is refused rather than cut to 1.23",
    (text) => {
      expect(paste(text)).toEqual({ value: "", cursor: 0 });
      expect(paste(text, "5")).toEqual({ value: "5", cursor: 1 });
    }
  );

  test("dots that are grouping before a decimal comma still read", () => {
    expect(paste("1.234.567,89").value).toBe("1,234,567.89");
  });

  test("full-width digits from an IME read as digits", () => {
    expect(paste("\uff11\uff12\uff13").value).toBe("123");
    expect(paste("\uff11\uff0c\uff15\uff10\uff10").value).toBe("1,500");
    expect(paste("\uff11\uff12\uff0e\uff15").value).toBe("12.5");
  });

  test("arabic-indic digits and decimal separator read as digits", () => {
    expect(paste("\u0665\u0660").value).toBe("50");
    expect(paste("\u0661\u0662\u066b\u0665\u0660").value).toBe("12.50");
    expect(paste("\u06f1\u06f2").value).toBe("12");
  });

  test("a paste keeps the 3-digit rule whatever the locale", () => {
    expect(paste("12,50", "", comma).value).toBe("12.50");
    expect(paste("1,234", "", comma).value).toBe("1,234");
  });
});

describe("typing", () => {
  test("where the decimal is a point, a typed comma is thousands and changes nothing", () => {
    expect(typing("1,000")).toEqual({ value: "1,000", cursor: 5 });
    expect(typing("10,000")).toEqual({ value: "10,000", cursor: 6 });
    expect(typing("1,500.50")).toEqual({ value: "1,500.50", cursor: 8 });
    expect(type("1", 1, ",")).toEqual({ value: "1", cursor: 1 });
  });

  test("where the decimal is a comma, a typed comma is the decimal point, as its keypad sends it", () => {
    expect(typing("1,5", comma)).toEqual({ value: "1.5", cursor: 3 });
    expect(typing("12,50", comma)).toEqual({ value: "12.50", cursor: 5 });
  });

  test("full-width digits typed key by key", () => {
    expect(typing("\uff11\uff10\uff10\uff10")).toEqual({
      value: "1,000",
      cursor: 5,
    });
  });

  test("a typed unicode minus is refused", () => {
    expect(type("12", 0, "\u2212")).toEqual({ value: "12", cursor: 0 });
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

describe("dollar", () => {
  test.each([
    ["12.50", "$ 12"],
    ["$1,500.00", "$ 1,500"],
    ["1,234", "$ 1,234"],
    ["12,50", "$ 12"],
    ["$ 2,000", "$ 2,000"],
  ])("a pasted %j drops the cents: %j", (text, out) => {
    expect(paste(text, "", dollar).value).toBe(out);
  });

  test("a minus or several dots is refused", () => {
    expect(paste("-50", "$ 5", dollar)).toEqual({ value: "$ 5", cursor: 3 });
    expect(paste("1.234.567", "$ 5", dollar)).toEqual({
      value: "$ 5",
      cursor: 3,
    });
  });

  test("a typed thousands comma changes nothing", () => {
    expect(typing("1,000", dollar).value).toBe("$ 1,000");
  });
});

describe("a delete that formatting shortens", () => {
  test("backspacing the leading digit of a dollar amount", () => {
    expect(bounded(() => back("$ 1,000", 3, dollar))).toEqual({
      value: "$ 0",
      cursor: 2,
    });
    expect(bounded(() => back("$ 100", 3, dollar))).toEqual({
      value: "$ 0",
      cursor: 2,
    });
  });

  test("deleting the whole digit of a field holding more decimals than its cap", () => {
    expect(bounded(() => back("1.2345", 1))).toEqual({
      value: "0.2345",
      cursor: 1,
    });
    expect(bounded(() => del("1.2345", 0))).toEqual({
      value: "0.2345",
      cursor: 1,
    });
  });
});

describe("a field holding more decimals than its cap", () => {
  test("takes a digit typed before the point", () => {
    expect(type("1.2345", 1, "0")).toEqual({ value: "10.2345", cursor: 2 });
  });

  test("backspace at the end removes one decimal", () => {
    expect(back("1.2345", 6)).toEqual({ value: "1.234", cursor: 5 });
  });

  test("still takes no new decimal", () => {
    expect(type("1.2345", 6, "9")).toEqual({ value: "1.2345", cursor: 6 });
    expect(type("1.2345", 3, "9")).toEqual({ value: "1.2345", cursor: 3 });
  });

  test("a paste with more decimals than the cap is refused, field unchanged", () => {
    expect(
      reformat(m, {
        value: "12.345",
        cursor: 6,
        prev: "1.2345",
        type: "insertFromPaste",
      })
    ).toEqual({ value: "1.2345", cursor: 1 });
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

describe("dollar", () => {
  test.each([
    ["12.50", "$ 12"],
    ["$1,500.00", "$ 1,500"],
    ["1,234", "$ 1,234"],
    ["12,50", "$ 12"],
    ["$ 2,000", "$ 2,000"],
  ])("a pasted %j drops the cents: %j", (text, out) => {
    expect(paste(text, "", dollar).value).toBe(out);
  });

  test("a minus or several dots is refused", () => {
    expect(paste("-50", "$ 5", dollar)).toEqual({ value: "$ 5", cursor: 3 });
    expect(paste("1.234.567", "$ 5", dollar)).toEqual({
      value: "$ 5",
      cursor: 3,
    });
  });

  test("a typed thousands comma changes nothing", () => {
    expect(typing("1,000", dollar).value).toBe("$ 1,000");
  });
});

describe("a delete that formatting shortens", () => {
  test("backspacing the leading digit of a dollar amount", () => {
    expect(bounded(() => back("$ 1,000", 3, dollar))).toEqual({
      value: "$ 0",
      cursor: 2,
    });
    expect(bounded(() => back("$ 100", 3, dollar))).toEqual({
      value: "$ 0",
      cursor: 2,
    });
  });

  test("deleting the whole digit of a field holding more decimals than its cap", () => {
    expect(bounded(() => back("1.2345", 1))).toEqual({
      value: "0.2345",
      cursor: 1,
    });
    expect(bounded(() => del("1.2345", 0))).toEqual({
      value: "0.2345",
      cursor: 1,
    });
  });
});

describe("a field holding more decimals than its cap", () => {
  test("takes a digit typed before the point", () => {
    expect(type("1.2345", 1, "0")).toEqual({ value: "10.2345", cursor: 2 });
  });

  test("backspace at the end removes one decimal", () => {
    expect(back("1.2345", 6)).toEqual({ value: "1.234", cursor: 5 });
  });

  test("still takes no new decimal", () => {
    expect(type("1.2345", 6, "9")).toEqual({ value: "1.2345", cursor: 6 });
    expect(type("1.2345", 3, "9")).toEqual({ value: "1.2345", cursor: 3 });
  });
});

// what the browser hands `onInput` once a range [from, to) of `prev` is
// replaced by `text` (typed, pasted, or "" for a cut)
const replace = (
  prev: string,
  from: number,
  to: number,
  text: string,
  type: string
) =>
  reformat(m, {
    value: prev.slice(0, from) + text + prev.slice(to),
    cursor: from + text.length,
    prev,
    type,
  });

describe("a selection replaced", () => {
  test("typing over part of a group regroups and puts the caret after the digit", () => {
    // "1,|2|34" + "5"
    expect(replace("1,234", 2, 3, "5", "insertText")).toEqual({
      value: "1,534",
      cursor: 3,
    });
  });

  test("typing over a range that includes a comma", () => {
    // "|1,2|34" + "5"
    expect(replace("1,234", 0, 3, "5", "insertText")).toEqual({
      value: "534",
      cursor: 1,
    });
  });

  test("typing over everything starts the field again", () => {
    expect(replace("1,234.50", 0, 8, "7", "insertText")).toEqual({
      value: "7",
      cursor: 1,
    });
  });

  test("a paste over a selection replaces it", () => {
    // "1,|234|" + "99"
    expect(replace("1,234", 2, 5, "99", "insertFromPaste")).toEqual({
      value: "199",
      cursor: 3,
    });
  });

  test("a paste over everything is read afresh", () => {
    expect(replace("1,234", 0, 5, "$9,627.92", "insertFromPaste")).toEqual({
      value: "9,627.92",
      cursor: 8,
    });
  });
});

describe("a cut", () => {
  test("cutting digits regroups what is left", () => {
    // "1,2|34|.50"
    expect(replace("1,234.50", 3, 5, "", "deleteByCut")).toEqual({
      value: "12.50",
      cursor: 2,
    });
  });

  test("cutting a range that includes a comma", () => {
    // "|1,|234"
    expect(replace("1,234", 0, 2, "", "deleteByCut")).toEqual({
      value: "234",
      cursor: 0,
    });
  });

  test("cutting everything empties the field", () => {
    expect(replace("1,234", 0, 5, "", "deleteByCut")).toEqual({
      value: "",
      cursor: 0,
    });
  });
});

describe("a paste in the middle", () => {
  test("lands between the digits and regroups the whole", () => {
    // "1,|234" + "56"
    expect(replace("1,234", 2, 2, "56", "insertFromPaste")).toEqual({
      value: "156,234",
      cursor: 3,
    });
  });

  test("past the cap is refused, the field keeps what it had", () => {
    // "12.|34" + "99": a third decimal would cost the last digit
    expect(replace("12.34", 3, 3, "99", "insertFromPaste")).toEqual({
      value: "12.34",
      cursor: 3,
    });
  });
});

describe("an edit that is not a change at the caret", () => {
  test("undo restores older text, read whole as the field's own", () => {
    expect(
      reformat(m, {
        value: "1,000",
        cursor: 0,
        prev: "12.5",
        type: "historyUndo",
      })
    ).toEqual({ value: "1,000", cursor: 5 });
  });

  test("undo keeps a comma the field drew rather than reading it as a decimal comma", () => {
    expect(
      reformat(m, {
        value: "0,000",
        cursor: 0,
        prev: "5",
        type: "historyUndo",
      })
    ).toEqual({ value: "0,000", cursor: 5 });
  });

  test("redo likewise, and cuts the decimals to the cap", () => {
    expect(
      reformat(m, {
        value: "12,345.678",
        cursor: 0,
        prev: "1,000",
        type: "historyRedo",
      })
    ).toEqual({ value: "12,345.67", cursor: 9 });
  });

  test("an autofill that replaces the text wholesale is read as a paste", () => {
    expect(
      reformat(m, {
        value: "1,234.56",
        cursor: 8,
        prev: "5",
        type: "insertReplacementText",
      })
    ).toEqual({ value: "1,234.56", cursor: 8 });
  });
});

describe("a replaced selection", () => {
  /** `prev` with `[start, end)` selected and `pasted` put over it, as the
   * input holds it after the event */
  const replace = (
    prev: string,
    [start, end]: [number, number],
    pasted: string,
    type = "insertFromPaste"
  ) =>
    reformat(m, {
      value: prev.slice(0, start) + pasted + prev.slice(end),
      cursor: start + pasted.length,
      prev,
      type,
      selection: { start, end },
    });

  test.each([
    ["1.2", "1.234,56", "1,234.56"],
    ["1.2", "1,234.56", "1,234.56"],
    ["100", "$1,000", "1,000"],
    ["12,345", "12,50", "12.50"],
    ["12,345", "$9,627.92", "9,627.92"],
  ])(
    "a whole-field paste over %j of %j reads as one amount: %j",
    (prev, pasted, out) => {
      expect(replace(prev, [0, prev.length], pasted).value).toBe(out);
    }
  );

  test("part of the value replaced keeps the rest", () => {
    // "12,345.60" with the "345" selected, "7" typed over it
    expect(replace("12,345.60", [3, 6], "7", "insertText").value).toBe(
      "127.60"
    );
    // the tail of "1,000" selected and pasted over
    expect(replace("1,000", [1, 5], "$2,500").value).toBe("12,500");
  });

  test("the caret lands after what went in", () => {
    expect(replace("1.2", [0, 3], "1.234,56").cursor).toBe(8);
  });

  test("typing over a whole selection", () => {
    expect(replace("1,000", [0, 5], "5", "insertText")).toEqual({
      value: "5",
      cursor: 1,
    });
  });

  test("a collapsed range falls back to comparing the values", () => {
    expect(
      reformat(m, {
        value: "9627",
        cursor: 4,
        prev: "962",
        type: "insertText",
        selection: { start: 3, end: 3 },
      })
    ).toEqual({ value: "9,627", cursor: 5 });
  });
});

describe("a paste with more decimals than the field allows", () => {
  test.each([
    ["1.000", "$ "],
    ["12.345", ""],
    ["19.999", ""],
    ["9627.927", ""],
  ])("refuses %j instead of cutting it", (text) => {
    expect(paste(text)).toEqual({ value: "", cursor: 0 });
  });

  test("the cap is the field's own: no cap takes them all", () => {
    expect(paste("0.123456789", "", decimal.decimals(Infinity)).value).toBe(
      "0.123456789"
    );
    expect(paste("1.2345", "", decimal.decimals(4)).value).toBe("1.2345");
  });

  test("a whole-number field refuses any fraction", () => {
    expect(paste("12.5", "", decimal.decimals(0)).value).toBe("");
  });
});

describe("an insertion that would cost the field a digit", () => {
  test.each([
    ["1.2", "345"],
    ["0.", "1234"],
    ["12.3", "456"],
  ])("pasting %j after %j is refused, not cut", (disp, text) => {
    expect(paste(text, disp).value).toBe(disp);
  });

  test("adding the digits that fit still works", () => {
    expect(paste("5", "1.2").value).toBe("1.25");
    expect(paste("56", "1.").value).toBe("1.56");
  });
});

describe("an IME's full stop", () => {
  test.each([
    ["１２。５０", "12.50"],
    ["９６２７。９２", "9,627.92"],
  ])("reads %j as a decimal point", (text, out) => {
    expect(paste(text).value).toBe(out);
  });
});
