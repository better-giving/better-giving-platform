import { describe, expect, it } from "vitest";
import { reveal_delay } from "./reveal";

const steps = (k: number) =>
  reveal_delay(k)
    .transitionDelay?.toString()
    .match(/\* (\d+) \//)?.[1];

describe("reveal_delay", () => {
  it("grows one step per index, then holds from the fifth item on", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 40].map(steps)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "4",
      "4",
      "4",
    ]);
  });

  it("is a third of the fast step per index", () => {
    expect(reveal_delay(2).transitionDelay).toBe(
      "calc(var(--duration-fast) * 2 / 3)"
    );
  });
});
