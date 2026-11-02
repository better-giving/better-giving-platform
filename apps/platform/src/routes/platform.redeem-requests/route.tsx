import { Select } from "@better-giving/ui";
import { Outlet, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { metas } from "#/helpers/seo";
import { use_table } from "#/hooks/use-table";
import type { TStatus } from "@/balance-txs";
import type { Route } from "./+types/route";
import { Table } from "./table";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = () =>
  metas({ title: "Redemption requests" });

export default CacheRoute(Page);
function Page({ loaderData: page1 }: Route.ComponentProps) {
  const [search, set_search] = useSearchParams();
  const status = (search.get("status") ?? "pending") as TStatus;
  const { node } = use_table({
    page1,
    table: (props) => <Table {...props} />,
    classes: "mt-4",
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(search);
      p.set("next", next);
      load(`?${p.toString()}`);
    },
  });
  return (
    <div className="px-4 py-4 md:px-10 md:py-8 w-full max-w-4xl grid content-start">
      <h1 className="sr-only">Redemption requests</h1>
      <div className="flex items-center gap-x-4 mb-4">
        <Select
          options={["pending", "final", "cancelled"]}
          onChange={(x) =>
            set_search((p) => {
              p.set("status", x);
              return p;
            })
          }
          value={status}
          option_disp={(x) => x}
          classes={{ button: "px-4 py-2 text-sm", option: "text-sm" }}
        />
      </div>
      {node}
      <Outlet />
    </div>
  );
}
