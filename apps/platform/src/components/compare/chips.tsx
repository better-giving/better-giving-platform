import { useEffect, useRef } from "react";
import { href, Link } from "react-router";
import type { ICompareChip } from "#/content/compare/types";

interface IChips {
  chips: ICompareChip[];
  current: string;
}

const chip_cls =
  "inline-flex min-h-9 items-center whitespace-nowrap rounded-full bg-gray-3 px-4 text-sm font-medium text-gray-12 hover:bg-gray-4 aria-[current=page]:bg-secondary-active aria-[current=page]:font-bold focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2";

/** "All comparisons": one chip per page, the open page marked. below sm the
 * row scrolls sideways with the marked chip centred; from sm it wraps. */
export function Chips({ chips, current }: IChips) {
  const row = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = row.current;
    // keyed on `current`: a chip link keeps this route mounted, so each page
    // it lands on recentres the row
    const mark = el?.children[chips.findIndex((c) => c.slug === current)];
    if (!el || !(mark instanceof HTMLElement)) return;
    // moves the row alone: scrollIntoView would move the page too
    el.scrollLeft = mark.offsetLeft - (el.clientWidth - mark.clientWidth) / 2;
  }, [chips, current]);

  return (
    <nav aria-labelledby="all-comparisons" className="page pt-10">
      <h2 id="all-comparisons" className="mb-3 text-sm font-bold">
        All comparisons
      </h2>
      <ul
        ref={row}
        className="relative flex gap-2 overflow-x-auto scrollbar-none scroll-fade-x snap-x snap-proximity max-sm:-mx-5 max-sm:px-5 sm:flex-wrap sm:overflow-visible"
      >
        {chips.map((c) => {
          const is_current = c.slug === current;
          return (
            <li key={c.slug} className="snap-center">
              <Link
                to={href("/compare/:slug", { slug: c.slug })}
                aria-current={is_current ? "page" : undefined}
                className={chip_cls}
              >
                {c.competitor}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
