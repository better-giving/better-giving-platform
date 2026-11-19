import { Accordion } from "@better-giving/ui";
import { useSyncExternalStore } from "react";
import type { ICompareFaq } from "#/content/compare/types";

interface IFaqList {
  items: ICompareFaq[];
  classes?: string;
}

// the first answer is open from md up; a phone starts with every row closed
const DESKTOP = "(min-width: 48rem)";
const subscribe = (on_change: () => void) => {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", on_change);
  return () => mq.removeEventListener("change", on_change);
};
const is_desktop = () => window.matchMedia(DESKTOP).matches;

export function FaqList({ items, classes = "" }: IFaqList) {
  // the server and the first client render both say "closed"; the open row
  // arrives once the viewport is known, so hydration never disagrees
  const desktop = useSyncExternalStore(subscribe, is_desktop, () => false);
  return (
    <Accordion
      // default_value only seeds the first render, so a viewport change
      // remounts the list
      key={desktop ? "desktop" : "phone"}
      variant="divided"
      heading_level={3}
      default_value={desktop ? ["q0"] : []}
      className={classes}
      items={items.map((f, i) => ({
        value: `q${i}`,
        trigger: f.q,
        content: <p className="text-gray-11 leading-relaxed">{f.a}</p>,
      }))}
    />
  );
}
