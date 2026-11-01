import { moved } from "#/helpers/moved";
import { program_href } from "#/helpers/org-href";
import { npo_id } from "#/pages/marketplace/npo-id";
import { npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";

/** the program page moved under the profile at /org/<slug|id> */
export const loader = async ({ params, url }: Route.LoaderArgs) => {
  const id = npo_id(params.id);
  const { search } = url;
  const org =
    typeof id === "number" ? await npo_get(id) : { id, slug: id as string };
  if (!org) throw new Response(null, { status: 404 });
  // an unpublished org's slug stays out of this public, cached redirect
  const to = "published" in org && !org.published ? { id: org.id } : org;
  return moved(`${program_href(to, params.program_id)}${search}`);
};
