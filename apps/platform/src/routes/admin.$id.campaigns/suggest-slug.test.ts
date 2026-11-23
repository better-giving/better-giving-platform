import { describe, expect, test } from "vitest";
import { suggest_slug } from "./link-field";

describe("suggest_slug", () => {
  test("lowercases words and joins them with hyphens", () => {
    expect(suggest_slug("Harbor Light Food Bank")).toBe(
      "harbor-light-food-bank"
    );
  });

  test.each(["", "   ", "!!!", "---"])(
    "falls back to my-nonprofit for %j",
    (name) => {
      expect(suggest_slug(name)).toBe("my-nonprofit");
    }
  );

  test("cuts at 30 characters", () => {
    expect(suggest_slug("a".repeat(45))).toBe("a".repeat(30));
  });

  // the 30th character falls on the separator, which must not be left dangling
  test("trims the hyphen a cut leaves at the end", () => {
    const name = `${"a".repeat(29)} bbb`;

    expect(suggest_slug(name)).toBe("a".repeat(29));
  });
});
