import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { amount as donation_amount } from "#/components/donation/types";
import { target as goal } from "#/components/goal-selector/types";
import { amount as npo_payout_min } from "#/routes/admin.$id.dashboard.payout-min/route";
import { schema as program } from "#/routes/admin.$id.program-editor.$program_id/program-info/schema";
import { schema as referrer } from "#/routes/dashboard.referrals.payout-min/route";
import { ogInput } from "#/types/donation-calculator";
import { increment_val, target } from "@/schemas";
import { amount_format_err, amount_places_err } from "@/schemas/amount";

/** every money field, as its schema reads the plain decimal the mask stores:
 * what a valid entry parses to, and how the entry is refused */
const fields: {
  name: string;
  union?: boolean;
  /** whole dollars only: no cents in what it reads */
  whole?: boolean;
  /** a goal or preset: a stored value with more decimals than the mask types
   * must still parse, or it blocks a save of the fields beside it */
  stored?: boolean;
  /** outputs the plain decimal string, not a number */
  str?: boolean;
  /** parses `x`, returning the parsed value or the first issue message */
  read: (
    x: string
  ) => { ok: true; value: unknown } | { ok: false; msg: string };
}[] = [
  {
    name: "donation amount",
    read: (x) => wrap(v.safeParse(donation_amount({ required: true }), x)),
    str: true,
  },
  {
    name: "campaign fixed goal",
    read: (x) => wrap(v.safeParse(goal, { type: "fixed", value: x }), "value"),
    stored: true,
    str: true,
  },
  {
    name: "preset donation amount",
    read: (x) => wrap(v.safeParse(increment_val, x)),
    stored: true,
    str: true,
  },
  {
    name: "program target raise",
    read: (x) => wrap(v.safeParse(program.entries.target_raise, x)),
    stored: true,
    str: true,
  },
  {
    name: "nonprofit payout minimum",
    read: (x) => wrap(v.safeParse(npo_payout_min, x)),
  },
  {
    name: "referrer payout minimum",
    read: (x) => wrap(v.safeParse(referrer.entries.amount, x)),
    whole: true,
  },
  {
    name: "donation calculator amount",
    read: (x) => wrap(v.safeParse(ogInput.entries.amnt, x)),
  },
  {
    name: "fixed target (server)",
    // a union with "smart": its refusal is the union's, not the parser's
    read: (x) => wrap(v.safeParse(target, x)),
    union: true,
    stored: true,
    str: true,
  },
];

function wrap(
  r: v.SafeParseResult<any>,
  pick?: string
): { ok: true; value: unknown } | { ok: false; msg: string } {
  if (!r.success) return { ok: false, msg: r.issues[0].message };
  return { ok: true, value: pick ? (r.output as any)[pick] : r.output };
}

describe("referrer payout minimum", () => {
  // the threshold is stored in an integer column
  test("refuses cents", () => {
    expect(wrap(v.safeParse(referrer.entries.amount, "100.50"))).toEqual({
      ok: false,
      msg: amount_places_err(0),
    });
  });

  test("its format message shows no cents", () => {
    expect(wrap(v.safeParse(referrer.entries.amount, "abc"))).toEqual({
      ok: false,
      msg: amount_format_err(0),
    });
  });
});

describe("campaign fixed goal", () => {
  // the mask keeps leading zeros: deleting the 1 of "1,000" leaves "000", and
  // a fixed goal of 0 would save as no goal
  test.each(["0", "000", "0.00"])("refuses %j", (x) => {
    expect(
      wrap(v.safeParse(goal, { type: "fixed", value: x }), "value")
    ).toEqual({ ok: false, msg: "must be greater than 0" });
  });
});

describe.each(fields)("$name", ({ read, union, whole, stored, str }) => {
  test("reads the plain decimal the mask stores", () => {
    const r = read(whole ? "9627" : "9627.92");
    expect(r.ok && Number(r.value)).toBe(whole ? 9627 : 9627.92);
  });

  test.each([
    ["$1,000", 1000],
    [" 100 ", 100],
    ["9,627.92", 9627.92],
  ])("reads a paste of %j", (x, out) => {
    const r = read(whole ? x.replace(/\.\d+$/, "") : x);
    expect(r.ok && Number(r.value)).toBe(whole ? Math.trunc(out) : out);
  });

  test.each(["12,50", "abc", "1.2.3"])("refuses %j", (x) => {
    const r = read(x);
    expect(r.ok).toBe(false);
    if (!union) {
      expect(r).toEqual({ ok: false, msg: amount_format_err(whole ? 0 : 2) });
    }
  });

  test.runIf(stored)("reads a stored value with extra decimals", () => {
    const r = read("1234.567");
    expect(r.ok && Number(r.value)).toBe(1234.567);
  });

  test.runIf(str)("writes a tiny value as a plain decimal", () => {
    expect(read("0.0000001")).toEqual({ ok: true, value: "0.0000001" });
  });
});
