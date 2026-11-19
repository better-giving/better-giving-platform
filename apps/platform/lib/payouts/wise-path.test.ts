import { describe, expect, test } from "vitest";
import { DELIVERED_STATES, grant_state, ON_PATH, PAID } from "./wise-path";

const g = (status: string, other_id: string | null = "ref") => ({
  status,
  other_id,
});

describe("grant_state", () => {
  test.each([
    ["", "sending"],
    ["incoming_payment_waiting", "sending"],
    ["processing", "sending"],
    ["funds_converted", "sending"],
    ["outgoing_payment_sent", "settled"],
    // written before wise's own states were kept: delivered
    ["settled", "settled"],
    ["bounced_back", "bounced"],
    ["charged_back", "bounced"],
    ["something_new", "bounced"],
    ["funds_refunded", "returned"],
    ["returned", "returned"],
    ["awaiting_repair", "repair"],
  ])("a run stored %s is %s, whatever its age", (status, state) => {
    expect(grant_state(g(status))).toBe(state);
  });

  test("a cancelled run is a bounce only when wise bounced a payout of it", () => {
    expect(grant_state({ ...g("cancelled"), bounced: true })).toBe("bounced");
    expect(grant_state(g("cancelled"))).toBe("settled");
  });

  test("a run paid by another route is settled, delivered and on the path", () => {
    expect(PAID).toBe("paid");
    expect(grant_state({ status: "paid", other_id: "mercury-1" })).toBe(
      "settled"
    );
    expect(DELIVERED_STATES).toContain(PAID);
    expect(ON_PATH).toContain(PAID);
  });

  test("a run with no transfer is settled", () => {
    expect(grant_state(g("", null))).toBe("settled");
  });

  test("a returned run is returned even with no transfer ref on record", () => {
    expect(grant_state(g("returned", null))).toBe("returned");
  });
});
