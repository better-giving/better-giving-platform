import type { LoaderFunction } from "react-router";
import * as v from "valibot";
import { can_preview } from "#/.server/can-preview";
import { npo_donors } from "#/.server/npo-donors";
import { fund_id } from "@/campaign/schema";
import { resp, search } from "@/helpers/https";
import { $int_gte1 } from "@/schemas";
import { npo_get } from "$/pg/queries/npo";

const schema = v.union([fund_id, $int_gte1]);

const cache = "public, s-maxage=60, stale-while-revalidate=300";

export const loader: LoaderFunction = async ({ params, request }) => {
  const p = v.safeParse(schema, params.id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;
  const q = new URL(request.url).searchParams;
  const campaign_id = q.get("campaign_id") || undefined;

  // an unpublished org's feed follows its pages: it shows, whole or a single
  // campaign's, only to its own admins and to platform admins
  let preview = false;
  if (typeof id === "number") {
    const npo = await npo_get(id);
    if (!npo || npo.active === false) throw resp.status(404);
    if (!npo.published) {
      // a preview denial depends on who asked, so its 404 stays out of shared
      // caches — otherwise a cached denial could outlast the viewer's sign-in
      if (!(await can_preview(request, npo.id)))
        throw new Response(null, {
          status: 404,
          headers: { "cache-control": "private, no-store" },
        });
      preview = true;
    }
  }

  const { next } = search(request);
  const with_message = q.get("with_message") === "1";

  const page = await npo_donors(id.toString(), next, campaign_id, with_message);
  return resp.json(page, 200, {
    "cache-control": preview ? "private, no-store" : cache,
  });
};
