import * as v from "valibot";
import { safeParse } from "valibot";
import { admin_ctx } from "#/.server/auth";
import { resp, search } from "@/helpers/https";
import { npo_donor_list, npo_donor_summary } from "$/pg/queries/donor";
import type { Route } from "./+types/route";

const sort_schema = v.optional(v.picklist(["name", "count", "total"]), "total");
const dir_schema = v.optional(v.picklist(["asc", "desc"]), "desc");

const donors_search = v.object({
  next: v.optional(v.string()),
  sort: sort_schema,
  dir: dir_schema,
  limit: v.optional(v.pipe(v.string(), v.transform(Number)), "20"),
});

export const loader = async (x: Route.LoaderArgs) => {
  const npo_id = x.context.get(admin_ctx);

  const p = safeParse(donors_search, search(x.url));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const { limit, sort, dir, next } = p.output;

  const [page, summary] = await Promise.all([
    npo_donor_list(npo_id, { limit, sort, dir, next }),
    npo_donor_summary(npo_id),
  ]);

  return { page, summary, sort, dir };
};
