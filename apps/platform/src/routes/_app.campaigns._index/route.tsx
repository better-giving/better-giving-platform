import { Search } from "lucide-react";
import type { ChangeEventHandler } from "react";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { use_debounce } from "#/hooks/use-debounce";
import { use_table } from "#/hooks/use-table";

import type { Route } from "./+types/route";
import { Cards } from "./cards";
import Hero from "./hero";
import hero from "./hero.webp?url";

export { headers, loader } from "./funds-api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/campaigns")}`,
    image: hero,
    title: "Campaigns",
    description:
      "Campaigns that support one or several nonprofits. Every donation goes where you want it to.",
  });

export { ErrorBoundary } from "#/components/error";
export default CacheRoute(Funds);
function Funds({ loaderData: page1 }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const { node, load } = use_table({
    id: "funds",
    // see the marketplace route: the filters are the identity, not page 1's shape
    filter_key: params.toString(),
    page1,
    table: (x) => <Cards {...x} />,
    classes: "mt-4",
    gen_loader: (l, next) => () => {
      const p = new URLSearchParams(params);
      if (next) p.set("page", next.toString());
      l(`?index&${p.toString()}`);
    },
  });

  const onChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const n = new URLSearchParams(params);
    n.set("query", e.target.value);
    load(`?index&${n.toString()}`);
  };

  const debounced_change = use_debounce(onChange, 500);

  return (
    <div>
      <div className="py-6 surface-primary">
        <Hero classes="grid isolate page" />
      </div>
      <div className="page mt-8 pb-8">
        <div className="grid grid-cols-[1fr_auto] gap-x-2">
          <div className="relative">
            <Search className="ml-2 absolute top-1/2 -translate-y-1/2 left-2 icon-xl" />
            <input
              type="search"
              name="query"
              onChange={debounced_change}
              className="field-input rounded h-full pl-12"
              placeholder="Search campaigns"
            />
          </div>
        </div>

        {node}
      </div>
    </div>
  );
}
