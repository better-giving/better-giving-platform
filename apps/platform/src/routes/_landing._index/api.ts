import { redirect } from "react-router";
import type { Route } from "./+types/route";

// tracking params fragment the cdn cache key (each utm/gclid/etc → unique
// entry). strip them via 308 to a canonical `/` so all landings share one
// cached response. analytics will lose url-based attribution on the
// destination page — referer header still flows.
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "gclid",
  "gbraid",
  "wbraid",
  "gad_source",
  "gad_campaignid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
];

// headers() only fires on the successful loader path, so the 308 itself
// needs its own cache-control to be cdn-cacheable.
// keep s-maxage short so cached html can't outlive a typical deploy gap —
// stale content-hashed asset refs would 404 against the new deployment and
// hit the function each time. swr widens the freshness window cheaply.
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=86400";

export const loader = ({ url }: Route.LoaderArgs) => {
  const to = new URL(url);
  let stripped = false;
  for (const p of TRACKING_PARAMS) {
    if (to.searchParams.has(p)) {
      to.searchParams.delete(p);
      stripped = true;
    }
  }
  if (stripped)
    throw redirect(to.pathname + to.search, {
      status: 308,
      headers: { "cache-control": CACHE_CONTROL },
    });
  return null;
};

// homepage is otherwise fully static. pin a cdn-friendly cache-control so the
// document can be served from edge cache. RR merges parent Set-Cookie
// automatically; returning a plain object avoids duplicating those headers.
export const headers: Route.HeadersFunction = () => ({
  "cache-control": CACHE_CONTROL,
});
