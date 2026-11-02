import { matchPath } from "react-router";
import type { Link, LinkGroup } from "./types";

export interface IActiveLink {
  link: Link;
  /** the path is the link's own page, not one nested under it */
  own: boolean;
}

/** the link a path belongs to: every link whose `to` (or a `nests` path)
 *  prefixes the path by segment, and of those the longest, so `savings/log`
 *  beats `savings` on `savings/log/2026`. with `honour_end`, a link marked
 *  `end` matches its own page only. */
export function find_active_link(
  link_groups: LinkGroup[],
  root_route: string,
  path: string,
  { honour_end = false } = {}
): IActiveLink | undefined {
  let active: IActiveLink | undefined;
  let best = -1;
  for (const link of link_groups.flatMap((g) => g.links)) {
    const own = !!matchPath(`${root_route}${link.to}`, path);
    for (const to of [link.to, ...(link.nests ?? [])]) {
      if (to.length <= best) continue;
      const exact = to === link.to && own;
      if (honour_end && link.end && !exact) continue;
      if (!exact && !matchPath(`${root_route}${to}/*`, path)) continue;
      active = { link, own };
      best = to.length;
    }
  }
  return active;
}
