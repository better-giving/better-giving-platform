import { get_session } from "#/.server/auth";
import { npo_admin_member } from "$/pg/queries/user";

/** an unpublished org shows to its own admins and to platform admins */
export async function can_preview(request: Request, npo_id: number) {
  const { user } = await get_session(request);
  if (!user) return false;
  return user.role === "admin" || npo_admin_member(user.id, npo_id);
}
