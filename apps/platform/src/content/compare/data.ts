import raw from "./comparisons.json";
import type {
  ICompareChip,
  ICompareIndex,
  IComparePage,
  IComparisons,
} from "./types";

// the json is the reviewed copy and is rendered as written; this module only
// types it. import it from loaders: the route's client bundle then carries the
// one page it shows, not all eighteen.
const data = raw as unknown as IComparisons;

export const compare_generated: string = data.generated;
export const compare_index: ICompareIndex = data.index;
export const compare_pages: IComparePage[] = data.pages;

export const compare_chips = (): ICompareChip[] =>
  data.pages.map(({ slug, competitor }) => ({ slug, competitor }));

export const compare_page = (slug: string): IComparePage | undefined =>
  data.pages.find((p) => p.slug === slug);
