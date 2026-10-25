/** a campaign or supporter campaign the org page links to */
export interface IGiveItem {
  kind: "campaign" | "supporter";
  id: string;
  title: string;
  to: string;
  /** 4:1, as uploaded */
  image: string | null;
  raised: number;
  goal: number | null;
  /** ISO 8601 */
  ends_at: string | null;
  /** "by Jane" or "with Acme", formatted by the caller */
  byline: string | null;
  excerpt: string;
}

export interface IProgramItem {
  kind: "program";
  id: string;
  title: string;
  to: string;
  /** 4:1, as uploaded */
  image: string | null;
  summary: string;
  goal: number | null;
  raised: number;
}

export interface IVideoItem {
  kind: "video";
  id: string;
  /** a YouTube link */
  url: string;
  title: string | null;
}

export type TOrgItem = IGiveItem | IProgramItem | IVideoItem;

/** a donor message, without its amount: the org page never shows one */
export interface IDonorMessage {
  id: string;
  name: string;
  message: string;
}

const DAY = 86_400_000;

/** "Ends in N days" while more than a day is left, "Ends today" under that,
 * nothing once it has ended or when there is no end date. whole days elapsed,
 * not calendar days, so the server and the browser agree whatever their zones */
export function ends_label(ends_at: string | null, now: number): string | null {
  if (!ends_at) return null;
  const left = Date.parse(ends_at) - now;
  if (!(left > 0)) return null;
  if (left < DAY) return "Ends today";
  const days = Math.floor(left / DAY);
  return days === 1 ? "Ends in 1 day" : `Ends in ${days} days`;
}

/** a card names its kind only in a mixed list; a single-kind list's heading
 * already does. videos carry no kind line but still count as a kind */
export function names_kind(items: TOrgItem[]): boolean {
  return new Set(items.map((x) => x.kind)).size > 1;
}
