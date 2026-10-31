import { HoverCard as Ark } from "@ark-ui/react/hover-card";
import { Portal } from "@ark-ui/react/portal";
import type { ComponentProps, ReactNode } from "react";
import { popup_anim, popup_shell } from "./popup";

// no-op: arrow rendered by `HoverCard` as a sibling of `Content` inside
// `Positioner` (see tooltip.tsx for the same pattern).
export function Arrow() {
  return null;
}

export function Content({
  className = "",
  ...props
}: ComponentProps<typeof Ark.Content>) {
  return (
    <Ark.Content
      className={`${popup_anim} ${popup_shell} ${className}`}
      {...props}
    />
  );
}

interface Props {
  /** must be wrapped by Content */
  tip: ReactNode;
  children: React.JSX.Element;
}
export function HoverCard(props: Props) {
  return (
    <Ark.Root
      openDelay={100}
      closeDelay={200}
      lazyMount
      unmountOnExit
      positioning={{ gutter: 4, overflowPadding: 16 }}
    >
      <Ark.Trigger asChild>{props.children}</Ark.Trigger>
      <Portal>
        <Ark.Positioner className="[--arrow-size:10px] [--arrow-background:var(--card)]">
          <Ark.Arrow>
            <Ark.ArrowTip />
          </Ark.Arrow>
          {props.tip}
        </Ark.Positioner>
      </Portal>
    </Ark.Root>
  );
}
