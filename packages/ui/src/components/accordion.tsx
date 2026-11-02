import { Accordion as Ark } from "@ark-ui/react/accordion";
import type { ReactNode } from "react";
import { DrawerIcon } from "./icon/drawer-icon";

export interface IAccordionItem {
  value: string;
  /** the question, or whatever names the panel */
  trigger: ReactNode;
  content: ReactNode;
}

interface Props {
  items: IAccordionItem[];
  /** `compact` is a tight list inside a card; `divided` is a padded, ruled
   * list for a page section */
  variant?: "compact" | "divided";
  /** outer placement only — width, margin */
  className?: string;
}

const looks = {
  compact: {
    root: "",
    trigger: "flex items-start justify-between gap-2 mb-2 w-full",
    label: "text-left text-sm group-data-[state=open]:font-semibold",
    content: "text-sm grid gap-3 text-gray-11 mb-6",
  },
  divided: {
    root: "divide-y divide-hairline",
    trigger: "flex items-center justify-between gap-2 w-full py-6 px-4",
    label: "text-left group-data-[state=open]:font-semibold",
    content: "pb-4 px-4",
  },
};

export function Accordion({
  items,
  variant = "compact",
  className = "",
}: Props) {
  const look = looks[variant];
  return (
    <Ark.Root collapsible className={`${look.root} ${className}`}>
      {items.map((it) => (
        <Ark.Item key={it.value} value={it.value} className="group">
          <Ark.ItemTrigger className={look.trigger}>
            <span className={look.label}>{it.trigger}</span>
            <DrawerIcon
              is_open={false}
              className="icon-lg shrink-0 group-data-[state=open]:rotate-180"
            />
          </Ark.ItemTrigger>
          <Ark.ItemContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
            <div className={look.content}>{it.content}</div>
          </Ark.ItemContent>
        </Ark.Item>
      ))}
    </Ark.Root>
  );
}
