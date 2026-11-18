import { describe, expect, test } from "vitest";
import { check_comparisons } from "./data";
import type { IComparePage, IComparisons } from "./types";

const page = (slug: string) => ({ slug }) as IComparePage;
const card = (slug: string) => ({ slug, competitor: slug, blurb: "" });

const make = (pages: string[], cards: string[]) =>
  ({
    generated: "2026-11-16",
    index: { cards: cards.map(card) },
    pages: pages.map(page),
  }) as unknown as IComparisons;

describe("check_comparisons", () => {
  test("pages and cards that match one to one pass through unchanged", () => {
    const data = make(["givebutter", "stripe-2"], ["stripe-2", "givebutter"]);
    expect(check_comparisons(data)).toBe(data);
  });

  test("a card with no page is rejected, naming the card", () => {
    expect(() => check_comparisons(make(["a"], ["a", "ghost"]))).toThrow(
      /no page: ghost; no card: \)/
    );
  });

  test("a page with no card is rejected, naming the page", () => {
    expect(() => check_comparisons(make(["a", "lonely"], ["a"]))).toThrow(
      /no page: ; no card: lonely/
    );
  });

  test("a slug that is not kebab-case is rejected", () => {
    expect(() =>
      check_comparisons(make(["Better World"], ["Better World"]))
    ).toThrow(/non-kebab slugs Better World/);
    expect(() => check_comparisons(make(["a_b"], ["a_b"]))).toThrow(
      /non-kebab/
    );
  });

  test("a duplicate page slug is rejected", () => {
    expect(() => check_comparisons(make(["a", "a"], ["a", "a"]))).toThrow(
      /duplicate page slugs/
    );
  });
});
