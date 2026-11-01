import { href } from "react-router";
import { safeParse } from "valibot";
import { report_error } from "#/errors/report";
import { moved } from "#/helpers/moved";
import { program_href } from "#/helpers/org-href";
import { npo_id } from "#/pages/marketplace/npo-id";
import { resp } from "@/helpers/https";
import { program_id } from "@/npo/schema";
import { campaign_live_for_program } from "$/pg/queries/campaign";
import { program_donor_count } from "$/pg/queries/donor";
import { npo_by_slug, npo_get } from "$/pg/queries/npo";
import { npo_program_get } from "$/pg/queries/program";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const loader = async ({ params, url }: Route.LoaderArgs) => {
  const p = safeParse(program_id, params.program_id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const pid = p.output;
  const id = npo_id(params.org);

  const npo = await (typeof id === "number" ? npo_get(id) : npo_by_slug(id));
  if (!npo || npo.active === false) throw resp.status(404);
  // a published org with a slug lives at it; its id url is an alias. an
  // unpublished org's slug stays out of this public, cached redirect
  if (typeof id === "number" && npo.slug && npo.published) {
    throw moved(`${program_href(npo, pid)}${url.search}`);
  }

  const prog = await npo_program_get(pid, npo.id);
  if (!prog) throw resp.status(404);

  // the aside count and the campaigns are garnish: the page serves without them
  const or_fallback = <T, F>(read: Promise<T>, fallback: F): Promise<T | F> =>
    read.catch((err) => {
      report_error(err, { endow_id: npo.id });
      return fallback;
    });

  const [donors, campaigns] = await Promise.all([
    or_fallback(program_donor_count(prog.id), null),
    or_fallback(
      campaign_live_for_program(prog.id).then((rows) =>
        // a campaign page lives under its org's slug
        rows.flatMap((c) =>
          c.owner_slug
            ? [
                {
                  id: c.id,
                  name: c.name,
                  to: href("/org/:org/:campaign", {
                    org: c.owner_slug,
                    campaign: c.slug,
                  }),
                  image: c.hero ?? null,
                  raised: c.raised,
                  target: c.target,
                },
              ]
            : []
        )
      ),
      []
    ),
  ]);

  return {
    npo: {
      id: npo.id,
      slug: npo.slug,
      name: npo.name,
      logo: npo.logo,
      social_media_urls: npo.social_media_urls,
    },
    prog,
    url: new URL(program_href(npo, pid), url).toString(),
    donors,
    campaigns,
  };
};
