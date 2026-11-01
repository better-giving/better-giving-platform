import { user_ctx } from "#/.server/auth";
import { search } from "@/helpers/https";
import type { IPageKeyed } from "@/types/api";
import { type INpoDonation, referrer_donations } from "$/pg/queries/dist";
import { user_get } from "$/pg/queries/user";
import type { Route } from "./+types/route";

export interface LoaderData extends IPageKeyed<INpoDonation> {}
export const loader = async ({ context, url }: Route.LoaderArgs) => {
  const user = context.get(user_ctx);
  const db_user = await user_get(user.email);
  if (!db_user) throw new Response("user not found", { status: 404 });
  const { next } = search(url);

  // non-null: see `IUserRow`'s doc comment
  const page = await referrer_donations(db_user.referral_code!, {
    next: next,
    limit: 8,
  });
  return page satisfies LoaderData;
};
