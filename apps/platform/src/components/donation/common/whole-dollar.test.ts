import { describe, expect, test } from "vitest";
import { whole_dollar_amounts } from "./amounts";

// the DAF form takes a whole-dollar gift only (`daf_donation_details`), so
// every base below is whole; the tip and fee allowance are what a tip percent
// and the fee estimate leave with cents
describe("whole_dollar_amounts", () => {
  test("a donor covering fees takes the top-up on the fee allowance", () => {
    expect(
      whole_dollar_amounts({ base: 100, tip: 15, fee_allowance: 3.43 })
    ).toEqual({ base: 100, tip: 15, fee_allowance: 4 });
  });

  test("without fee cover the top-up lands on the contribution", () => {
    expect(
      whole_dollar_amounts({ base: 100, tip: 15.4, fee_allowance: 0 })
    ).toEqual({ base: 100, tip: 16, fee_allowance: 0 });
  });

  test("with neither a contribution nor fee cover the whole-dollar gift is as entered", () => {
    expect(
      whole_dollar_amounts({ base: 25, tip: 0, fee_allowance: 0 })
    ).toEqual({ base: 25, tip: 0, fee_allowance: 0 });
  });

  // pins today's pass-through: the function does not round a fractional base,
  // `daf_donation_details` is what keeps one out
  test("with neither a contribution nor fee cover a fractional base comes back unchanged", () => {
    expect(
      whole_dollar_amounts({ base: 10.5, tip: 0, fee_allowance: 0 })
    ).toEqual({ base: 10.5, tip: 0, fee_allowance: 0 });
  });

  test("a fractional base is counted in the total and left unrounded: 10.50 + 0.30 tops the tip up to 0.50", () => {
    expect(
      whole_dollar_amounts({ base: 10.5, tip: 0.3, fee_allowance: 0 })
    ).toEqual({ base: 10.5, tip: 0.5, fee_allowance: 0 });
  });

  test("a fractional base with fee cover: 10.50 + 0.62 tops the allowance up to 1.50", () => {
    expect(
      whole_dollar_amounts({ base: 10.5, tip: 0, fee_allowance: 0.62 })
    ).toEqual({ base: 10.5, tip: 0, fee_allowance: 1.5 });
  });

  test("a total already on a whole dollar is left as it is", () => {
    expect(
      whole_dollar_amounts({ base: 50, tip: 10, fee_allowance: 0 })
    ).toEqual({ base: 50, tip: 10, fee_allowance: 0 });
  });

  // totals and results written out by hand, each total a float trap in
  // dollars (7.7, 3.3, 108.9) that must still land on an exact whole dollar
  test.each([
    {
      name: "10% tip on $7: 7.70 up to 8.00",
      in: { base: 7, tip: 0.7, fee_allowance: 0 },
      out: { base: 7, tip: 1, fee_allowance: 0 },
    },
    {
      name: "tip on $3: 3.30 up to 4.00",
      in: { base: 3, tip: 0.3, fee_allowance: 0 },
      out: { base: 3, tip: 1, fee_allowance: 0 },
    },
    {
      name: "10% tip on $99: 108.90 up to 109.00",
      in: { base: 99, tip: 9.9, fee_allowance: 0 },
      out: { base: 99, tip: 10, fee_allowance: 0 },
    },
    {
      name: "fee cover on $99: 102.31 up to 103.00 on the allowance",
      in: { base: 99, tip: 0, fee_allowance: 3.31 },
      out: { base: 99, tip: 0, fee_allowance: 4 },
    },
    {
      name: "one cent over a dollar: 100.01 up to 101.00, a 99 cent top-up",
      in: { base: 100, tip: 0.01, fee_allowance: 0 },
      out: { base: 100, tip: 1, fee_allowance: 0 },
    },
    {
      name: "tip and fee cover together: the allowance takes the top-up",
      in: { base: 10, tip: 1.5, fee_allowance: 0.62 },
      out: { base: 10, tip: 1.5, fee_allowance: 1.5 },
    },
    {
      name: "fee cover with the total already whole: 100 + 3 + 0.50 + 1.50 is 105.00, no top-up",
      in: { base: 100, tip: 3.5, fee_allowance: 1.5 },
      out: { base: 100, tip: 3.5, fee_allowance: 1.5 },
    },
    {
      name: "fee cover with the total already whole and no tip: 50 + 2.00 stays",
      in: { base: 50, tip: 0, fee_allowance: 2 },
      out: { base: 50, tip: 0, fee_allowance: 2 },
    },
    {
      name: "tip and allowance both carrying cents: 20 + 2.35 + 0.97 is 23.32, the allowance takes 0.68 to 1.65",
      in: { base: 20, tip: 2.35, fee_allowance: 0.97 },
      out: { base: 20, tip: 2.35, fee_allowance: 1.65 },
    },
  ])("$name", ({ in: input, out }) => {
    expect(whole_dollar_amounts(input)).toEqual(out);
  });
});
