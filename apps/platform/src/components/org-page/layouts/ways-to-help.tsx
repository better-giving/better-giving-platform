import { useId } from "react";
import type { IGiveItem, TOrgItem } from "../items";
import { ItemsByCount } from "../items-by-count";
import { SECTION_HEADING } from "../section-heading";
import type { IOrgLayout } from "./types";

/** what shows for a list that failed to load, in place of it or under the
 * part of it that did */
export const FAILED_LINE: Record<keyof IOrgLayout["failed"], string> = {
  give: "We couldn't load this nonprofit's campaigns right now. Please try again later.",
  programs:
    "We couldn't load this nonprofit's programs right now. Please try again later.",
  videos:
    "We couldn't load this nonprofit's videos right now. Please try again later.",
};

/** the give list's name by what it holds; an empty one, as a list that failed
 * before loading anything is, keeps the name its failure line uses */
export function give_label(give: IGiveItem[]): string {
  const only_supporter =
    give.length > 0 && give.every((x) => x.kind === "supporter");
  return only_supporter ? "Supporter campaigns" : "Campaigns";
}

interface IFailedLine {
  kind: keyof IOrgLayout["failed"];
}

/** a list's failure line, under whatever of it did load */
export function FailedLine({ kind }: IFailedLine) {
  return <p className="text-sm text-gray-11">{FAILED_LINE[kind]}</p>;
}

const KINDS = ["give", "programs", "videos"] as const;

type TLists = Pick<IOrgLayout, "give" | "programs" | "videos" | "failed">;

/** whether the section renders: something to show, or a list that failed */
export function has_ways_to_help({ failed, ...lists }: TLists): boolean {
  return KINDS.some((k) => failed[k] || lists[k].length > 0);
}

interface IWaysToHelp extends TLists, Pick<IOrgLayout, "now"> {
  /** see `ItemsByCount` */
  rows?: boolean;
  classes?: string;
}

/** every way to give past the hero, laid out by count, with a failed list's
 * line under the rest. nothing to show and nothing failed leaves the section
 * out, and the hero carries the page */
export function WaysToHelp({
  classes = "",
  failed,
  now,
  rows,
  ...lists
}: IWaysToHelp) {
  const heading_id = useId();
  if (!has_ways_to_help({ failed, ...lists })) return null;
  const items = KINDS.flatMap<TOrgItem>((k) => lists[k]);
  const failures = KINDS.filter((k) => failed[k]);

  return (
    <section
      aria-labelledby={heading_id}
      className={`flex flex-col gap-3 md:gap-4 ${classes}`}
    >
      <h2 id={heading_id} className={SECTION_HEADING}>
        Ways to help
      </h2>
      <ItemsByCount items={items} now={now} rows={rows} />
      {failures.map((k) => (
        <FailedLine key={k} kind={k} />
      ))}
    </section>
  );
}
