import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { $num_gt0_fn, increment_val } from "./index";

describe("a preset amount", () => {
  test.each(["1", "25", "1000", "0.5"])("accepts %j", (x) => {
    const r = v.safeParse(increment_val, x);
    expect(r.success && r.output).toBe(String(+x));
  });

  test.each(["0", "0.0", "-5"])(
    "refuses %j with the message that says so",
    (x) => {
      const r = v.safeParse(increment_val, x);
      expect(r.success).toBe(false);
      expect(r.issues?.[0].message).toBe("must be > 0");
    }
  );
});

describe("$num_gt0_fn, which the fee fields use", () => {
  // a 0 fee is a real answer; only the preset is a button that must pay
  test("still takes a 0", () => {
    const r = v.safeParse($num_gt0_fn(), "0");
    expect(r.success && r.output).toBe("0");
  });
});
