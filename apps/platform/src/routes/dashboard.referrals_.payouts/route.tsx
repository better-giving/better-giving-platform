import { Breadcrumb } from "@better-giving/ui";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { use_table } from "#/hooks/use-table";
import { OwedHistory } from "#/routes/_helpers/owed-history";
import type { Route } from "./+types/route";
import { Table } from "./table";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const { node } = use_table({
    table: (props) => <Table {...props} />,
    page1: loaderData,
    classes: "mt-2",
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(params);
      if (next) p.set("nextKey", next);
      load(`?${p.toString()}`);
    },
  });

  return (
    <div className="px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        classes="mb-2"
        items={[
          { label: "My referrals", to: href("/dashboard/referrals") },
          { label: "Payouts" },
        ]}
      />
      {node}
      <OwedHistory
        rows={loaderData.owed ?? []}
        run_noun="payout"
        received_label="Commission"
      />
    </div>
  );
}
