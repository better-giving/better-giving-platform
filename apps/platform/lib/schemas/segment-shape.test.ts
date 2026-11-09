import { safeParse } from "valibot";
import { describe, expect, it } from "vitest";
import { segment_shape } from "./index";

describe("segment_shape", () => {
  it.each([
    ["2024", "Don't use only numbers"],
    ["café", "Use only English letters (a-z), numbers, and - . _ ~"],
    ["a b", "Use only English letters (a-z), numbers, and - . _ ~"],
    ["a..b", "Don't use two dots in a row"],
    [".a", "Don't start or end with a dot"],
    ["a.", "Don't start or end with a dot"],
  ])("answers %s with its rule", (input, message) => {
    expect(safeParse(segment_shape, input).issues?.[0]?.message).toBe(message);
  });

  it("names both ends at once for a lone dot", () => {
    const issues = safeParse(segment_shape, ".").issues ?? [];
    expect(issues.map((i) => i.message)).toEqual([
      "Don't start or end with a dot",
    ]);
  });

  it("accepts a slug with no letters as long as it is not all digits", () => {
    expect(safeParse(segment_shape, "2024-").success).toBe(true);
  });
});
