import { Modal } from "@better-giving/ui";
import type { ReactNode } from "react";
import { Sidebar } from "../sidebar";
import type { LinkGroup } from "../types";

interface Props {
  linkGroups: LinkGroup[];
  open: boolean;
  set_open: React.Dispatch<React.SetStateAction<boolean>>;
  header?: ReactNode;
}

export function ToggleableSidebar({
  linkGroups,
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
      classes="fixed top-0 left-0 h-full bg-card"
    >
      <Sidebar
        classes="overflow-y-auto scrollbars"
        linkGroups={linkGroups}
        onChange={() => set_open(false)}
        sidebarHeader={header && <div className="px-6 pt-6">{header}</div>}
      />
    </Modal>
  );
}
