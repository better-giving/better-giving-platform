import type { ActionFunctionArgs } from "react-router";
import { safeParse } from "valibot";
import { get_session } from "#/.server/auth";
import { resp } from "@/helpers/https";
import { $int_gte1 } from "@/schemas";
import { api_key_put } from "$/pg/queries/api-key";

// rotating is a write: an action, so prefetch, history restore or a cross-site
// link (SameSite=Lax still sends the cookie on a top-level GET) can't trigger it
export async function action({ params, request }: ActionFunctionArgs) {
  const { user } = await get_session(request);
  if (user?.role !== "admin") {
    return new Response(null, { status: 401 });
  }

  const p = safeParse($int_gte1, params.id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const key = await api_key_put(p.output);
  return new Response(key, { headers: { "cache-control": "no-store" } });
}
