import type { ReactNode } from "react";
import { Link, useLocation, useNavigation } from "react-router";
import { find_active_link } from "./active-link";
import type { LinkGroup } from "./types";

type Props = {
  classes?: string;
  linkGroups: LinkGroup[];
  /** the pattern each link's relative `to` (and `nests`) hangs off, e.g.
   *  `/admin/:id/` */
  rootRoute: string;
  sidebarHeader?: ReactNode;
  onChange?: () => void;
};

export function Sidebar({
  classes = "",
  linkGroups,
  rootRoute,
  onChange,
  sidebarHeader,
}: Props) {
  const path = useLocation().pathname;
  const next_path = useNavigation().location?.pathname;
  // the owning link, not just a `to` prefix: a `nests` page (program-editor)
  // marks the link that declares it. it is inert only on its own page — from
  // a page nested under it, it is the way back
  const active = find_active_link(linkGroups, rootRoute, path, {
    honour_end: true,
  });
  const pending =
    next_path &&
    find_active_link(linkGroups, rootRoute, next_path, { honour_end: true });
  return (
    <div className={`flex flex-col w-72 md:w-64 h-full ${classes}`}>
      {sidebarHeader}
      {/* rows within a group sit close; groups sit apart, so the eye reads
          the groups before the rows */}
      <nav aria-label="Dashboard" className="grid gap-6 px-3 py-4">
        {linkGroups.map((group) => (
          <div key={`link_group-${group.title}`} className="grid gap-0.5">
            {group.title && (
              <h6 className="px-3 pb-1 font-bold text-xs uppercase text-gray-11 tracking-wide">
                {group.title}
              </h6>
            )}
            {group.links.map((link) => {
              const is_active = active?.link === link;
              const is_own = is_active && active.own;
              const is_pending = !!pending && pending.link === link;
              return (
                <Link
                  key={`nav_link-${link.to}`}
                  to={link.to}
                  className={`flex items-center gap-3 py-2 px-3 rounded font-medium text-sm hover:bg-gray-4 transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 aria-disabled:text-gray-11 aria-disabled:pointer-events-none
                ${is_active ? "bg-secondary-active text-gray-12" : ""} ${is_own || is_pending ? "pointer-events-none" : ""} ${is_pending ? "text-gray-11" : ""}`}
                  aria-current={
                    is_own ? "page" : is_active ? "true" : undefined
                  }
                  onClick={onChange}
                  aria-disabled={link.disabled}
                >
                  <link.icon.fn className="shrink-0 icon-md" />
                  {/* a long label stays on one line and fades out at the row's
                    trailing edge instead of ending in an ellipsis */}
                  <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap mask-r-from-75%">
                    {link.title}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
