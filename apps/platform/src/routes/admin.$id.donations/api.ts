import { safeParse } from "valibot";
import { admin_ctx } from "#/.server/auth";
import { endowUpdate } from "#/pages/admin/endow-update-action";
import { donations_search } from "@/donations/schema";
import { resp, search } from "@/helpers/https";
import { npo_donations } from "$/pg/queries/dist";
import type { Route } from "./+types/route";

export const loader = async (x: Route.LoaderArgs) => {
  const id = x.context.get(admin_ctx);

  const p = safeParse(donations_search, search(x.url));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const { limit = 10, ...q } = p.output;
  const page = await npo_donations(id, { ...q, limit });

  return page;
};

export const action = endowUpdate({ redirect: "." });
