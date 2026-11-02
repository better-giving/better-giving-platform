import { Breadcrumb, Info } from "@better-giving/ui";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { use_table } from "#/hooks/use-table";
import { OwedHistory } from "#/routes/_helpers/owed-history";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";
import { Table } from "./table";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Payouts", matches);

export default CacheRoute(Page);
function Page({ loaderData, params: { id } }: Route.ComponentProps) {
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
          { label: "Referrals", to: href("/admin/:id/referrals", { id }) },
          { label: "Payouts" },
        ]}
      />
      {loaderData.referral_id === null ? (
        <Info classes="mt-2">
          Your referral link isn't set up yet. Check back soon or contact
          support.
        </Info>
      ) : (
        <>
          {node}
          <OwedHistory
            rows={loaderData.owed ?? []}
            run_noun="payout"
            received_label="Commission"
          />
        </>
      )}
    </div>
  );
}
