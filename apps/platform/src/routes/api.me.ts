import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { safeParse } from "valibot";
import { get_session, to_auth } from "#/.server/auth";
import { user_bookmarks, user_npos } from "#/.server/user";
import type { PublicUser } from "#/types/auth";
import { resp } from "@/helpers/https";
import { $int_gte1 } from "@/schemas";
import {
  user_bookmark_del,
  user_bookmark_put,
  user_get,
} from "$/pg/queries/user";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { user } = await get_session(request);

  if (!user) {
    return Response.json(null, {
      headers: { "cache-control": "private, no-store" },
    });
  }

  const [bookmarks, orgs, db_user] = await Promise.all([
    user_bookmarks(user.id),
    user_npos(user.id),
    user_get(user.email),
  ]);

  const public_user: PublicUser = {
    avatar_url: db_user?.avatar_url ?? undefined,
    is_admin: user.role === "admin",
    bookmarks,
    orgs,
  };

  return Response.json(public_user, {
    headers: { "cache-control": "private, no-store" },
  });
};

export const action = async ({ request, url }: ActionFunctionArgs) => {
  const { user } = await get_session(request);
  if (!user) return to_auth(url);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle-bookmark") {
    const bookmark_action = form.get("action") as string;
    const p = safeParse($int_gte1, form.get("npo_id"));
    if (p.issues) return resp.status(400, p.issues[0].message);
    const npo_id = p.output;

    if (bookmark_action === "add") {
      await user_bookmark_put(user.id, npo_id);
    } else if (bookmark_action === "delete") {
      await user_bookmark_del(user.id, npo_id);
    }

    return Response.json({ ok: true });
  }

  return new Response("invalid intent", { status: 400 });
};
