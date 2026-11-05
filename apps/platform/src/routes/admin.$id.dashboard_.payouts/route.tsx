import { Breadcrumb } from "@better-giving/ui";
import { useId } from "react";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { admin_ctx } from "#/.server/auth";
import { PayoutsHeldCard, type THeldRails } from "#/components/payout-options";
import { use_table } from "#/hooks/use-table";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { search } from "@/helpers/https";
import type { IHeldMoney } from "@/payouts";
import { connect_start_href } from "@/stripe-connect/card-data";
import { stripe as stripe_env } from "$/env";
import { db } from "$/pg/db";
import { npo_default_bapp } from "$/pg/queries/banking";
import { held_money } from "$/pg/queries/held-money";
import { npo_get } from "$/pg/queries/npo";
import { npo_payouts } from "$/pg/queries/payout";
import { npo_sent_transfers } from "$/stripe-connect/sent";
import type { Route } from "./+types/route";
import { PayoutsTable } from "./common/payouts-table";
import { SentToStripe, stripe_link, WhereMoneyShows } from "./sent";

export const loader = async (x: Route.LoaderArgs) => {
  const { next } = search(x.url);
  const id = x.context.get(admin_ctx);

  const page = await npo_payouts(id, {
    next,
    limit: 5,
  });
  // one shape either way: a load-more reads only the next payout page, and a
  // missing `sent` on that branch is what collapsed the list's type
  if (next) return { ...page, sent: null, held: null };
  const [sent, held] = await Promise.all([npo_sent_transfers(id), held_of(id)]);
  return { ...page, sent, held };
};

interface IHeld {
  money: IHeldMoney;
  rails: THeldRails;
  connect_href: string;
}

/** what waits for a bank, for a nonprofit that linked stripe instead of one.
 * the card speaks of stripe, so a nonprofit that never linked an account, or
 * one routing is off for, gets none */
async function held_of(npo_id: number): Promise<IHeld | null> {
  if (!stripe_env.connect_routing) return null;
  const [npo, bank] = await Promise.all([
    npo_get(npo_id),
    npo_default_bapp(npo_id),
  ]);
  if (bank || !npo?.stripe_account_id) return null;
  return {
    money: await held_money(db, npo_id),
    rails: npo.stripe_deauthorized_at ? "none" : "stripe",
    connect_href: connect_start_href({ kind: "npo", npo_id }),
  };
}
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
  const { sent, held } = page1;
  const payouts_heading_id = useId();
  const holds_money = !!held && held.money.total > 0;
  // the bank table's empty row is this page's only content off Connect, and
  // where card gifts land once they stop routing. beside a live stripe list it
  // would still say nothing was paid after a transfer. pending payouts the
  // held card lists have no bank to go to, so they are not the bank list's
  const bank_items = holds_money
    ? page1.items.filter((p) => p.type !== "pending")
    : page1.items;
  const show_bank = (!sent?.on_stripe && !holds_money) || bank_items.length > 0;

  return (
    <div className="grid gap-6 content-start px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        items={[
          {
            label: "Dashboard",
            to: href("/admin/:id/dashboard", { id: params.id }),
          },
          { label: "Grant items" },
        ]}
      />
      {held && (
        <PayoutsHeldCard
          held={held.money}
          rails={held.rails}
          add_bank_href={href("/admin/:id/banking/new", { id: params.id })}
          connect_href={held.connect_href}
        />
      )}
      {sent && show_bank && <WhereMoneyShows link={stripe_link(sent)} />}
      {sent && <SentToStripe sent={sent} />}
      {show_bank && sent && (
        <section aria-labelledby={payouts_heading_id} className="grid gap-3">
          <div className="grid gap-1">
            <h2 id={payouts_heading_id} className="font-bold text-lg">
              Payouts
            </h2>
            <p className="text-sm text-gray-11 max-w-3xl">
              Sent to your bank every 3 days once your balance reaches your
              payout minimum.
            </p>
          </div>
          {node}
        </section>
      )}
      {show_bank && !sent && node}
    </div>
  );
}
