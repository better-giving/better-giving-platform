import * as v from "valibot";
import { with_actor_names } from "#/.server/loss-log-actors";
import { resp } from "@/helpers/https";
import { loss_log_list } from "$/pg/queries/revenue";
import type { Route } from "./+types/route";

export const loader = async ({ url }: Route.LoaderArgs) => {
  const { searchParams: s } = url;

  const p = v.safeParse(v.nullable(v.string()), s.get("next"));
  if (p.issues) throw resp.status(400, p.issues[0].message);

  const page = await loss_log_list({
    limit: 20,
    next: p.output ?? undefined,
  });

  return { ...page, items: await with_actor_names(page.items) };
};
