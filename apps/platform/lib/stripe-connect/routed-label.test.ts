import { describe, expect, test } from "vitest";
import { routed_kind, routed_label } from "./sent";

describe("routed_kind", () => {
  test.each([
    ["transferred", { transfer_id: "tr_1", reversed: false }, "paid"],
    [
      "transferred then refunded",
      { transfer_id: "tr_1", reversed: true },
      "reversed",
    ],
    [
      "waiting for its transfer",
      { transfer_id: null, reversed: false },
      "sending",
    ],
    [
      "refunded before its transfer",
      { transfer_id: null, reversed: true },
      "not_sent",
    ],
  ] as const)("%s", (_, d, kind) => {
    expect(routed_kind(d)).toBe(kind);
  });
});

describe("routed_label", () => {
  test("a refunded routed donation reads the same wherever it is shown", () => {
    expect(routed_label("reversed")).toBe("Fully reversed");
    expect(routed_label("not_sent")).toBe("Not sent to Stripe");
  });
});
