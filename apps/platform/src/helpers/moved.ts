import { redirect } from "react-router";

/** a 301 with a bounded lifetime: a browser keeps a bare 301 forever, so a
 * rollback to a deploy that redirects the other way would loop */
export const moved = (
  url: string,
  /** how long a cache may keep it. a redirect a rename can reverse (a slug
   * edited to change only its case) takes a short one */
  cache_control = "public, max-age=3600, s-maxage=86400"
) =>
  redirect(url, {
    status: 301,
    headers: { "cache-control": cache_control },
  });
