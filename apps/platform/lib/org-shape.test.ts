import { describe, expect, test } from "vitest";
import { type IOrgShape, threshold_layout } from "./org-shape";

const shape = (over: Partial<IOrgShape> = {}): IOrgShape => ({
  story_chars: 0,
  tagline_chars: 0,
  name_chars: 10,
  has_banner: false,
  has_logo: false,
  campaigns: 0,
  supporters: 0,
  programs: 0,
  videos: 0,
  ...over,
});

describe("threshold_layout", () => {
  test.each([
    [
      "poster",
      "a short story and one row of items",
      { story_chars: 200, campaigns: 2 },
    ],
    [
      "letter",
      "a long story and one row of items",
      { story_chars: 900, programs: 1 },
    ],
    [
      "hub",
      "a short story and items past one row",
      { story_chars: 200, campaigns: 5 },
    ],
    [
      "feature",
      "a long story and items past one row",
      { story_chars: 900, videos: 4 },
    ],
  ] as const)("picks %s for %s", (layout, _, over) => {
    expect(threshold_layout(shape(over))).toBe(layout);
  });

  test("a story of 320 characters is short, 321 is long", () => {
    expect(threshold_layout(shape({ story_chars: 320 }))).toBe("poster");
    expect(threshold_layout(shape({ story_chars: 321 }))).toBe("letter");
  });

  test("no story and no items is a card, a tagline notwithstanding", () => {
    expect(threshold_layout(shape())).toBe("card");
    expect(threshold_layout(shape({ tagline_chars: 80 }))).toBe("card");
  });

  test("one item, or one character of story, is enough for a poster", () => {
    expect(threshold_layout(shape({ programs: 1 }))).toBe("poster");
    expect(threshold_layout(shape({ story_chars: 1 }))).toBe("poster");
  });

  test("no story at all is short", () => {
    expect(threshold_layout(shape({ story_chars: 0, campaigns: 4 }))).toBe(
      "hub"
    );
  });

  test("items count across kinds: 3 fit one row, 4 need navigation", () => {
    const three = { campaigns: 1, supporters: 1, programs: 1 };
    expect(threshold_layout(shape(three))).toBe("poster");
    expect(threshold_layout(shape({ ...three, videos: 1 }))).toBe("hub");
    expect(threshold_layout(shape({ ...three, story_chars: 900 }))).toBe(
      "letter"
    );
    expect(
      threshold_layout(shape({ ...three, supporters: 2, story_chars: 900 }))
    ).toBe("feature");
  });
});
