import { user_ctx } from "#/.server/auth";
import { search } from "@/helpers/https";
import { referrer_owed_history } from "$/pg/queries/owed-history";
import { referrer_payout_list } from "$/pg/queries/referrer";
import { user_get } from "$/pg/queries/user";
import type { Route } from "./+types/route";

export const loader = async ({ context, url }: Route.LoaderArgs) => {
  const user = context.get(user_ctx);
  const db_user = await user_get(user.email);
  if (!db_user) throw new Response("user not found", { status: 404 });

  const { nextKey: next } = search(url);
  // non-null: see `IUserRow`'s doc comment
  const code = db_user.referral_code!;
  // the history is the page's: a load-more reads only its payouts
  const [page, owed] = await Promise.all([
    referrer_payout_list(code, { next, limit: 8 }),
    next ? undefined : referrer_owed_history({ referrer_user: code }),
  ]);
  return { ...page, ...(owed && { owed }) };
};
