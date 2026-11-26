import { describe, expect, it } from "vitest";
import type { Alert } from "@/slack";
import { alert_text } from "./fixtures/alert-text";

const alert: Alert = {
  from: "charge-dispute-production",
  title: "Stripe dispute opened · $6.00 to Save the Kids",
  fields: [
    {
      name: "Nonprofit",
      value: "Save the Kids (#4)",
      url: "https://app.test/admin/4",
    },
  ],
  note: "Donation stays settled.",
  action: { text: "Respond in the Stripe dashboard.", url: "https://s.test/d" },
  context: ["donation d1 · dispute du_1"],
};

describe("alert_text", () => {
  it("keeps the note, action and ids apart, so a phrase in the wrong one fails", () => {
    const text = alert_text(alert);
    expect(text).toMatch(/^note: Donation stays settled\.$/m);
    expect(text).toMatch(/^action: Respond in the Stripe dashboard\./m);
    expect(text).not.toMatch(/^note: .*Respond/m);
    expect(text).not.toMatch(/^action: .*Donation stays settled/m);
    expect(text).toMatch(/^ids: donation d1 · dispute du_1$/m);
  });

  it("shows links and the sender, so a lost link or sender fails", () => {
    const text = alert_text(alert);
    expect(text).toContain(
      "Nonprofit: Save the Kids (#4) <https://app.test/admin/4>"
    );
    expect(text).toContain("<https://s.test/d>");
    expect(text).toContain("from: charge-dispute-production");
    const bare = alert_text({
      ...alert,
      fields: [{ name: "Nonprofit", value: "Save the Kids (#4)" }],
      action: { text: "Respond in the Stripe dashboard." },
    });
    expect(bare).not.toContain("https://");
  });
});
