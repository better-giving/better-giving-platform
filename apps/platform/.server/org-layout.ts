import {
  type IOrgShape,
  ROW_MAX,
  STORY_SHORT_MAX,
  type TOrgLayout,
  threshold_layout,
} from "@/org-shape";
import { type IJevChoice, jev_choice } from "./jev";

const SHORT = `story up to about ${STORY_SHORT_MAX} characters (or none)`;
const LONG = `story longer than about ${STORY_SHORT_MAX} characters`;
const ONE_ROW = `0–${ROW_MAX} items in total`;
const MANY = `${ROW_MAX + 1} or more items in total`;
const POSTER = `a short story (up to about ${STORY_SHORT_MAX} characters) and ${ONE_ROW}, or no story and 1–${ROW_MAX} items`;

const LAYOUT_QUESTION: IJevChoice<TOrgLayout> = {
  instructions:
    "Which layout should this nonprofit's public profile page use, given how much room its content takes? Story length is plain-text characters. Items are its campaigns, supporter campaigns, programs and videos together. Banner, logo, tagline and name length shape the hero inside any layout, not the choice between them.",
  criteria: {
    card: "no story at all and 0 items: a compact centered identity card with Donate",
    poster: `${POSTER}: hero-led, a single screen with who they are, why, Donate, and up to ${ROW_MAX} ways to help`,
    letter: `${LONG} and ${ONE_ROW}: editorial, a reading column with a large lead, the ways to help at the end, and a slim give bar that follows the reader`,
    hub: `${SHORT} and ${MANY}: a compact identity header, then a tab for each kind of item, with counts`,
    feature: `${LONG} and ${MANY}: the story beside a sticky give panel, then one swipeable row per kind of item`,
  },
};

type TPick = { layout: TOrgLayout; by: "jev" | "threshold" };

interface IPickerOpts {
  /** shapes remembered; past this the oldest answer goes first */
  max?: number;
  ttl_ms?: number;
  now?: () => number;
}

/**
 * Jev picks the layout from the measures; with no answer from Jev (no key,
 * timeout, error), the size rules do for that render. Jev's answer is kept per
 * shape so the same shape renders the same layout on every render this server
 * instance serves; a fallback is never kept, so the next render asks Jev again.
 */
export function make_layout_picker({
  max = 500,
  ttl_ms = 24 * 60 * 60 * 1000,
  now = Date.now,
}: IPickerOpts = {}) {
  const answers = new Map<string, { layout: TOrgLayout; at: number }>();
  // renders of one shape that overlap share one question, so they can't get
  // two answers or pay for two calls
  const asking = new Map<string, Promise<TOrgLayout | null>>();

  const ask = async (key: string, shape: IOrgShape) => {
    // spread: an interface has no index signature, so isn't a Record
    const answer = await jev_choice({ ...shape }, LAYOUT_QUESTION);
    // card has no story slot: taking it for an org with a story would hide the story
    const layout = answer === "card" && shape.story_chars > 0 ? null : answer;
    if (!layout) return null;
    if (answers.size >= max) {
      // a Map iterates in insertion order, so the first key is the oldest
      answers.delete(answers.keys().next().value as string);
    }
    answers.set(key, { layout, at: now() });
    return layout;
  };

  return async function pick_layout(shape: IOrgShape): Promise<TPick> {
    const key = shape_key(shape);
    const kept = answers.get(key);
    if (kept && now() - kept.at < ttl_ms) {
      return { layout: kept.layout, by: "jev" };
    }
    answers.delete(key);

    let pending = asking.get(key);
    if (!pending) {
      pending = ask(key, shape).finally(() => asking.delete(key));
      asking.set(key, pending);
    }
    const layout = await pending;
    if (!layout) return { layout: threshold_layout(shape), by: "threshold" };
    return { layout, by: "jev" };
  };
}

/** the shape as a string, its keys sorted so key order can't split one shape */
const shape_key = (shape: IOrgShape) =>
  JSON.stringify(shape, Object.keys(shape).sort());

export const pick_layout = make_layout_picker();
