import { describe, expect, test } from "vitest";
import { grant_state, in_window } from "./wise-path";

const NOW = Date.parse("2026-11-16T00:00:00.000Z");
const RECENT = "2026-11-11T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const g = (status: string, date = RECENT, other_id: string | null = "ref") => ({
  status,
  date,
  other_id,
});

describe("in_window", () => {
  test("a transfer sent within 90 days is polled; older is history", () => {
    expect(in_window("2026-08-20T00:00:00.000Z", NOW)).toBe(true);
    expect(in_window("2026-08-10T00:00:00.000Z", NOW)).toBe(false);
  });
});

describe("grant_state", () => {
  test.each([
    ["", "sending"],
    ["incoming_payment_waiting", "sending"],
    ["processing", "sending"],
    ["funds_converted", "sending"],
    ["outgoing_payment_sent", "settled"],
    ["bounced_back", "bounced"],
    ["cancelled", "bounced"],
    ["charged_back", "bounced"],
    ["something_new", "bounced"],
    ["funds_refunded", "returned"],
    ["returned", "returned"],
    ["awaiting_repair", "repair"],
  ])("a recent run stored %s is %s", (status, state) => {
    expect(grant_state(g(status), NOW)).toBe(state);
  });

  test("a run stored on the ordinary path past the poll window is history, settled", () => {
    expect(grant_state(g("funds_converted", OLD), NOW)).toBe("settled");
    expect(grant_state(g("", OLD), NOW)).toBe("settled");
  });

  test("a run with no transfer is settled", () => {
    expect(grant_state(g("", RECENT, null), NOW)).toBe("settled");
  });

  test("a returned run is returned even with no transfer ref on record", () => {
    expect(grant_state(g("returned", RECENT, null), NOW)).toBe("returned");
  });
});
