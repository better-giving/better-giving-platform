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
      <div className="grid grid-cols-[auto_1fr] py-3 gap-x-2">
        {linkGroups.map((group) => (
          <React.Fragment key={`link_group-${group.title}`}>
            {group.title && (
              <h6 className="col-span-2 pt-5 px-5 pb-1 font-bold text-xs uppercase text-gray-11 tracking-wide">
                {group.title}
              </h6>
            )}
            {group.links.map((link) => (
              <NavLink
                end={link.end}
                key={`nav_link-${link.to}`}
                to={link.to}
                className={({ isActive, isPending }) =>
                  `grid grid-cols-subgrid col-span-2 items-center py-3 px-5 font-bold text-sm hover:text-primary transition duration-slow aria-disabled:text-gray-11 aria-disabled:pointer-events-none
                ${isActive ? "pointer-events-none text-primary" : ""} ${isPending ? "pointer-events-none text-gray-11" : ""}`
                }
                onClick={onChange}
                aria-disabled={link.disabled}
              >
                <link.icon.fn className="justify-self-center icon-md" />
                {link.title}
              </NavLink>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
