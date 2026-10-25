import { Image } from "@better-giving/ui";
import { to_usd } from "@better-giving/ui/helpers";
import { Clock } from "lucide-react";
import { Link } from "react-router";
import { GoalBar } from "./goal-bar";
import { ends_label, type IGiveItem } from "./items";

export interface IGiveCard {
  item: IGiveItem;
  /** a lone item across the whole row: a larger title and its excerpt */
  feature?: boolean;
  /** epoch ms the end date counts down from: the loader's clock, so the
   * server render and hydration agree */
  now: number;
  /** show the kind line, see `names_kind` */
  show_kind: boolean;
}

const KIND: Record<IGiveItem["kind"], string> = {
  campaign: "Campaign",
  supporter: "Supporter campaign",
};

/** a card that is wholly a link: hover firms the edge, press nudges it like
 * `.btn-primary`. children react through the `card` group */
export const CARD_LINK =
  "group/card transition-colors hover:border-gray-7 active:translate-y-px";

/** a campaign or supporter campaign, its 4:1 image across the top at every
 * count and width. the title is the card's one link, stretched over
 * it, so the link's name stays the title. a goal's bar and figures sit on the
 * card's bottom edge, so neighbours in a row align with or without an end
 * date; without a goal the raised line follows the text, so no band is left
 * where a bar would be */
export function GiveCard({ item, feature = false, now, show_kind }: IGiveCard) {
  const ends = ends_label(item.ends_at, now);
  return (
    <article
      className={`${CARD_LINK} relative grid h-full grid-rows-[auto_1fr] overflow-hidden rounded border bg-panel text-gray-12 has-[h3_a:focus-visible]:outline-2 has-[h3_a:focus-visible]:outline-ring has-[h3_a:focus-visible]:-outline-offset-2`}
    >
      <ImageFrame src={item.image} />
      <div className="flex min-w-0 flex-col gap-2 p-4">
        {show_kind && <p className="eyebrow text-primary">{KIND[item.kind]}</p>}
        <h3 className={`font-bold ${feature ? "md:text-xl" : ""}`}>
          <Link
            to={item.to}
            className="outline-0 after:absolute after:inset-0 after:content-['']"
          >
            {item.title}
          </Link>
        </h3>
        {item.byline && (
          <p className="truncate text-sm text-gray-11">{item.byline}</p>
        )}
        {feature && item.excerpt && (
          <p className="line-clamp-2 text-sm text-gray-11">{item.excerpt}</p>
        )}
        {ends && (
          <p className="flex items-start gap-1.5 text-sm text-gray-11">
            <span className="flex h-lh items-center">
              <Clock aria-hidden className="icon-sm" />
            </span>
            {ends}
          </p>
        )}
        <Progress title={item.title} raised={item.raised} goal={item.goal} />
      </div>
    </article>
  );
}

interface IImageFrame {
  src: string | null;
}

/** the 4:1 slot, the image as uploaded filling it exactly, so nothing is
 * re-cropped; with no image the fill is the frame. its width is the caller's:
 * a grid cell stretches it to the column. zooms on a `CARD_LINK` hover */
export function ImageFrame({ src }: IImageFrame) {
  return (
    <div className="aspect-4/1 overflow-hidden bg-gray-3">
      {src && (
        <Image
          src={src}
          alt=""
          className="size-full object-cover transition-[scale] duration-slow motion-safe:group-hover/card:scale-103"
        />
      )}
    </div>
  );
}

interface IProgress {
  title: string;
  raised: number;
  goal: number | null;
}

/** the bar and "$raised of $goal" with a goal, pushed to the bottom of a
 * card's flex column so neighbours in a row align; "$raised raised" without
 * one, following the text */
export function Progress({ title, raised, goal }: IProgress) {
  if (goal == null) {
    return (
      <p className="figures text-sm text-gray-11">{to_usd(raised)} raised</p>
    );
  }
  return (
    <div className="mt-auto flex flex-col gap-2 pt-1">
      <GoalBar raised={raised} goal={goal} label={`${title}: amount raised`} />
      <p className="figures text-sm text-gray-11">
        {to_usd(raised)} of {to_usd(goal)}
      </p>
    </div>
  );
}
