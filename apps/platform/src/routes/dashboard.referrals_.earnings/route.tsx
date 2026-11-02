import { Breadcrumb } from "@better-giving/ui";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { use_table } from "#/hooks/use-table";
import { EarningsHistory } from "#/pages/user-dashboard/referrals/earnings-table";
import type { Route } from "./+types/route";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export default CacheRoute(Page);
function Page({ loaderData: page1 }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const { node } = use_table({
    page1,
    table: (props) => <EarningsHistory {...props} />,
    classes: "mt-2",
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(params);
      if (next) p.set("next", next);
      load(`?${p.toString()}`);
    },
  });

  return (
    <div className="px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        classes="mb-2"
        items={[
          { label: "My referrals", to: href("/dashboard/referrals") },
          { label: "Earnings" },
        ]}
      />
      {node}
    </div>
  );
}
