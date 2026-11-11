import { Breadcrumb } from "@better-giving/ui";
import { useId } from "react";
import { href, useSearchParams } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { admin_ctx } from "#/.server/auth";
import { PayoutsHeldCard, type THeldRails } from "#/components/payout-options";
import { BANK_PAYOUT_SENTENCE } from "#/components/payout-options/rows";
import { use_table } from "#/hooks/use-table";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { search } from "@/helpers/https";
import type { IHeldMoney } from "@/payouts";
import { stripe_standing } from "@/payouts/payout-to";
import { connect_start_href } from "@/stripe-connect/card-data";
import { stripe as stripe_env } from "$/env";
import { held_money_net } from "$/payouts/held-net";
import { db } from "$/pg/db";
import { npo_bapp_in_review, npo_default_bapp } from "$/pg/queries/banking";
import { has_held_money } from "$/pg/queries/held-money";
import { npo_get } from "$/pg/queries/npo";
import { npo_payouts } from "$/pg/queries/payout";
import { npo_sent_transfers } from "$/stripe-connect/sent";
import type { Route } from "./+types/route";
import { PayoutsTable } from "./common/payouts-table";
import { SentToStripe, stripe_link, WhereMoneyShows } from "./sent";

export const loader = async (x: Route.LoaderArgs) => {
  const { next } = search(x.url);
  const id = x.context.get(admin_ctx);

  const [standing, sent] = await Promise.all([
    standing_of(id),
    next ? null : npo_sent_transfers(id),
  ]);
  const held = next ? null : await held_of(id, standing);
  // a load-more needs only whether anything is held, not what
  const holds = next
    ? !!standing.held_rails && (await has_held_money(db, id))
    : holds_money(held);
  // pending payouts the held card lists have no bank to go to, so the bank
  // table pages past them: on every page, or a first page of them hides the
  // paid history behind it
  const page = await npo_payouts(id, {
    next,
    limit: 5,
    not_status: holds ? "pending" : undefined,
  });
  const { has_bank, bank_pending } = standing;
  // one shape either way: a load-more reads only the next payout page, and a
  // missing `sent` on that branch is what collapsed the list's type
  if (next) return { ...page, sent: null, held: null, has_bank, bank_pending };
  return { ...page, sent, held, has_bank, bank_pending };
};

const holds_money = (held: IHeld | null) => !!held && held.money.total > 0;

interface IStanding {
  /** a default bank is on file */
  has_bank: boolean;
  /** no default bank, and one filed waits for review */
  bank_pending: boolean;
  /** the held card speaks of stripe, so it is for a nonprofit with no bank
   * that linked stripe instead (`stripe_standing`). null for any other */
  held_rails: THeldRails | null;
}

async function standing_of(npo_id: number): Promise<IStanding> {
  const [npo, bank, in_review] = await Promise.all([
    npo_get(npo_id),
    npo_default_bapp(npo_id),
    npo_bapp_in_review(npo_id),
  ]);
  const stripe = stripe_standing(npo, stripe_env.connect_routing);
  return {
    has_bank: !!bank,
    bank_pending: !bank && in_review,
    held_rails:
      bank || !stripe ? null : stripe === "linked" ? "stripe" : "none",
  };
}

interface IHeld {
  money: IHeldMoney;
  rails: THeldRails;
  bank_pending: boolean;
  connect_href: string;
}

async function held_of(
  npo_id: number,
  { held_rails, bank_pending }: IStanding
): Promise<IHeld | null> {
  if (!held_rails) return null;
  return {
    money: await held_money_net(db, npo_id),
    rails: held_rails,
    bank_pending,
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
  const { sent, held, has_bank, bank_pending } = page1;
  const payouts_heading_id = useId();
  // the bank table's empty row is this page's only content off Connect, and
  // where card, bank and wallet donations land once they stop routing. beside a
  // live stripe list it would still say nothing was paid after a transfer
  const show_bank =
    (!sent?.on_stripe && !holds_money(held)) || page1.items.length > 0;

  return (
    <div className="grid gap-6 content-start px-4 py-4 md:px-10 md:py-8">
      <Breadcrumb
        items={[
          {
            label: "Dashboard",
            to: href("/admin/:id/dashboard", { id: params.id }),
          },
          { label: "Payouts" },
        ]}
      />
      {held && (
        <PayoutsHeldCard
          held={held.money}
          rails={held.rails}
          bank_pending={held.bank_pending}
          add_bank_href={href("/admin/:id/banking/new", { id: params.id })}
          connect_href={held.connect_href}
        />
      )}
      {sent && show_bank && (
        <WhereMoneyShows
          link={stripe_link(sent)}
          has_bank={has_bank}
          bank_pending={bank_pending}
        />
      )}
      {sent && (
        <SentToStripe
          sent={sent}
          has_bank={has_bank}
          bank_pending={bank_pending}
        />
      )}
      {show_bank && sent && (
        <section aria-labelledby={payouts_heading_id} className="grid gap-3">
          <div className="grid gap-1">
            <h2 id={payouts_heading_id} className="font-bold text-lg">
              Payouts
            </h2>
            <p className="text-sm text-gray-11 max-w-3xl">
              {BANK_PAYOUT_SENTENCE}
            </p>
          </div>
          {node}
        </section>
      )}
      {show_bank && !sent && node}
    </div>
  );
}
