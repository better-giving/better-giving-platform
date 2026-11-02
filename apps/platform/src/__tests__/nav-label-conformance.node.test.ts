import { describe, expect, it } from "vitest";
import type { LinkGroup } from "#/layout/dashboard";
import { linkGroups as admin_page } from "#/pages/admin/constants";
import { linkGroups as admin } from "#/routes/admin.$id/constants";
import { linkGroups as donor } from "#/routes/dashboard/routes";
import { link_groups as platform } from "#/routes/platform/constants";
import { sources_of } from "./conformance/walk";

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

// a page's h1 and meta title echo its menu label, so they follow the same rule
const PAGE_DIRS =
  /^apps\/platform\/src\/routes\/(dashboard|admin\.\$id|platform)[._/]/;
// literal text only — an expression child or a template title is data
const TITLE_LITERALS = [
  /<h1\b[^>]*>\s*([^<{]+?)\s*<\/h1>/g,
  /\bmetas\(\{\s*title:\s*"([^"]+)"/g,
  /\badmin_page_meta\(\s*"([^"]+)"/g,
];

describe("page titles are sentence case", () => {
  it("h1 and meta title literals under dashboard, admin and platform routes", () => {
    const offenders = sources_of(import.meta.url)
      .filter((s) => PAGE_DIRS.test(s.file) && !s.file.includes(".test."))
      .flatMap((s) =>
        TITLE_LITERALS.flatMap((re) =>
          [...s.text.matchAll(re)].map((m) => ({ file: s.file, title: m[1] }))
        )
      )
      // " - " joins title segments (`${page} - ${org}`); each opens with a capital
      .filter(({ title }) =>
        title.split(" - ").some((seg) => title_cased_words(seg).length > 0)
      );
    expect(offenders).toEqual([]);
  });
});

// the active sidebar row already names a dashboard page, so its h1 is sr-only;
// a nested page's h1 is the last item of `Breadcrumb`, which lives in ui
const DASHBOARD_DIRS =
  /^apps\/platform\/src\/(routes\/(dashboard|admin\.\$id|platform)[._/]|pages\/(admin|platform-admin|user-dashboard)\/)/;
// the donor home's profile header (avatar + name) is content, not a title
const VISIBLE_H1_EXEMPT = new Set([
  "apps/platform/src/routes/dashboard._index.tsx",
]);

describe("dashboard pages draw no visible title", () => {
  it("every <h1> under dashboard, admin and platform routes is sr-only", () => {
    const offenders = sources_of(import.meta.url)
      .filter(
        (s) =>
          DASHBOARD_DIRS.test(s.file) &&
          !s.file.includes(".test.") &&
          !VISIBLE_H1_EXEMPT.has(s.file)
      )
      .flatMap((s) =>
        [...s.text.matchAll(/<h1\b[^>]*>/g)]
          .filter((m) => !/className="[^"]*\bsr-only\b/.test(m[0]))
          .map((m) => ({ file: s.file, tag: m[0] }))
      );
    expect(offenders).toEqual([]);
  });
});
