import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { LinkGroup } from "../types";
import { ToggleableSidebar } from "./toggleable-sidebar";
import { use_sidebar_opener } from "./use-sidebar-opener";

type Props = {
  classes?: string;
  linkGroups: LinkGroup[];
  rootRoute: string;
  header?: ReactNode;
};

export function SidebarOpener({
  classes = "",
  linkGroups,
  rootRoute,
  header,
}: Props) {
  const { open, active_link, set_open } = use_sidebar_opener(
    linkGroups,
    rootRoute
  );
  const Ico = active_link.icon.fn;

  return (
    <>
      <button
        type="button"
        onClick={() => set_open(true)}
        className={`flex items-center gap-2 py-5 px-6 font-bold text-sm text-primary ${classes}`}
      >
        <Ico className="icon-md" />
        {active_link.title}
        <ChevronRight className="ml-auto icon-xl" />
      </button>
      <ToggleableSidebar
        open={open}
        linkGroups={linkGroups}
        set_open={set_open}
        header={header}
      />
    </>
  );
}
