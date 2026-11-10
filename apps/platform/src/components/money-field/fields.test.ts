import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { amount as donation_amount } from "#/components/donation/types";
import { target as goal } from "#/components/goal-selector/types";
import { amount as npo_payout_min } from "#/routes/admin.$id.dashboard.payout-min/route";
import { schema as program } from "#/routes/admin.$id.program-editor.$program_id/program-info/schema";
import { schema as referrer } from "#/routes/dashboard.referrals.payout-min/route";
import { ogInput } from "#/types/donation-calculator";
import { target } from "@/schemas";
import { amount_format_err } from "@/schemas/amount";

/** every money field, as its schema reads the plain decimal the mask stores:
 * what a valid entry parses to, and how the entry is refused */
const fields: {
  name: string;
  union?: boolean;
  /** whole dollars only: no cents in what it reads */
  whole?: boolean;
  /** parses `x`, returning the parsed value or the first issue message */
  read: (
    x: string
  ) => { ok: true; value: unknown } | { ok: false; msg: string };
}[] = [
  {
    name: "donation amount",
    read: (x) => wrap(v.safeParse(donation_amount({ required: true }), x)),
  },
  {
    name: "campaign fixed goal",
    read: (x) => wrap(v.safeParse(goal, { type: "fixed", value: x }), "value"),
  },
  {
    name: "program target raise",
    read: (x) => wrap(v.safeParse(program.entries.target_raise, x)),
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
      msg: amount_format_err,
    });
  });
});

describe.each(fields)("$name", ({ read, union, whole }) => {
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
    if (!union) expect(r).toEqual({ ok: false, msg: amount_format_err });
  });
});
