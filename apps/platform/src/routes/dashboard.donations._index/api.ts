import { safeParse } from "valibot";
import { user_ctx } from "#/.server/auth";
import { page_opts } from "@/donations/schema";
import { resp, search } from "@/helpers/https";
import { user_donations_page } from "$/pg/queries/donation";
import type { Route } from "./+types/route";
import { to_row } from "./helpers";

export const loader = async ({ context, url }: Route.LoaderArgs) => {
  const user = context.get(user_ctx);
  const raw = search(url);
  const p = safeParse(page_opts, raw);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const { limit = 10, next: n } = p.output;
  const status = raw.status as string | undefined;
  const { items, next } = await user_donations_page(user.email, {
    limit,
    next: n,
    status: status || undefined,
  });

  return { next, user, items: items.map(to_row) };
};
