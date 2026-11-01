import * as v from "valibot";
import { api_error } from "@/helpers/api-error";
import { resp } from "@/helpers/https";
import { ein_ref } from "@/npo/schema";
import { npo_by_regnum } from "$/pg/queries/npo";
import { public_api_route, read_only } from "$/public-api";
import type { Route } from "./+types/api.npos.ein.$id";

const cache = "public, s-maxage=60, stale-while-revalidate=300";

export const loader = public_api_route(async ({ params }: Route.LoaderArgs) => {
  const p = v.safeParse(ein_ref, params.id);
  if (p.issues) return api_error("invalid_request", p.issues[0].message);
  const id = p.output;
  const res = await npo_by_regnum(id);
  if (!res) return api_error("not_found", "No nonprofit has this EIN.");
  return resp.json(res, 200, { "cache-control": cache });
});

export const action = read_only;
