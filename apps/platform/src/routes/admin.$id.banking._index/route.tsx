import { Badge, EmptyState } from "@better-giving/ui";
import { Landmark, Plus } from "lucide-react";
import { useId } from "react";
import { href, NavLink } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { PayoutOptions } from "#/components/payout-options";
import { StripeConnectCard } from "#/components/stripe-connect/connect-card";
import { use_strip_connect_params } from "#/hooks/use-strip-connect-params";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import type { Route } from "./+types/route";
import { Table } from "./table";

export { loader } from "./api";
// the return from stripe is a document load, and the default in-memory cache
// starts empty on one, so the status it shows is the server's. a persistent
// adapter (`configureGlobalCache`) would serve the previous return's instead.
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export { ErrorBoundary } from "#/components/error";
export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Banking", matches);

export default CacheRoute(Page);
function Page({ loaderData, params }: Route.ComponentProps) {
  const { methods, stripe, connect_routing } = loaderData;
  use_strip_connect_params(connect_routing && !!stripe.notice);
  const bank_heading_id = useId();
  const show_options = connect_routing && !stripe.ineligible;

  return (
    <div className="grid gap-8 content-start px-4 py-4 md:px-10 md:py-8 max-w-[1400px]">
      <h1 className="sr-only">Banking</h1>
      {show_options && (
        <PayoutOptions
          variant={stripe.status === "not_connected" ? "open" : "collapsed"}
        />
      )}

      <section aria-labelledby={bank_heading_id} className="grid gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="grid gap-1">
            <div className="flex items-center gap-2">
              <h2 id={bank_heading_id} className="text-lg font-semibold">
                Bank payout
              </h2>
              <Badge tone="primary">Required</Badge>
            </div>
            <p className="text-sm text-gray-11 max-w-3xl">
              Grants are sent to your bank through Wise, a money-transfer
              service, in the currency you choose. Every kind of donation can
              pay out here, every 3 days once your balance reaches your payout
              minimum.
            </p>
          </div>
          <NavLink to="new" className="btn btn-primary md:shrink-0">
            <Plus className="mr-2 icon-md" />
            <span className="whitespace-nowrap">Add bank account</span>
          </NavLink>
        </div>

        {methods.length === 0 ? (
          <div className="card">
            <EmptyState
              heading="No payout methods yet"
              icon={<Landmark className="icon-xl" />}
            >
              Payout methods you add will show up here.
            </EmptyState>
          </div>
        ) : (
          <div className="grid col-span-full table-scroll">
            <Table methods={methods} />
          </div>
        )}
      </section>

      {connect_routing && (
        <StripeConnectCard
          {...stripe}
          payouts_href={href("/admin/:id/dashboard/payouts", { id: params.id })}
        />
      )}
    </div>
  );
}
