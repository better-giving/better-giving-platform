import {
  CircleCheck,
  Info,
  type LucideIcon,
  Printer,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardBody, CardHeader } from "./card";

/** one question: its id is what persists, so rename an id and the tick is
 *  dropped on the next restore. */
export type ChecklistItem = {
  id: string;
  text: string;
  /** a flagged item: the badge before its text, and the tally counts it. */
  flag?: boolean;
  /** a line under the text, `text-xs` gray-11. */
  note?: string;
};
export type ChecklistSection = {
  id: string;
  title: string;
  /** the line under the title. */
  sub?: string;
  items: ChecklistItem[];
};

/** the four verdicts, in the order they are checked: nothing ticked; a
 *  flagged item unticked; every flagged item ticked with items left; all. */
export type Tier = "empty" | "gaps" | "flags_clear" | "done";
export type Tone = "neutral" | "warning" | "success";

export type ChecklistWords = {
  /** the flag badge, on each flagged item and in the legend. */
  flag: string;
  /** the legend's sentence after the badge. */
  legend: string;
  /** the status card's accessible name. */
  score: string;
  /** the words after the ticked figure, given the number of items. */
  count: (total: number) => string;
  /** each tier's headline and the line under it. */
  verdict: Record<Tier, { headline: string; sub: string }>;
  /** the tally while nothing is ticked: the flagged items to check. */
  to_check: (flag_total: number) => string;
  /** the tally while a flagged item is unticked. */
  unchecked: (missing: number) => string;
  /** the tally once every flagged item is ticked. */
  clear: string;
  print: string;
  reset: string;
  /** the confirm line's question, given the ticks it would clear. */
  confirm: (done: number) => string;
  /** the confirm line's accessible name. */
  confirm_label: string;
  clear_all: string;
  keep: string;
};

const items_word = (n: number) => `priority item${n === 1 ? "" : "s"}`;

/** the item's own words: neutral, for any list. an app passes its own
 *  through `words`. */
export const DEFAULT_WORDS: ChecklistWords = {
  flag: "Priority",
  legend: "Items that matter most. If you can't check one, find out why.",
  score: "Your score",
  count: (total) => `of ${total} checked`,
  verdict: {
    empty: {
      headline: "Start ticking boxes",
      sub: "Your score updates as you go.",
    },
    gaps: {
      headline: "Gaps to raise",
      sub: "Some items are still unchecked. The flagged ones matter most.",
    },
    flags_clear: {
      headline: "No red flags, with a few items left",
      sub: "Every flagged item is checked. Finish the remaining items.",
    },
    done: {
      headline: "Every item checked",
      sub: "The whole list is complete.",
    },
  },
  to_check: (n) => `${n} ${items_word(n)} to check`,
  unchecked: (n) => `${n} ${items_word(n)} unchecked`,
  clear: "All priority items clear",
  print: "Print or save as PDF",
  reset: "Reset all",
  confirm: (n) =>
    n === 1
      ? "Clear your 1 tick? This can't be undone."
      : `Clear all ${n} ticks? This can't be undone.`,
  confirm_label: "Confirm reset",
  clear_all: "Clear all ticks",
  keep: "Keep my ticks",
};

export type WordsOverride = Partial<Omit<ChecklistWords, "verdict">> & {
  verdict?: Partial<ChecklistWords["verdict"]>;
};

const merged = (words: WordsOverride = {}): ChecklistWords => ({
  ...DEFAULT_WORDS,
  ...words,
  verdict: { ...DEFAULT_WORDS.verdict, ...words.verdict },
});

/** the tier and its tone from the ticks: `done` of `total` ticked,
 *  `flags_done` of them flagged, of `flag_total` flagged in all. */
export function verdict_for(
  done: number,
  flags_done: number,
  total: number,
  flag_total: number
): { tier: Tier; tone: Tone; missing: number } {
  const missing = flag_total - flags_done;
  if (done === 0) return { tier: "empty", tone: "neutral", missing };
  if (missing > 0) return { tier: "gaps", tone: "warning", missing };
  if (done < total) return { tier: "flags_clear", tone: "success", missing };
  return { tier: "done", tone: "success", missing };
}

/** the bar's width: the share ticked to one decimal, `"32.1%"`. */
export const bar_width = (done: number, total: number) =>
  total === 0 ? "0%" : `${((done / total) * 100).toFixed(1)}%`;

/** the stored ticks, kept to the ids still in the list. a missing key,
 *  malformed json or a non-array is nothing to restore: null. */
export function restored(
  raw: string | null,
  ids: ReadonlySet<string>
): Set<string> | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const kept = parsed.filter(
    (v): v is string => typeof v === "string" && ids.has(v)
  );
  return kept.length > 0 ? new Set(kept) : null;
}

/** full literal class strings, never composed: tailwind v4 is a jit over
 *  source text. a neutral (gray), warning or success tone, with the notice
 *  card's fill, edge and ink. */
const tones: Record<Tone, { icon: LucideIcon; vars: string }> = {
  neutral: {
    icon: Info,
    vars: "[--tone-fill:var(--gray-3)] [--tone-edge:var(--gray-6)] [--tone-ink:var(--gray-11)]",
  },
  warning: {
    icon: TriangleAlert,
    vars: "[--tone-fill:var(--warning-subtle)] [--tone-edge:var(--warning-6)] [--tone-ink:var(--warning-11)]",
  },
  success: {
    icon: CircleCheck,
    vars: "[--tone-fill:var(--success-subtle)] [--tone-edge:var(--success-6)] [--tone-ink:var(--success-11)]",
  },
};

// the fill's shadow is a smudge at 0 wide, and the fill turns success only
// with every item ticked
const fill_class = {
  empty: "bg-primary",
  part: "bg-primary shadow-track-fill",
  met: "bg-success shadow-track-fill",
};

type ViewProps = {
  sections: readonly ChecklistSection[];
  /** the ticked ids. */
  checked: ReadonlySet<string>;
  /** the confirm line in place of the controls row. */
  confirming: boolean;
  on_toggle: (id: string) => void;
  on_print: () => void;
  /** Reset all: open the confirm line. */
  on_ask_reset: () => void;
  /** Clear all ticks. */
  on_reset: () => void;
  /** Keep my ticks. */
  on_keep: () => void;
  words?: WordsOverride;
  /** appended last, on the root. */
  classes?: string;
};

/** the checklist drawn from its state: the legend, the status card (count,
 *  tally, bar, verdict), the controls or the confirm line, and a card per
 *  section. `Checklist` holds the state; this is it without storage. */
export function ChecklistView({
  sections,
  checked,
  confirming,
  on_toggle,
  on_print,
  on_ask_reset,
  on_reset,
  on_keep,
  words: words_in,
  classes = "",
}: ViewProps) {
  const words = merged(words_in);
  const uid = useId();
  const items = sections.flatMap((s) => s.items);
  const total = items.length;
  const flagged = items.filter((i) => i.flag);
  const flag_total = flagged.length;
  const done = items.filter((i) => checked.has(i.id)).length;
  const flags_done = flagged.filter((i) => checked.has(i.id)).length;
  const { tier, tone, missing } = verdict_for(
    done,
    flags_done,
    total,
    flag_total
  );
  const { icon: Icon, vars } = tones[tone];
  const state = done === 0 ? "empty" : done === total ? "met" : "part";

  // the control the swap removed hands focus to the one it brings: Keep my
  // ticks when the confirm line opens, Reset all when it closes. keyed on the
  // change, so a view that mounts confirming moves nothing
  const keep_ref = useRef<HTMLButtonElement>(null);
  const reset_ref = useRef<HTMLButtonElement>(null);
  const was_confirming = useRef(confirming);
  useEffect(() => {
    if (was_confirming.current === confirming) return;
    was_confirming.current = confirming;
    (confirming ? keep_ref : reset_ref).current?.focus();
  }, [confirming]);

  return (
    <div
      className={`flex flex-col gap-4 text-gray-12 [print-color-adjust:exact] sm:gap-5 ${classes}`}
    >
      {flag_total > 0 && (
        // inline, so on a phone the sentence runs on after the badge
        <p className="text-sm">
          <Badge variant="warning" classes="me-2">
            {words.flag}
          </Badge>
          <span className="text-gray-11">{words.legend}</span>
        </p>
      )}

      <Card
        aria-label={words.score}
        classes="sticky inset-bs-[var(--ds-header-h,var(--ds-bar-h,0px))] z-subbar print:static"
      >
        <CardBody>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
            {/* the space between the figure and "of" is text, so the count
                reads "9 of 28 checked" and not "9of 28" */}
            <p role="status" aria-live="polite" className="text-base">
              <b className="font-display text-3xl font-bold tabular-nums">
                {done}
              </b>{" "}
              <span className="text-gray-11">{words.count(total)}</span>
            </p>
            {flag_total > 0 && (
              <Badge variant={tone} data-part="tally">
                {tier === "empty"
                  ? words.to_check(flag_total)
                  : tier === "gaps"
                    ? words.unchecked(missing)
                    : words.clear}
              </Badge>
            )}
          </div>
          <div
            aria-hidden="true"
            data-part="bar"
            data-state={state === "part" ? undefined : state}
            className="mbs-3 block-2 rounded-full bg-panel inset-shadow-track forced-colors:outline forced-colors:outline-[CanvasText]"
          >
            <div
              className={`block-full rounded-full motion-safe:transition-[width] motion-safe:duration-slow motion-safe:ease-linear forced-colors:forced-color-adjust-none forced-colors:bg-[CanvasText] ${fill_class[state]}`}
              style={{ width: bar_width(done, total) }}
            />
          </div>
        </CardBody>
        {/* its text is the tier's alone, so a tick within a tier says nothing */}
        <div
          role="status"
          aria-live="polite"
          data-tone={tone}
          className={`flex items-start gap-3 border-bs border-(--tone-edge) bg-(--tone-fill) px-4 py-4 sm:px-6 ${vars}`}
        >
          {/* one headline line tall, so the glyph centers on its first line */}
          <span className="flex block-6 shrink-0 items-center-safe text-(--tone-ink)">
            <Icon size={20} aria-hidden="true" />
          </span>
          <div>
            <p className="font-display text-base font-bold">
              {words.verdict[tier].headline}
            </p>
            <p className="text-sm">{words.verdict[tier].sub}</p>
          </div>
        </div>
      </Card>

      {confirming ? (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset groups form fields, not a question and its two answers
        <div
          role="group"
          aria-label={words.confirm_label}
          className="flex flex-wrap items-center-safe gap-3 print:hidden"
        >
          <p className="text-sm font-semibold">{words.confirm(done)}</p>
          <Button variant="destructive-outline" onClick={on_reset}>
            {words.clear_all}
          </Button>
          <Button variant="secondary" ref={keep_ref} onClick={on_keep}>
            {words.keep}
          </Button>
        </div>
      ) : (
        <div
          data-part="controls"
          className="flex flex-wrap gap-3 max-sm:flex-col max-sm:gap-2 print:hidden"
        >
          <Button variant="secondary" onClick={on_print}>
            <Printer aria-hidden="true" />
            {words.print}
          </Button>
          <Button
            variant="ghost"
            ref={reset_ref}
            aria-disabled={done === 0 ? true : undefined}
            onClick={on_ask_reset}
          >
            <RotateCcw aria-hidden="true" />
            {words.reset}
          </Button>
        </div>
      )}

      {sections.map((section) => {
        const title_id = `${uid}-${section.id}`;
        return (
          <Card key={section.id} aria-labelledby={title_id}>
            <CardHeader classes="text-lg">
              <h2 id={title_id}>{section.title}</h2>
              {section.sub && (
                <p className="mbs-1 max-inline-160 text-sm text-gray-11">
                  {section.sub}
                </p>
              )}
            </CardHeader>
            <ul className="px-4 py-1 sm:px-6">
              {section.items.map((item) => {
                const box_id = `${uid}-${item.id}`;
                return (
                  <li
                    key={item.id}
                    className="grid grid-cols-[auto_1fr] gap-3 border-bs border-hairline py-2.5 break-inside-avoid first:border-bs-0"
                  >
                    <input
                      type="checkbox"
                      id={box_id}
                      className="checkbox mbs-0.5"
                      checked={checked.has(item.id)}
                      onChange={() => on_toggle(item.id)}
                    />
                    {/* the badge first, so it heads the first line when the
                        text wraps and is heard before the question */}
                    <label htmlFor={box_id} className="cursor-pointer text-sm">
                      {item.flag && (
                        <Badge variant="warning" classes="me-2">
                          {words.flag}
                        </Badge>
                      )}
                      {item.text}
                      {item.note && (
                        <span className="block mbs-1 text-xs text-gray-11">
                          {item.note}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

type Props = {
  sections: readonly ChecklistSection[];
  /** the localStorage key the ticks persist under. change it, rather than
   *  renaming ids, when the list changes shape. */
  storage_key: string;
  words?: WordsOverride;
  /** appended last, on the root. */
  classes?: string;
};

/** a checklist whose ticks persist in localStorage: it renders empty, as the
 *  server does, and restores in an effect after the first paint. a storage
 *  that throws leaves it working for the session. */
export function Checklist({ sections, storage_key, words, classes }: Props) {
  const [checked, set_checked] = useState<ReadonlySet<string>>(() => new Set());
  const [confirming, set_confirming] = useState(false);
  // a string, so a parent that rebuilds the same list each render does not
  // restore again
  const id_list = sections.flatMap((s) => s.items.map((i) => i.id)).join("\n");
  const ids = useMemo(() => new Set(id_list.split("\n")), [id_list]);

  useEffect(() => {
    let raw: string | null;
    try {
      raw = localStorage.getItem(storage_key);
    } catch {
      return;
    }
    // a new key is another list: nothing of the last one carries over
    set_checked(restored(raw, ids) ?? new Set());
    set_confirming(false);
  }, [storage_key, ids]);

  const commit = (next: ReadonlySet<string>) => {
    set_checked(next);
    try {
      localStorage.setItem(storage_key, JSON.stringify([...next]));
    } catch {
      // private mode or a full quota: the ticks hold for the session
    }
  };

  return (
    <ChecklistView
      sections={sections}
      checked={checked}
      confirming={confirming}
      words={words}
      classes={classes}
      on_toggle={(id) => {
        const next = new Set(checked);
        if (!next.delete(id)) next.add(id);
        commit(next);
      }}
      on_print={() => window.print()}
      on_ask_reset={() => set_confirming(true)}
      on_reset={() => {
        commit(new Set());
        set_confirming(false);
      }}
      on_keep={() => set_confirming(false)}
    />
  );
}
