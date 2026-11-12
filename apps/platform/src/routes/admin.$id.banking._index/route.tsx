import { href } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import {
  BankPayoutSection,
  HeldMoneyCard,
  is_linked,
} from "#/components/payout-options";
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
  const { methods, stripe, connect_routing, has_bank, bank_pending, held } =
    loaderData;
  use_strip_connect_params(connect_routing && !!stripe.notice);
  const offers_stripe = connect_routing && !stripe.ineligible;
  const stripe_linked = is_linked(stripe.status);
  const holds_money = !!held && held.total > 0;

  return (
    <div className="grid gap-8 content-start px-4 py-4 md:px-10 md:py-8 max-w-[1400px]">
      <h1 className="sr-only">Banking</h1>
      {holds_money && held && (
        <HeldMoneyCard
          held={held}
          rails={stripe_linked ? "stripe" : "none"}
          bank_pending={bank_pending}
          add_bank_href="new"
          {...(offers_stripe && { connect_href: stripe.start_href })}
        />
      )}

      <BankPayoutSection
        table={
          methods.length > 0 ? (
            <div className="table-scroll">
              <Table methods={methods} />
            </div>
          ) : undefined
        }
        has_bank={has_bank}
        stripe_status={stripe.status}
        holds_money={holds_money}
        bank_pending={bank_pending}
        add_href="new"
      />

      {connect_routing && (
        <StripeConnectCard
          {...stripe}
          has_bank={has_bank}
          bank_pending={bank_pending}
          holds_money={holds_money}
          payouts_href={href("/admin/:id/dashboard/payouts", { id: params.id })}
        />
      )}
    </div>
  );
}
