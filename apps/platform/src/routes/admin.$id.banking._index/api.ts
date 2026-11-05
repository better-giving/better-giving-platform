import Stripe from "stripe";
import { admin_ctx } from "#/.server/auth";
import { report_degraded } from "#/errors/report";
import type { IBapp } from "@/banking";
import type { IHeldMoney } from "@/payouts";
import {
  connect_notice,
  connect_start_href,
  type IConnectCardData,
} from "@/stripe-connect/card-data";
import { connect_ineligibility } from "@/stripe-connect/eligibility";
import {
  connect_status,
  mirror_of,
  type TConnectStatus,
} from "@/stripe-connect/readiness";
import { stripe as stripe_env } from "$/env";
import { db } from "$/pg/db";
import { npo_bapps, npo_default_bapp } from "$/pg/queries/banking";
import { held_money } from "$/pg/queries/held-money";
import { type INpo, npo_get } from "$/pg/queries/npo";
import { sync_npo_account } from "$/stripe-connect/sync";
import type { Route } from "./+types/route";

export interface LoaderData {
  methods: IBapp[];
  stripe: IConnectCardData;
  connect_routing: boolean;
  /** a default bank is on file: everything not routed to stripe pays out */
  has_bank: boolean;
  /** what waits for a bank, once stripe stands in for one. null beside a
   * bank, and wherever stripe was never linked or routing is off: the held
   * card speaks of stripe */
  held: IHeldMoney | null;
}

export const loader = async (x: Route.LoaderArgs) => {
  const id = x.context.get(admin_ctx);
  const connect_routing = stripe_env.connect_routing;

  const [page, stripe_part, bank] = await Promise.all([
    npo_bapps(id),
    connect_routing ? stripe_of(id, x.url) : Promise.resolve(null),
    npo_default_bapp(id),
  ]);
  const stripe: IConnectCardData = {
    status: "not_connected",
    start_href: connect_start_href({ kind: "npo", npo_id: id }),
    ...stripe_part,
  };
  return {
    methods: page.items,
    stripe,
    connect_routing,
    has_bank: !!bank,
    held:
      bank || stripe.status === "not_connected"
        ? null
        : await held_money(db, id),
  } satisfies LoaderData;
};

type TStripePart = Pick<IConnectCardData, "status" | "notice" | "ineligible">;

async function stripe_of(npo_id: number, url: URL): Promise<TStripePart> {
  const npo = await npo_get(npo_id);
  const ineligible = npo && connect_ineligibility(npo);
  // the card offers nothing then, so stripe isn't asked and no notice shows
  if (ineligible) return { status: "not_connected", ineligible };
  return {
    status: await stripe_status(npo),
    notice: connect_notice(url),
  };
}

async function stripe_status(npo: INpo | undefined): Promise<TConnectStatus> {
  if (!npo?.stripe_account_id) return "not_connected";
  const deauthorized_at = npo.stripe_deauthorized_at;
  if (npo.stripe_synced_at || deauthorized_at) {
    return connect_status(mirror_of(npo), deauthorized_at);
  }
  try {
    const m = await sync_npo_account(npo.id);
    return m === "disconnected" ? m : connect_status(m, null);
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeError)) throw err;
    report_degraded(err);
    // linked but unread: never "ready", and not the nonprofit's move
    return "pending";
  }
}
