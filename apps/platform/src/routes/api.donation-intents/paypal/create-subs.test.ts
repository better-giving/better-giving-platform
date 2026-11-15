import { describe, expect, it } from "vitest";
import { subscription_quantity } from "./create-subs";

describe("subscription_quantity", () => {
  it.each([
    ["1", "1"],
    ["26.04", "26.04"],
    ["1620", "1620"],
    ["99999", "99999"],
    ["99999.99", "99999.99"],
  ])("sends %s as %s", (total, sent) => {
    expect(subscription_quantity(total)).toBe(sent);
  });

  it.each([
    ["over the ceiling", "100000"],
    ["over the ceiling with cents", "100000.00"],
    ["a seven digit total", "1234567.89"],
    ["exponent notation", "1e5"],
    ["a negative", "-5"],
    ["a trailing point", "12."],
    ["a thousands separator", "1,000"],
    ["not a number", "abc"],
    ["empty", ""],
    ["zero", "0.00"],
  ])("cannot represent %s", (_, total) => {
    expect(subscription_quantity(total)).toBeNull();
  });
});
