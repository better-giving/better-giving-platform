import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { require_live_key, reserve_keyed } from "$/connector/gate";
import { connector_route } from "$/connector/http";
import { revoke_key } from "$/connector/keys";
import { problem } from "$/connector/problem";
import { db } from "$/pg/db";

const NO_STORE = { "cache-control": "no-store" };

export function loader(_args: LoaderFunctionArgs) {
  return problem(404, "unknown_action");
}

export const action = connector_route(
  async ({ request }: ActionFunctionArgs) => {
    if (request.method !== "POST") return problem(404, "unknown_action");
    const live = await require_live_key(db, request);
    if (live instanceof Response) return live;
    if (!reserve_keyed(live.id)) return problem(429, "rate_limited");
    await revoke_key(db, {
      id: live.id,
      npo_id: live.npo_id,
      revoked_by: null,
    });
    return new Response(null, { status: 204, headers: NO_STORE });
  }
);
