import { describe, expect, it } from "vitest";
import { donation_tag } from "./tag";

describe("donation_tag", () => {
  it.each([
    ["settled", "stripe:card", "Settled", "success"],
    ["settled", "crypto:eth", "Settled", "success"],
    ["intent", "crypto:eth", "Awaiting crypto", "warning"],
    ["intent", "chariot", "Grant pending", "warning"],
    ["intent", "daf", "Grant pending", "warning"],
    ["intent", "stripe:us_bank_account", "Bank verification", "warning"],
    ["confirmed", "crypto:bnb", "Confirming on chain", "warning"],
    ["created", "stripe:card", "Unpaid checkout", "neutral"],
    ["created", "paypal:paypal", "Unpaid checkout", "neutral"],
    ["created", "venmo", "Unpaid checkout", "neutral"],
    ["refunded", "stripe:card", "Refunded", "destructive"],
    ["refunded", "cash", "Refunded", "destructive"],
    ["refunded_loss", "paypal:paypal", "Refunded (loss)", "destructive"],
    ["failed", "stripe:card", "Failed", "destructive"],
    ["failed", "paypal:paypal", "Failed", "destructive"],
    ["failed", "crypto:hbar", "Failed", "destructive"],
    ["expired", "crypto:eth", "Payment expired", "outline"],
    ["expired", "stripe:card", "Checkout expired", "outline"],
    ["cancelled", "chariot", "Grant cancelled", "outline"],
    ["cancelled", "stripe:card", "Campaign deleted", "outline"],
  ])("%s × %s is %s", (status, via, label, variant) => {
    expect(donation_tag(status, via)).toEqual({ label, variant });
  });

  it.each([
    ["intent", "paypal:paypal", "Awaiting funds"],
    ["confirmed", "stripe:card", "Awaiting funds"],
    ["created", "crypto:eth", "Unpaid checkout"],
    ["failed", "daf", "Failed"],
    ["expired", "chariot", "Expired"],
    ["cancelled", "crypto:eth", "Cancelled"],
  ])("a %s × %s pair not in the table reads %s", (status, via, label) => {
    expect(donation_tag(status, via).label).toBe(label);
  });
});
