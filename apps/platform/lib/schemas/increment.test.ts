import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { increment_val } from "./index";

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
