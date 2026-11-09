import { afterEach, describe, expect, test } from "vitest";
import { to_pretty_utc, to_utc_day } from "./date";

const tz = process.env.TZ;

afterEach(() => {
  process.env.TZ = tz;
});

describe("to_pretty_utc", () => {
  // 02:30 UTC is still the previous evening in new york, so a local-zone
  // rendering shows a different day and hour under the same "(UTC)" label
  test("prints the UTC wall clock whatever zone the process runs in", () => {
    process.env.TZ = "America/New_York";

    expect(to_pretty_utc("2026-09-21T02:30:05.000Z")).toBe(
      "2026-09-21 02:30:05 (UTC)"
    );
    expect(to_pretty_utc(new Date("2026-09-21T02:30:05.000Z"))).toBe(
      "2026-09-21 02:30:05 (UTC)"
    );
  });
});

describe("to_utc_day", () => {
  // midnight UTC is still the evening before in los angeles
  const AT = "2026-07-04T00:00:00Z";

  test("prints the UTC day whatever zone the process runs in", () => {
    process.env.TZ = "America/Los_Angeles";
    // the zone took: a local-zone formatter would print the day before
    expect(
      new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
        new Date(AT)
      )
    ).toBe("Jul 3, 2026");

    expect(to_utc_day(AT)).toBe("Jul 4, 2026");
    expect(to_utc_day(new Date(AT))).toBe("Jul 4, 2026");
  });
});
