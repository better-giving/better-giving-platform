import { describe, expect, it } from "vitest";
import { take_cuts } from "./reverse";

const refund = (id: string, amount: number, created_at: string) => ({
  kind: "refund" as const,
  id,
  amount,
  created_at,
});

describe("take_cuts", () => {
  it("cuts oldest first off the running total, summing to the whole transfer", () => {
    const takes = [
      refund("re_b", 1, "2026-01-02"),
      refund("re_a", 1, "2026-01-01"),
      refund("re_c", 1, "2026-01-03"),
    ];

    expect(take_cuts(1_001, 3, takes)).toEqual([
      { kind: "refund", id: "re_a", amount: 334 },
      { kind: "refund", id: "re_b", amount: 333 },
      { kind: "refund", id: "re_c", amount: 334 },
    ]);
  });

  // a pending refund is cut once it is sent, after a newer take-back was
  it("counts what was already cut for the take-backs answered out of time order", () => {
    const takes = [
      refund("re_old", 1, "2026-01-01"),
      refund("re_new", 1, "2026-01-02"),
    ];

    const cuts = take_cuts(1_001, 3, takes, new Map([["re_new", 334]]));

    expect(cuts).toEqual([{ kind: "refund", id: "re_old", amount: 333 }]);
  });

  it("cuts nothing more for a take-back already answered", () => {
    const takes = [refund("re_a", 1, "2026-01-01")];

    expect(take_cuts(1_001, 3, takes, new Map([["re_a", 334]]))).toEqual([]);
  });
});
