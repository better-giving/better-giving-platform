/** which of the five public org page layouts a profile takes */
export type TOrgLayout = "card" | "poster" | "letter" | "hub" | "feature";

/** how much room an org's profile content takes: sizes, never its text */
export interface IOrgShape {
  story_chars: number;
  tagline_chars: number;
  name_chars: number;
  has_banner: boolean;
  has_logo: boolean;
  campaigns: number;
  supporters: number;
  programs: number;
  videos: number;
}

/** a story up to this long, or none, fits the hero as its lead */
export const STORY_SHORT_MAX = 320;
/** this many items in total fit one row; more need navigation */
export const ROW_MAX = 3;
/** a name up to this long gets display size; longer steps down a size */
export const NAME_DISPLAY_MAX = 28;
/** past this, Feature cuts the story behind "Read the full story" */
export const STORY_CLAMP = 1200;

export const items_total = (s: IOrgShape): number =>
  s.campaigns + s.supporters + s.programs + s.videos;

/** the layout the size rules give, without Jev */
export function threshold_layout(s: IOrgShape): TOrgLayout {
  // a tagline is the hero's, not a story: it doesn't lift a card to a poster
  if (s.story_chars === 0 && items_total(s) === 0) return "card";
  const short = s.story_chars <= STORY_SHORT_MAX;
  const one_row = items_total(s) <= ROW_MAX;
  if (one_row) return short ? "poster" : "letter";
  return short ? "hub" : "feature";
}
