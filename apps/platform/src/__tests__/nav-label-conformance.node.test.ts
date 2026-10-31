import { describe, expect, it } from "vitest";
import type { LinkGroup } from "#/layout/dashboard";
import { linkGroups as admin_page } from "#/pages/admin/constants";
import { linkGroups as admin } from "#/routes/admin.$id/constants";
import { linkGroups as donor } from "#/routes/dashboard/routes";
import { link_groups as platform } from "#/routes/platform/constants";

// a proper noun added to a menu label goes here, not into the rule
const proper_nouns = new Set<string>();

/** words after the first that open with a capital, minus acronyms and proper nouns */
function title_cased_words(title: string) {
  return title
    .split(/\s+/)
    .slice(1)
    .filter(
      (w) => /^[A-Z]/.test(w) && w !== w.toUpperCase() && !proper_nouns.has(w)
    );
}

const sidebars: Record<string, LinkGroup[]> = {
  admin,
  admin_page,
  donor,
  platform,
};

describe("sidebar link labels are sentence case", () => {
  for (const [name, groups] of Object.entries(sidebars)) {
    it(name, () => {
      const offenders = groups
        .flatMap((g) => g.links)
        .map((l) => l.title)
        .filter((t) => title_cased_words(t).length > 0);
      expect(offenders).toEqual([]);
    });
  }
});
