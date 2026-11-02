import { Breadcrumb } from "@better-giving/ui";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { admin_ctx } from "#/.server/auth";
import { use_table } from "#/hooks/use-table";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { search } from "@/helpers/https";
import { npo_payouts } from "$/pg/queries/payout";
import { npo_sent_transfers } from "$/stripe-connect/sent";
import type { Route } from "./+types/route";
import { PayoutsTable } from "./common/payouts-table";
import { SentToStripe } from "./sent";

export const loader = async (x: Route.LoaderArgs) => {
  const { next } = search(x.url);
  const id = x.context.get(admin_ctx);

  const page = await npo_payouts(id, {
    next,
    limit: 5,
  });
  // one shape either way: a load-more reads only the next payout page, and a
  // missing `sent` on that branch is what collapsed the list's type
  return {
    ...page,
    sent: next ? null : await npo_sent_transfers(id),
  };
};
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Payouts", matches);

export default CacheRoute(Page);
function Page({ loaderData: page1, params }: Route.ComponentProps) {
  const [search] = useSearchParams();
  const { node } = use_table({
    page1,
    table: (x) => <PayoutsTable {...x} />,
    gen_loader: (load, next) => () => {
      const p = new URLSearchParams(search);
      if (next) p.set("next", next);
      load(`?${p.toString()}`);
    },
  });
  const { sent } = page1;
  // the bank table's empty row is this page's only content off Connect. beside
  // the stripe list it would still say nothing was paid after a transfer
  const show_bank = sent === null || page1.items.length > 0;

  return (
    <div className="grid content-start px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        classes="mb-3"
        items={[
          {
            label: "Dashboard",
            to: href("/admin/:id/dashboard", { id: params.id }),
          },
          { label: "Grant items" },
        ]}
      />
      {sent && <SentToStripe sent={sent} classes={show_bank ? "mb-8" : ""} />}
      {show_bank && sent && <h2 className="font-bold text-lg mb-3">Payouts</h2>}
      {show_bank && node}
    </div>
  );
}
