import { Modal } from "@better-giving/ui";
import type { ReactNode } from "react";
import { Sidebar } from "../sidebar";
import type { LinkGroup } from "../types";

interface Props {
  linkGroups: LinkGroup[];
  rootRoute: string;
  open: boolean;
  set_open: React.Dispatch<React.SetStateAction<boolean>>;
  header?: ReactNode;
}

export function ToggleableSidebar({
  linkGroups,
  rootRoute,
  set_open,
  open,
  header,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={() => set_open(false)}
      size="none"
      title="Dashboard menu"
      classes="fixed top-0 left-0 h-full bg-popover"
    >
      <Sidebar
        classes="overflow-y-auto scrollbars"
        linkGroups={linkGroups}
        rootRoute={rootRoute}
        onChange={() => set_open(false)}
        sidebarHeader={header && <div className="px-3 pt-4">{header}</div>}
      />
    </Modal>
  );
}
