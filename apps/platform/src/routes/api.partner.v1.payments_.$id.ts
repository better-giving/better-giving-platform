import { open_key, partner_route } from "$/partner/gate";
import { read_payment } from "$/partner/payments";
import { problem } from "$/partner/problem";
import { db } from "$/pg/db";
import type { Route } from "./+types/api.partner.v1.payments_.$id";

export const loader = partner_route(
  async ({ request, params }: Route.LoaderArgs) => {
    const live = await open_key(db, request, "read");
    if (live instanceof Response) return live;
    return read_payment(db, live.npo_id, params.id);
  }
);

export const action = partner_route(async () => problem("not_found"));
