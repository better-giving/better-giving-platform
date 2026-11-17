import raw from "./comparisons.json";
import type {
  ICompareChip,
  ICompareIndex,
  IComparePage,
  IComparisons,
} from "./types";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Throws on json the routes can't serve as written: a slug that isn't
 * kebab-case (the sitemap and hrefs interpolate it unencoded), a duplicate
 * page slug, or index cards that aren't exactly the page list (a card for a
 * missing page links to a 404).
 */
export function check_comparisons(data: IComparisons): IComparisons {
  const slugs = data.pages.map((p) => p.slug);
  const bad = slugs.filter((s) => !KEBAB.test(s));
  if (bad.length) throw new Error(`compare: non-kebab slugs ${bad}`);

  const pages = new Set(slugs);
  if (pages.size !== slugs.length) {
    throw new Error("compare: duplicate page slugs");
  }

  const cards = data.index.cards.map((c) => c.slug);
  const orphans = cards.filter((s) => !pages.has(s));
  const unlisted = slugs.filter((s) => !cards.includes(s));
  if (orphans.length || unlisted.length || cards.length !== slugs.length) {
    throw new Error(
      `compare: index cards don't match pages (no page: ${orphans}; no card: ${unlisted})`
    );
  }
  return data;
}

// the json is the reviewed copy and is rendered as written; this module types
// it and checks the slugs. import it from loaders: the route's client bundle
// then carries the one page it shows, not every comparison.
const data = check_comparisons(raw as unknown as IComparisons);

export const compare_generated: string = data.generated;
export const compare_index: ICompareIndex = data.index;
export const compare_pages: IComparePage[] = data.pages;

export const compare_chips = (): ICompareChip[] =>
  data.pages.map(({ slug, competitor }) => ({ slug, competitor }));

export const compare_page = (slug: string): IComparePage | undefined =>
  data.pages.find((p) => p.slug === slug);
