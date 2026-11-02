import { Breadcrumb, Info } from "@better-giving/ui";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { use_table } from "#/hooks/use-table";
import { EarningsHistory } from "#/pages/admin/referrals/earnings-table";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Earnings", matches);

export default CacheRoute(Page);
function Page({ loaderData: page1, params: { id } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const { node } = use_table({
    classes: "mt-2",
    table: (x) => <EarningsHistory {...x} />,
    page1,
    gen_loader: (load, next) => () => {
      const n = new URLSearchParams(params);
      if (next) n.set("nextKey", next.toString());
      load(`?${n.toString()}`);
    },
  });

  return (
    <div className="px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        classes="mb-2"
        items={[
          { label: "Referrals", to: href("/admin/:id/referrals", { id }) },
          { label: "Earnings" },
        ]}
      />
      {page1.referral_id === null ? (
        <Info classes="mt-2">
          Your referral link isn't set up yet. Check back soon or contact
          support.
        </Info>
      ) : (
        node
      )}
    </div>
  );
}
