import { useId, useRef, useState } from "react";
import { GiveCard } from "./give-card";
import { type IGiveItem, names_kind } from "./items";
import { REVEAL_IN, reveal_delay } from "./reveal";
import { SECTION_HEADING } from "./section-heading";

export interface ISwipeRow {
  /** the section's heading, which also names the scrolling row */
  heading: string;
  /** 4 or more: fewer is `ItemsByCount`'s */
  items: IGiveItem[];
  /** epoch ms, see `GiveCard` */
  now: number;
}

/** 4+ campaigns and supporter campaigns as one row that scrolls sideways. each card
 * is a share of the row's width, so the last one in view is always cut off,
 * which is what says there is more. "See all N" opens the row in place into a
 * wrapping grid */
export function SwipeRow({ heading, items, now }: ISwipeRow) {
  const id = useId();
  const heading_id = `${id}-heading`;
  const list_id = `${id}-list`;
  const [expanded, set_expanded] = useState(false);
  // the cards wholly in the row's view when "See all" was pressed: they are
  // already on screen, so only the others rise in
  const [in_view, set_in_view] = useState<ReadonlySet<number>>(new Set());
  const row = useRef<HTMLElement>(null);
  const show_kind = names_kind(items);

  function toggle() {
    if (!expanded && row.current) set_in_view(wholly_in_view(row.current));
    set_expanded(!expanded);
  }
  let rising = 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 id={heading_id} className={`grow ${SECTION_HEADING}`}>
          {heading}
        </h2>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={list_id}
          onClick={toggle}
          className="link min-h-11 shrink-0 font-semibold"
        >
          {expanded ? "Show fewer" : `See all ${items.length}`}
        </button>
      </div>
      {expanded ? (
        <ul
          id={list_id}
          data-count={items.length}
          className="grid gap-4 md:grid-cols-3"
        >
          {items.map((x, i) => {
            const rises = !in_view.has(i);
            return (
              <li
                key={x.id}
                className={rises ? REVEAL_IN : undefined}
                // staggered among the cards that rise, not by position
                style={rises ? reveal_delay(rising++) : undefined}
              >
                <GiveCard
                  item={x}
                  orientation="vertical"
                  now={now}
                  show_kind={show_kind}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <section
          ref={row}
          id={list_id}
          aria-labelledby={heading_id}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 — a scroll container is otherwise reachable only by pointer
          tabIndex={0}
          className="scrollbars snap-x snap-mandatory overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        >
          <ul className="grid auto-cols-[75%] grid-flow-col gap-4 md:auto-cols-[30%]">
            {items.map((x) => (
              <li key={x.id} className="snap-start">
                <GiveCard
                  item={x}
                  orientation="vertical"
                  now={now}
                  show_kind={show_kind}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** the indexes of the row's cards that sit wholly inside its scrolled view */
function wholly_in_view(row: HTMLElement): Set<number> {
  const view = row.getBoundingClientRect();
  const cards = row.querySelectorAll(":scope > ul > li");
  const out = new Set<number>();
  cards.forEach((li, i) => {
    const r = li.getBoundingClientRect();
    // a pixel's slack for subpixel edges, so a card flush with the row counts
    if (r.left >= view.left - 1 && r.right <= view.right + 1) out.add(i);
  });
  return out;
}
