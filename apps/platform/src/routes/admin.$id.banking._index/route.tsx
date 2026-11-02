import { EmptyState } from "@better-giving/ui";
import { Landmark, Plus } from "lucide-react";
import { NavLink } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
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
function Page({ loaderData }: Route.ComponentProps) {
  const { methods, stripe, connect_routing } = loaderData;
  use_strip_connect_params(connect_routing && !!stripe.notice);

  return (
    <div className="px-4 py-4 md:px-10 md:py-8 max-w-[1400px]">
      <h1 className="sr-only">Banking</h1>
      <div className="flex justify-end mb-4">
        <NavLink to="new" className="btn btn-primary shrink-0">
          <Plus className="mr-2 icon-md" />
          <span className="whitespace-nowrap">Add bank account</span>
        </NavLink>
      </div>
      {connect_routing && <StripeConnectCard {...stripe} classes="mb-8" />}

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
    </div>
  );
}
