import { href } from "react-router";

/** the list as the reviewer left it: `search` is the list's own query string */
export const list_url = (search: string) =>
  `${href("/platform/applications")}${search}`;
