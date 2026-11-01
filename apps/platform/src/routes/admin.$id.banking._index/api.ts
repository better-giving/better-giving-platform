import Stripe from "stripe";
import { admin_ctx } from "#/.server/auth";
import { report_degraded } from "#/errors/report";
import type { IBapp } from "@/banking";
import {
  connect_notice,
  connect_start_href,
  type IConnectCardData,
} from "@/stripe-connect/card-data";
import {
  connect_status,
  mirror_of,
  type TConnectStatus,
} from "@/stripe-connect/readiness";
import { stripe as stripe_env } from "$/env";
import { npo_bapps } from "$/pg/queries/banking";
import { npo_get } from "$/pg/queries/npo";
import { sync_npo_account } from "$/stripe-connect/sync";
import type { Route } from "./+types/route";

export interface LoaderData {
  methods: IBapp[];
  stripe: IConnectCardData;
  connect_routing: boolean;
}

export const loader = async (x: Route.LoaderArgs) => {
  const id = x.context.get(admin_ctx);
  const connect_routing = stripe_env.connect_routing;

  const [page, status] = await Promise.all([
    npo_bapps(id),
    connect_routing
      ? stripe_status(id)
      : Promise.resolve("not_connected" as const),
  ]);
  const stripe: IConnectCardData = {
    status,
    start_href: connect_start_href({ kind: "npo", npo_id: id }),
    ...(connect_routing && {
      notice: connect_notice(x.url),
    }),
  };
  return { methods: page.items, stripe, connect_routing } satisfies LoaderData;
};

async function stripe_status(npo_id: number): Promise<TConnectStatus> {
  const npo = await npo_get(npo_id);
  if (!npo?.stripe_account_id) return "not_connected";
  const deauthorized_at = npo.stripe_deauthorized_at;
  if (npo.stripe_synced_at || deauthorized_at) {
    return connect_status(mirror_of(npo), deauthorized_at);
  }
  try {
    const m = await sync_npo_account(npo_id);
    return m === "disconnected" ? m : connect_status(m, null);
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeError)) throw err;
    report_degraded(err);
    // linked but unread: never "ready", and not the nonprofit's move
    return "pending";
  }
}
