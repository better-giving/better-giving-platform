import { moved } from "#/helpers/moved";
import { org_href } from "#/helpers/org-href";
import { npo_id } from "#/pages/marketplace/npo-id";
import { npo_by_slug, npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";

/** the profile moved to /org/<slug|id>; old links and indexed urls follow */
export const loader = async ({ params, url }: Route.LoaderArgs) => {
  const id = npo_id(params.id);
  const { search } = url;
  // looked up, not forwarded: a 301 to a 404 is cached as permanent
  const npo = await (typeof id === "number" ? npo_get(id) : npo_by_slug(id));
  // public and cached a day: an unpublished org's slug stays unnamed (its admins use /org/<id>)
  if (!npo || npo.active === false || !npo.published) {
    throw new Response(null, { status: 404 });
  }
  return moved(`${org_href(npo)}${search}`);
};
