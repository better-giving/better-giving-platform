import { describe, expect, test } from "vitest";
import { holder_match } from "./holder-match";

describe("holder_match", () => {
  test("a corporate suffix the legal name lacks still matches", () => {
    expect(
      holder_match("Harbor Light Food Pantry Inc.", "Harbor Light Food Pantry")
    ).toBe("match");
  });

  test("a person's name against an organisation is a mismatch", () => {
    expect(
      holder_match("Dana Whitfield", "Riverbend Youth Coding Collective Inc.")
    ).toBe("mismatch");
  });

  test.each([
    ["case", "HARBOR LIGHT FOOD PANTRY", "Harbor Light Food Pantry"],
    ["punctuation", "Harbor-Light: Food Pantry!", "Harbor Light Food Pantry"],
    [
      "whitespace",
      "  Harbor   Light\tFood Pantry ",
      "Harbor Light Food Pantry",
    ],
    [
      "a leading The",
      "The Harbor Light Food Pantry",
      "Harbor Light Food Pantry",
    ],
    ["& for and", "Bread & Roses", "Bread and Roses"],
    ["and for &", "Bread and Roses, Inc", "Bread & Roses"],
    ["Inc", "Bread and Roses Inc", "Bread and Roses"],
    ["Incorporated", "Bread and Roses Incorporated", "Bread and Roses, Inc."],
    ["Corp", "Acme Relief Corp", "Acme Relief Corporation"],
    ["LLC", "Acme Relief LLC", "Acme Relief"],
    ["L.L.C.", "Acme Relief L.L.C.", "Acme Relief"],
    ["Ltd", "Acme Relief Ltd.", "Acme Relief"],
    ["Co", "Acme Relief Co.", "Acme Relief Company"],
    ["stacked suffixes", "Acme Relief Co., Inc.", "Acme Relief"],
    ["accents", "Fundación Niños", "Fundacion Ninos"],
  ])("ignores %s", (_, holder, legal) => {
    expect(holder_match(holder, legal)).toBe("match");
  });

  test("a suffix word inside the name is part of the name", () => {
    expect(holder_match("Company Store Outreach", "Store Outreach")).toBe(
      "mismatch"
    );
  });

  test("a different organisation with a shared prefix is a mismatch", () => {
    expect(
      holder_match("Harbor Light Food Pantry", "Harbor Light Food Bank")
    ).toBe("mismatch");
  });

  test.each([null, undefined, "", "   "])(
    "no stored holder (%s) is unknown, not a mismatch",
    (holder) => {
      expect(holder_match(holder, "Harbor Light Food Pantry")).toBe("unknown");
    }
  );

  test("a holder that is nothing but a suffix matches nothing", () => {
    expect(holder_match("Inc.", "LLC")).toBe("mismatch");
  });
});
