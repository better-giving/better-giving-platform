import { and, eq } from "drizzle-orm";
import { createContext, type MiddlewareFunction } from "react-router";
import { safeParse } from "valibot";
import { resp } from "@/helpers/https";
import { $int_gte1 } from "@/npo/schema";
import { db } from "$/pg/db";
import { user_npo_memberships } from "$/pg/schema/user";
import { auth } from "./auth";
import { to_auth } from "./to-auth";

export type AuthUser = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>["user"];

export const user_ctx = createContext<AuthUser>();

export const auth_mdlwr: MiddlewareFunction = async (
  { request, context, url },
  next
) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw to_auth(url);
  context.set(user_ctx, session.user);
  return next();
};

export const admin_mdlwr: MiddlewareFunction = async ({ context }, next) => {
  const user = context.get(user_ctx);
  if (user.role !== "admin") throw resp.status(403);
  return next();
};

export const admin_ctx = createContext<number>();

export const npo_admin_mdlwr: MiddlewareFunction = async (
  { params, context },
  next
) => {
  const user = context.get(user_ctx);
  const p = safeParse($int_gte1, params.id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;

  if (user.role !== "admin") {
    // check npo membership directly (user_email until FK migration to user_id)
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

    if (!membership) throw resp.status(403);
  }

  context.set(admin_ctx, id);
  return next();
};
