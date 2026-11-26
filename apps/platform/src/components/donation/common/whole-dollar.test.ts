import { describe, expect, test } from "vitest";
import { donation_amounts, fee_terms, whole_dollar_amounts } from "./amounts";

const cents = (x: { base: number; tip: number; fee_allowance: number }) =>
  Math.round((x.base + x.tip + x.fee_allowance) * 100);

describe("whole_dollar_amounts", () => {
  test("a donor covering fees takes the top-up on the fee allowance", () => {
    const out = whole_dollar_amounts({
      base: 100,
      tip: 15,
      fee_allowance: 3.43,
    });
    expect(out).toEqual({ base: 100, tip: 15, fee_allowance: 4 });
    expect(cents(out) % 100).toBe(0);
  });

  test("without fee cover the top-up lands on the contribution", () => {
    const out = whole_dollar_amounts({
      base: 100,
      tip: 15.4,
      fee_allowance: 0,
    });
    expect(out).toEqual({ base: 100, tip: 16, fee_allowance: 0 });
    expect(cents(out) % 100).toBe(0);
  });

  test("with neither a contribution nor fee cover the total is the gift as entered", () => {
    expect(
      whole_dollar_amounts({ base: 25.5, tip: 0, fee_allowance: 0 })
    ).toEqual({ base: 25.5, tip: 0, fee_allowance: 0 });
  });

  test("a total already on a whole dollar is left as it is", () => {
    expect(
      whole_dollar_amounts({ base: 50, tip: 10, fee_allowance: 0 })
    ).toEqual({ base: 50, tip: 10, fee_allowance: 0 });
  });

  test("the gift is never touched, and the top-up is under a dollar", () => {
    for (const base of [2, 7.31, 99.99, 1000]) {
      for (const tip_format of ["none", "10", "20"] as const) {
        for (const cover_processing_fee of [false, true]) {
          const raw = donation_amounts(
            { amount: base, tip_format, tip: "", cover_processing_fee },
            2,
            fee_terms.daf
          );
          const out = whole_dollar_amounts(raw);
          expect(out.base).toBe(base);
          if (raw.tip || raw.fee_allowance) {
            expect(cents(out) % 100).toBe(0);
            expect(cents(out) - cents(raw)).toBeLessThan(100);
          } else {
            expect(out).toEqual(raw);
          }
        }
      }
    }
  });
});
