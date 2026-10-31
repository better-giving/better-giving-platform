import { Modal } from "@better-giving/ui";
import { Sidebar } from "../sidebar";
import type { LinkGroup } from "../types";

interface Props {
  linkGroups: LinkGroup[];
  open: boolean;
  set_open: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ToggleableSidebar({ linkGroups, set_open, open }: Props) {
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
      />
    </Modal>
  );
}
