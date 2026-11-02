import { Tabs as Ark } from "@ark-ui/react/tabs";
import type { ComponentProps, ReactNode } from "react";

export interface ITab<T extends string> {
  value: T;
  /** text, or an icon followed by text */
  label: ReactNode;
}

interface Props<T extends string> {
  items: ITab<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  size?: "sm" | "md";
  /** triggers share the list's full width */
  stretch?: boolean;
  /** outer placement only — width, margin */
  className?: string;
  /** the `TabPanel`s, plus anything that belongs to the tab set as a whole */
  children: ReactNode;
}

const trigger_size = {
  sm: "gap-1 px-3 py-1.5 text-xs",
  md: "gap-2 px-4 py-2 text-sm",
};

// a row wider than its box scrolls sideways rather than squeezing its labels,
// and fades the edge it runs past (`scroll-fade-x`) so a clipped tab reads as
// more to scroll rather than as the end of the row.
// the underline is always 2px, transparent at rest, so selecting a tab never
// shifts the row. a trigger rests transparent and hovers at step 4, radix's
// hovered component fill; the selected one is told by its underline and ink.
const trigger =
  "flex shrink-0 items-center whitespace-nowrap rounded-t border-b-2 border-transparent font-medium text-gray-11 transition-colors hover:bg-gray-4 hover:text-gray-12 data-selected:border-primary data-selected:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2";

export function Tabs<T extends string>({
  items,
  value,
  defaultValue,
  onValueChange,
  size = "md",
  stretch = false,
  className = "",
  children,
}: Props<T>) {
  return (
    <Ark.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange && ((e) => onValueChange(e.value as T))}
      className={className}
    >
      <Ark.List
        className={`scrollbars scroll-fade-x flex overflow-x-auto border-b ${size === "md" ? "gap-2" : ""}`}
      >
        {items.map((it) => (
          <Ark.Trigger
            key={it.value}
            value={it.value}
            className={`${trigger} ${trigger_size[size]} ${
              stretch ? "flex-1 justify-center" : ""
            }`}
            // chromium leaves a partly visible focus target where it is, under
            // the fade; "nearest" honours the list's scroll-padding, which is
            // the fade's width
            onFocus={(e) =>
              e.currentTarget.scrollIntoView({
                block: "nearest",
                inline: "nearest",
              })
            }
          >
            {it.label}
          </Ark.Trigger>
        ))}
      </Ark.List>
      {children}
    </Ark.Root>
  );
}

/** unstyled; spacing from the tab list is the caller's */
export function TabPanel(props: ComponentProps<typeof Ark.Content>) {
  return <Ark.Content {...props} />;
}
