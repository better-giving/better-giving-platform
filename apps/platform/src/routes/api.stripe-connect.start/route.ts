import { redirect } from "react-router";
import * as v from "valibot";
import { get_session, to_auth } from "#/.server/auth";
import { resp } from "@/helpers/https";
import { $int_gte1 } from "@/npo/schema";
import { reg_id } from "@/reg/schema";
import { stripe as stripe_env } from "$/env";
import { stripe } from "$/kit/stripe";
import { sign_state } from "$/stripe-connect/state";
import { return_path, target_access } from "$/stripe-connect/target";
import type { Route } from "./+types/route";

const target_query = v.variant("kind", [
  v.object({ kind: v.literal("reg"), reg_id }),
  v.object({ kind: v.literal("npo"), npo_id: $int_gte1 }),
]);

export async function loader({ request, url }: Route.LoaderArgs) {
  if (!stripe_env.connect_routing) return resp.status(404);
  const { user } = await get_session(request);
  if (!user) return to_auth(url);
  const client_id = stripe_env.connect_client_id;
  if (!client_id) return resp.status(503, "stripe connect is not configured");

  const p = v.safeParse(target_query, Object.fromEntries(url.searchParams));
  if (!p.success) return resp.status(400, p.issues[0].message);
  const t = p.output;

  const access = await target_access(user, t);
  if (!access.ok) return resp.status(access.status);

  // the ui asks before replacing, and says so with replace=1
  const replace = url.searchParams.get("replace") === "1";
  if (access.replaces && !replace) {
    return redirect(return_path(t, "error", "replace_unconfirmed"));
  }

  const to = stripe.oauth.authorizeUrl({
    client_id,
    response_type: "code",
    scope: "read_write",
    redirect_uri: `${url.origin}/api/stripe-connect/callback`,
    state: sign_state({ t, uid: user.id, replace }),
  });
  return redirect(to);
}
