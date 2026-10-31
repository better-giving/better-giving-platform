import React, { type ReactNode } from "react";
import { NavLink } from "react-router";
import type { LinkGroup } from "./types";

type Props = {
  classes?: string;
  linkGroups: LinkGroup[];
  sidebarHeader?: ReactNode;
  onChange?: () => void;
};

export function Sidebar({
  classes = "",
  linkGroups,
  onChange,
  sidebarHeader,
}: Props) {
  return (
    <div className={`flex flex-col w-72 md:w-64 h-full ${classes}`}>
      {sidebarHeader}
      <nav aria-label="Dashboard" className="grid px-3 py-4">
        {linkGroups.map((group) => (
          <React.Fragment key={`link_group-${group.title}`}>
            {group.title && (
              <h6 className="pt-5 px-3 pb-1 font-bold text-xs uppercase text-gray-11 tracking-wide">
                {group.title}
              </h6>
            )}
            {group.links.map((link) => (
              <NavLink
                end={link.end}
                key={`nav_link-${link.to}`}
                to={link.to}
                className={({ isActive, isPending }) =>
                  `flex items-center gap-3 py-3 px-3 rounded font-medium text-sm hover:bg-gray-3 transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 aria-disabled:text-gray-11 aria-disabled:pointer-events-none
                ${isActive ? "pointer-events-none text-primary" : ""} ${isPending ? "pointer-events-none text-gray-11" : ""}`
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
              </NavLink>
            ))}
          </React.Fragment>
        ))}
      </nav>
    </div>
  );
}
