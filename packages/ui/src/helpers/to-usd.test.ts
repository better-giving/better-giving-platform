import { describe, expect, it } from "vitest";
import { to_usd } from "./to-usd";

describe("to_usd", () => {
  it("is whole dollars by default", () => {
    expect(to_usd(7900)).toBe("$7,900");
    expect(to_usd(0)).toBe("$0");
  });
  it("shows cents with decimals 2, no space after the sign", () => {
    expect(to_usd(0, 2)).toBe("$0.00");
    expect(to_usd(1234.5, 2)).toBe("$1,234.50");
    expect(to_usd(-12.5, 2)).toBe("-$12.50");
  });
  it("shortens from a million up", () => {
    expect(to_usd(1_200_000)).toBe("$1.20M");
    expect(to_usd(3_400_000_000, 2)).toBe("$3.40B");
  });
});
