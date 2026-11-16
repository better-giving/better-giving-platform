import type {
  ICompareIncludeItem,
  ICompareSource,
} from "#/content/compare/types";

const long_date = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  // the stored value is a calendar date: read it as UTC so no viewer's zone
  // moves it a day
  timeZone: "UTC",
});

/** "2026-11-16" -> "November 16, 2026" */
export const long_date_of = (iso: string) =>
  long_date.format(new Date(`${iso}T00:00:00Z`));

/** source id -> the 1-based number a superscript shows and `#s<n>` targets */
export const source_numbers = (sources: ICompareSource[]) =>
  new Map(sources.map((s, i) => [s.id, i + 1]));

/** the index page's sources: each source once, numbered by first appearance
 * through the includes, then the steps */
export const index_sources = (
  ...groups: ICompareIncludeItem[][]
): ICompareSource[] => {
  const seen = new Map<string, ICompareSource>();
  for (const item of groups.flat())
    for (const s of item.sources) if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()];
};

/** `who_each_suits` is two claims, one per platform; the second always opens
 * "Better Giving suits". Any other shape stays one block. */
export const split_suits = (text: string): string[] => {
  const at = text.search(/(?<=\.)\s+Better Giving suits /);
  if (at < 0) return [text];
  return [text.slice(0, at), text.slice(at).trim()];
};
