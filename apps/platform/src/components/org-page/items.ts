import { days_left } from "#/routes/org.$org.$campaign/format";

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

/** "Ends in N days" while more than a day is left, "Ends today" under that,
 * nothing once it has ended or when there is no end date. counts days as the
 * campaign page does, so both surfaces show one number */
export function ends_label(ends_at: string | null, now: number): string | null {
  if (!ends_at) return null;
  const days = days_left(ends_at, now);
  if (days === null) return null;
  if (days === 1) return "Ends today";
  return `Ends in ${days} days`;
}

/** a card names its kind only in a mixed list; a single-kind list's heading
 * already does. videos carry no kind line but still count as a kind */
export function names_kind(items: TOrgItem[]): boolean {
  return new Set(items.map((x) => x.kind)).size > 1;
}
