import { resp } from "@/helpers/https";
import { open_key, partner_route } from "$/partner/gate";
import { problem } from "$/partner/problem";
import { readiness } from "$/partner/readiness";
import { db } from "$/pg/db";
import type { Route } from "./+types/api.partner.v1.readiness";

export const loader = partner_route(async ({ request }: Route.LoaderArgs) => {
  const live = await open_key(db, request);
  if (live instanceof Response) return live;
  const body = await readiness(db, live.npo_id);
  return resp.json(body, 200, { "cache-control": "no-store" });
});

export const action = partner_route(async () => problem("not_found"));
