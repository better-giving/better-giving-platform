import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { schema as transfer } from "./transfer-form/types";
import { schema as withdraw } from "./withdraw-form/types";

const bals = { liq: 1_000_000, lock: 1_000_000 };
const run = (schema: typeof withdraw | typeof transfer, amount: string) =>
  v.safeParse(schema, { amount, source: "liq", bals });

const BAD_FORMAT = "Enter a number, like 1250.50";
const NOT_POSITIVE = "amount must be greater than 0";

describe.each([
  ["withdraw", withdraw],
  ["transfer", transfer],
])("%s amount", (_, schema) => {
  test.each([
    ["9,627.92", "9627.92"],
    ["$100", "100"],
    [" 100 ", "100"],
    ["1,000", "1000"],
  ])("accepts %j", (input, out) => {
    const r = run(schema, input);
    expect(r.success).toBe(true);
    expect(r.success && r.output.amount).toBe(out);
  });

  test.each([
    ["abc", BAD_FORMAT],
    ["1.2.3", BAD_FORMAT],
    ["1.234", BAD_FORMAT],
    ["0", NOT_POSITIVE],
    ["-5", NOT_POSITIVE],
  ])("rejects %j", (input, msg) => {
    const r = run(schema, input);
    expect(r.success).toBe(false);
    expect(r.issues?.[0].message).toBe(msg);
  });

  test("still checks the balance", () => {
    const r = v.safeParse(schema, {
      amount: "1,000.01",
      source: "liq",
      bals: { liq: 1000, lock: 0 },
    });
    expect(r.issues?.[0].message).toBe("amount exceeds balance");
  });
});
