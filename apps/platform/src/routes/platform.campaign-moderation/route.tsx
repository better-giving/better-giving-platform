import { useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import type { Route } from "./+types/route";
import { Table } from "./table";

export { ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";
export const clientLaoder = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta = () => metas({ title: "Campaign moderation" });

export default CacheRoute(Page);
function Page({ loaderData: page1 }: Route.ComponentProps) {
  const [params] = useSearchParams();

  const { node } = use_table({
    table: (x) => <Table {...x} />,
    page1,
    gen_loader: (load, next) => () => {
      const copy = new URLSearchParams(params);
      if (next) copy.set("next", next);
      load(`?${copy.toString()}`);
    },
  });

  return (
    <div className="grid content-start gap-y-4 gap-x-3 px-6 py-4 md:px-10 md:py-8 w-full">
      <h3 className="font-bold text-2xl">Campaigns</h3>
      <div className="grid col-span-full table-scroll">{node}</div>
    </div>
  );
}
