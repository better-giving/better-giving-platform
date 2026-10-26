import { asc, eq } from "drizzle-orm";
import { href, redirect } from "react-router";
import { get_session, to_auth } from "#/.server/auth";
import { search } from "@/helpers/https";
import { db } from "$/pg/db";
import { user_npo_memberships } from "$/pg/schema/user";
import type { Route } from "./+types/route";

/** signed-in nonprofit admins land on Campaigns → New; everyone else is sent on */
export async function campaign_new_target(request: Request) {
  const { user } = await get_session(request);
  if (!user) return to_auth(request);
  const rows = await db
    .select({ npo_id: user_npo_memberships.npo_id })
    .from(user_npo_memberships)
    .where(eq(user_npo_memberships.user_id, user.id))
    .orderBy(asc(user_npo_memberships.npo_id));
  const { npo } = search(request);
  const requested = Number(npo);
  const match = rows.find((r) => r.npo_id === requested);
  const id = match?.npo_id ?? rows[0]?.npo_id;
  if (!id) return redirect("/marketplace", 302);
  return redirect(href("/admin/:id/campaigns/new", { id: String(id) }), 302);
}

export const loader = ({ request }: Route.LoaderArgs) =>
  campaign_new_target(request);

export const action = ({ request }: Route.ActionArgs) =>
  campaign_new_target(request);
