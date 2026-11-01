import * as v from "valibot";
import { api_error } from "@/helpers/api-error";
import { resp } from "@/helpers/https";
import { $int_gte1, segment_shape } from "@/schemas";
import { npo_by_slug, npo_get, npo_public } from "$/pg/queries/npo";
import { public_api_route, read_only } from "$/public-api";
import type { Route } from "./+types/api.npos.$id";

const cache = "public, s-maxage=60, stale-while-revalidate=300";

export const loader = public_api_route(async ({ params }: Route.LoaderArgs) => {
  const p1 = v.safeParse(v.union([$int_gte1, segment_shape]), params.id);
  if (p1.issues) return api_error("invalid_request", p1.issues[0].message);
  const id = p1.output;
  const npo =
    typeof id === "number" ? await npo_get(id) : await npo_by_slug(id);
  if (!npo || npo.active === false) {
    return api_error("not_found", "No nonprofit has this id.");
  }
  return resp.json(npo_public(npo), 200, { "cache-control": cache });
});

export const action = read_only;
