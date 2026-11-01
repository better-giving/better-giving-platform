import { EmptyState } from "@better-giving/ui";
import { href, Outlet, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { safeParse } from "valibot";
import { get_npos } from "#/.server/npos";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import { resp, search } from "@/helpers/https";
import { npos_search } from "@/npo/schema";
import type { Route } from "./+types/route";
import { ActiveFilters } from "./active-filters";
import { Cards } from "./cards";
import { Hero } from "./hero";
import hero from "./hero.webp?url";
import { Toolbar } from "./toolbar";
import { use_search_pending } from "./toolbar/search";

export const loader = async ({ url }: Route.LoaderArgs) => {
  const p_s = safeParse(npos_search, search(url));
  if (p_s.issues) throw resp.status(400, p_s.issues[0].message);
  const { published, ...p } = p_s.output;
  const page = await get_npos({ ...p, published: [true] });
  return page;
};

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/marketplace")}`,
    title: "Marketplace",
    description:
      "Find and support charities, nonprofits, universities, and faith-based organizations—all in one place.",
    image: hero,
  });

export { ErrorBoundary } from "#/components/error";
export default CacheRoute(Page);
function Page({ loaderData: page1 }: Route.ComponentProps) {
  const [params] = useSearchParams();
  // the box's search is a navigation, not this table's fetcher
  const searching = use_search_pending();
  const { node } = use_table({
    id: "marketplace",
    // the url's filters, not the shape of page 1: two different filters can
    // return the same first card and the same count, and the shape heuristic
    // reads that as no change — which would let a load-more still in flight
    // append the old filter's page to the grid the new filter just drew.
    filter_key: params.toString(),
    page1,
    table: (props) =>
      props.items.length === 0 ? (
        <EmptyState classes={props.classes}>No organisations found</EmptyState>
      ) : (
        <Cards {...props} loading={props.loading || searching} />
      ),
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(params);
      if (next) p.set("page", next.toString());
      load(`?${p.toString()}`);
    },
  });
  return (
    <div className="w-full grid content-start pb-16">
      <Hero classes="grid isolate mt-8 page" />
      <div className="grid gap-y-4 content-start page min-h-screen">
        <Toolbar classes="mt-10" />
        <ActiveFilters />
        {node}
      </div>
      <Outlet />
    </div>
  );
}
