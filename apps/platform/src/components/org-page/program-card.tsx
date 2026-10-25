import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { CARD_LINK, ImageFrame, Progress } from "./give-card";
import type { IProgramItem } from "./items";

export interface IProgramCard {
  item: IProgramItem;
  /** a lone item across the whole row: a larger title */
  feature?: boolean;
  /** show the kind line, see `names_kind` */
  show_kind: boolean;
}

/** a program, laid out as a campaign's card: the 4:1 image across the top,
 * the text column the card's full width, a goal's bar and figures on the
 * card's bottom edge. the chevron sits over the bottom-right corner, and a
 * goal-less card's title and summary stop short of it. the title is the
 * card's one link, stretched over it */
export function ProgramCard({
  item,
  feature = false,
  show_kind,
}: IProgramCard) {
  // without a goal the title or summary can be the column's last line and run
  // its full width: 24px is the 16px chevron plus 8px of clearance. a goal's
  // figures are short, and its bar spans the column
  const clear_chevron = item.goal == null ? "pr-6" : "";
  return (
    <article
      className={`${CARD_LINK} relative grid h-full grid-rows-[auto_1fr] overflow-hidden rounded border bg-panel text-gray-12 has-[h3_a:focus-visible]:outline-2 has-[h3_a:focus-visible]:outline-ring has-[h3_a:focus-visible]:-outline-offset-2`}
    >
      <ImageFrame src={item.image} />
      <div className="flex min-w-0 flex-col gap-2 p-4">
        {show_kind && <p className="eyebrow text-primary">Program</p>}
        <h3
          className={`font-bold ${clear_chevron} ${feature ? "md:text-xl" : ""}`}
        >
          <Link
            to={item.to}
            className="outline-0 after:absolute after:inset-0 after:content-['']"
          >
            {item.title}
          </Link>
        </h3>
        {item.summary && (
          <p className={`line-clamp-2 text-sm text-gray-11 ${clear_chevron}`}>
            {item.summary}
          </p>
        )}
        {item.goal != null && (
          <Progress title={item.title} raised={item.raised} goal={item.goal} />
        )}
      </div>
      <ChevronRight
        aria-hidden
        className="pointer-events-none absolute right-4 bottom-4 icon-md text-gray-11 transition-[translate] motion-safe:group-hover/card:translate-x-1"
      />
    </article>
  );
}
