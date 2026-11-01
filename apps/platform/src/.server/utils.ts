import { and, eq } from "drizzle-orm";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  Params,
} from "react-router";
import { safeParse } from "valibot";
import { get_session, to_auth } from "#/.server/auth";
import { resp } from "@/helpers/https";
import { $int_gte1 } from "@/npo/schema";
import { db } from "$/pg/db";
import { user_npo_memberships } from "$/pg/schema/user";

interface IChecked {
  req: Request;
  params: Params<string>;
  id: number;
  email: string;
  user_id: string;
  is_admin: boolean;
}

export const admin_checks = async ({
  request,
  params,
  url,
}: LoaderFunctionArgs | ActionFunctionArgs): Promise<Response | IChecked> => {
  const p = safeParse($int_gte1, params.id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;
  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  if (user.role !== "admin") {
    const [membership] = await db
      .select({ npo_id: user_npo_memberships.npo_id })
      .from(user_npo_memberships)
      .where(
        and(
          eq(user_npo_memberships.user_id, user.id),
          eq(user_npo_memberships.npo_id, id)
        )
      )
      .limit(1);

    if (!membership) return resp.status(403);
  }

  return {
    req: request,
    params,
    id,
    email: user.email,
    user_id: user.id,
    is_admin: user.role === "admin",
  };
};

export const is_resp = (x: any): x is Response => x instanceof Response;
