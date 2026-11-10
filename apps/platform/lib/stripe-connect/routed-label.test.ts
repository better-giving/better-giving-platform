import { describe, expect, test } from "vitest";
import { routed_kind, routed_label, SENDING_WINDOW_MS } from "./sent";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("routed_kind", () => {
  test.each([
    [
      "transferred",
      { transfer_id: "tr_1", reversed: false, routed_at: ago(0) },
      "paid",
    ],
    [
      "transferred then refunded",
      { transfer_id: "tr_1", reversed: true, routed_at: ago(0) },
      "reversed",
    ],
    [
      "waiting for its transfer",
      { transfer_id: null, reversed: false, routed_at: ago(60_000) },
      "sending",
    ],
    [
      "refunded before its transfer",
      { transfer_id: null, reversed: true, routed_at: ago(60_000) },
      "not_sent",
    ],
    [
      "still without a transfer past the window",
      {
        transfer_id: null,
        reversed: false,
        routed_at: ago(SENDING_WINDOW_MS + 1),
      },
      "not_sent",
    ],
  ] as const)("%s", (_, d, kind) => {
    expect(routed_kind(d, NOW)).toBe(kind);
  });
});

describe("routed_label", () => {
  test("a refunded routed donation reads the same wherever it is shown", () => {
    expect(routed_label("reversed")).toBe("Fully reversed");
    expect(routed_label("not_sent")).toBe("Not sent to Stripe");
    expect(routed_label("kept")).toBe("Refunded, owed to Better Giving");
  });
});
