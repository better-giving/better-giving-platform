import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { GoalBar } from "./goal-bar";

function range_of(el: HTMLElement) {
  const range = el.querySelector<HTMLElement>("[data-part='range']");
  if (!range) throw new Error("no range part");
  return range;
}

describe("GoalBar", () => {
  test("a gift far short of the goal still shows a visible fill", async () => {
    const screen = await render(
      <div style={{ width: 300 }}>
        <GoalBar raised={5} goal={100_000} />
      </div>
    );
    const range = range_of(screen.container);
    expect(range.getBoundingClientRect().width).toBeGreaterThanOrEqual(4);
  });

  test("nothing raised shows no fill", async () => {
    const screen = await render(
      <div style={{ width: 300 }}>
        <GoalBar raised={0} goal={1000} />
      </div>
    );
    expect(range_of(screen.container).getBoundingClientRect().width).toBe(0);
  });

  test("a goal of 0 renders a real width, not NaN", async () => {
    const screen = await render(
      <div style={{ width: 300 }}>
        <GoalBar raised={0} goal={0} />
        <GoalBar raised={250} goal={0} />
      </div>
    );
    const [empty, met] = [
      ...screen.container.querySelectorAll<HTMLElement>("[data-part='range']"),
    ];
    expect(empty.style.width).not.toContain("NaN");
    expect(met.style.width).not.toContain("NaN");
    expect(empty.getBoundingClientRect().width).toBe(0);
    // anything raised has met a goal of 0
    expect(met.getBoundingClientRect().width).toBe(300);
  });
});
