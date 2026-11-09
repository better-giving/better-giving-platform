import { Tabs as ArkTabs } from "@ark-ui/react/tabs";
import type { ComponentProps, ReactNode } from "react";

/** full literal class strings, never composed: tailwind v4 is a jit over
 *  source text. ark marks the active trigger with `data-selected`. */
const list_class = "flex gap-1 border-b border-hairline";
const tab_class = [
  "-mb-px inline-flex min-h-9 items-center border-b-2 border-transparent px-4 py-2",
  "rounded-t text-sm font-semibold text-gray-11 hover:text-gray-12",
  "data-[selected]:border-primary data-[selected]:text-accent-11",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");
const panel_class = "pt-4 focus-visible:outline-2 focus-visible:outline-ring";

type RootProps = Omit<ComponentProps<typeof ArkTabs.Root>, "className"> & {
  /** appended last. */
  classes?: string;
};

/** the tab set. uncontrolled with `defaultValue`, controlled with `value` and
 *  `onValueChange`. arrow keys move between tabs, Home and End jump. */
export function Tabs({ classes = "", ...props }: RootProps) {
  return <ArkTabs.Root className={classes} {...props} />;
}

type ListProps = Omit<ComponentProps<typeof ArkTabs.List>, "className"> & {
  classes?: string;
};

/** the row of tabs. name it with `aria-label` or `aria-labelledby`. */
export function TabList({ classes = "", ...props }: ListProps) {
  return <ArkTabs.List className={`${list_class} ${classes}`} {...props} />;
}

type TabProps = Omit<ComponentProps<typeof ArkTabs.Trigger>, "className"> & {
  value: string;
  classes?: string;
  children?: ReactNode;
};

export function Tab({ classes = "", ...props }: TabProps) {
  return <ArkTabs.Trigger className={`${tab_class} ${classes}`} {...props} />;
}

type PanelProps = Omit<ComponentProps<typeof ArkTabs.Content>, "className"> & {
  /** the `value` of the tab that shows this panel. */
  value: string;
  classes?: string;
};

export function TabPanel({ classes = "", ...props }: PanelProps) {
  return <ArkTabs.Content className={`${panel_class} ${classes}`} {...props} />;
}
