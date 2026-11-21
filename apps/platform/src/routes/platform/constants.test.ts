import { describe, expect, test } from "vitest";
import { find_active_link } from "#/layout/dashboard/sidebar/active-link";
import { link_groups } from "./constants";

// the layout's `rootRoute`, as `route.tsx` builds it
const ROOT = "/platform/";

describe("platform admin sidebar", () => {
  test("Manual wires sits right after Settle donations", () => {
    const titles = link_groups.flatMap((g) => g.links.map((l) => l.title));
    const settle = titles.indexOf("Settle donations");

    expect(titles.slice(settle, settle + 2)).toEqual([
      "Settle donations",
      "Manual wires",
    ]);
  });

  // the sidebar marks this link and the phone opener reads its title
  test("on /platform/manual-wires, Manual wires is the active link", () => {
    const active = find_active_link(
      link_groups,
      ROOT,
      "/platform/manual-wires"
    );

    expect(active?.link.title).toBe("Manual wires");
    expect(active?.own).toBe(true);
  });
});
