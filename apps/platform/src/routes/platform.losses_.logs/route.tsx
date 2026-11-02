import { Breadcrumb } from "@better-giving/ui";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import { LogsTable } from "#/pages/platform-admin/losses/logs-table";
import type { Route } from "./+types/route";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = () => metas({ title: "Losses - Logs" });

export default CacheRoute(Page);
function Page({ loaderData: page1 }: Route.ComponentProps) {
  const [search] = useSearchParams();
  const { node } = use_table({
    table: (x) => <LogsTable {...x} />,
    page1,
    classes: "mt-4",
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(search);
      if (next) p.set("next", next);
      load(`?${p.toString()}`);
    },
  });

  return (
    <div className="px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        classes="mb-4"
        items={[
          { label: "Losses", to: href("/platform/losses") },
          { label: "Logs" },
        ]}
      />
      {node}
    </div>
  );
}
