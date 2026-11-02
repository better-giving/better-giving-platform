import { Menu } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router";
import {
  SCREEN_BREAKPOINTS,
  use_handle_screen_resize,
} from "#/hooks/use-handle-screen-resize";
import { find_active_link } from "../active-link";
import type { Link, LinkGroup } from "../types";

const DEFAULT_LINK: Link = {
  title: "Open menu",
  icon: { fn: Menu },
  to: "",
};

export function use_sidebar_opener(
  link_groups: LinkGroup[],
  rootRoute: string
) {
  const [open, set_open] = useState(false);
  const curr_path = useLocation().pathname;

  // the nearest ancestor link, `end` or not: the opener names where you are
  const active_link =
    find_active_link(link_groups, rootRoute, curr_path)?.link ?? DEFAULT_LINK;

  use_handle_screen_resize(
    (screen_size) => screen_size >= SCREEN_BREAKPOINTS.md && set_open(false),
    {
      debounce_time: 50,
      should_attach_listener: open,
    }
  );

  return { open, active_link, set_open };
}
