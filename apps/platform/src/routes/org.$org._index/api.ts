import { data, href } from "react-router";
import { can_preview } from "#/.server/can-preview";
import { get_funds_npo_memberof } from "#/.server/funds";
import { to_excerpt, to_text } from "#/components/rich-text/helpers";
import { report_error } from "#/errors/report";
import { moved } from "#/helpers/moved";
import { org_href } from "#/helpers/org-href";
import { npo_id } from "#/pages/marketplace/npo-id";
import type { IOrgShape } from "@/org-shape";
import { pick_layout } from "$/org-layout";
import {
  campaign_donor_counts,
  campaign_live_for_npo,
} from "$/pg/queries/campaign";
import { donation_message_list } from "$/pg/queries/donation-message";
import {
  npo_by_slug,
  npo_donor_count,
  npo_get,
  npo_public,
} from "$/pg/queries/npo";
import { npo_media_list } from "$/pg/queries/npo-media";
import { npo_programs } from "$/pg/queries/program";
import type { Route } from "./+types/route";
import { layout_lists, shape_counts } from "./layout-data";

/** the cdn keys on the url alone, so a response that depends on who asked
 * stays out of shared caches */
const PRIVATE = { "cache-control": "private, no-store" };

export const headers: Route.HeadersFunction = ({
  loaderHeaders,
  errorHeaders,
}) => ({
  "cache-control":
    (errorHeaders ?? loaderHeaders).get("cache-control") ??
    "public, s-maxage=60, stale-while-revalidate=300",
});

/** the profile shows up to this many featured videos */
export const MAX_VIDEOS = 4;

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const id = npo_id(params.org);
  const npo = await (typeof id === "number" ? npo_get(id) : npo_by_slug(id));
  if (!npo || npo.active === false) throw new Response(null, { status: 404 });
  // the session is read only here, so a published profile stays anonymous
  if (!npo.published && !(await can_preview(request, npo.id))) {
    throw new Response(null, { status: 404, headers: PRIVATE });
  }
  // an org with a slug lives at it; its id url, and its slug in any other
  // case (npo_by_slug matches case-insensitively), are aliases. an unpublished
  // org renders in place: the 301 is publicly cached, and would name its slug
  if (
    npo.published &&
    npo.slug &&
    (typeof id === "number" || id !== npo.slug)
  ) {
    throw moved(`${org_href(npo)}${new URL(request.url).search}`);
  }

  // each read fails soft (settled below, flagged in `lists.failed`), so nothing else reports it
  const reported = <T>(deferred: Promise<T>) =>
    deferred.catch((err) => {
      report_error(err, { endow_id: npo.id });
      throw err;
    });

  // a count is garnish: the profile serves without it
  const count_or_null = <T>(count: Promise<T>) =>
    count.catch((err) => {
      report_error(err, { endow_id: npo.id });
      return null;
    });

  const funds = reported(get_funds_npo_memberof(npo.id, { published: true }));
  const media = reported(
    npo_media_list(npo.id, {
      type: "video",
      featured: true,
      limit: MAX_VIDEOS,
    }).then((x) => x.items)
  );
  const programs = reported(npo_programs(npo.id));

  const [
    campaigns,
    donors,
    { messages, messages_next },
    [funds_read, media_read, programs_read],
  ] = await Promise.all([
    campaign_live_for_npo(npo.id).then(async (rows) => {
      const supporters = await count_or_null(
        campaign_donor_counts(rows.map((c) => c.id))
      );
      return rows.map((c) => {
        // a campaign page lives under its owner's slug, else its owner's id
        const to = href("/org/:org/:campaign", {
          org: c.owner_slug ?? String(c.owner_npo_id),
          campaign: c.slug,
        });
        const official = c.owner_npo_id === npo.id;
        return {
          id: c.id,
          name: c.name,
          to,
          image: c.hero ?? null,
          // its own, without the org's in its place
          banner: c.banner ?? null,
          raised: c.raised,
          target: c.target,
          official,
          // the owner's name, on a campaign this org joined but doesn't run
          with_org: official ? null : c.owner_name,
          ends_at: c.ends_at,
          mark: c.mark,
          excerpt: to_excerpt(c.description_pt),
          supporters: supporters?.get(c.id) ?? null,
          // the campaign page carries the donation form
          donate_to: to,
        };
      });
    }),
    count_or_null(npo_donor_count(npo.id)),
    donation_message_list(String(npo.id), { limit: 10, with_message: true })
      .then((page) => ({
        messages: page.items
          .filter((m) => m.donor_message?.trim())
          .map((m) => ({
            id: m.id,
            name: m.donor_name || "Donor",
            message: m.donor_message as string,
          })),
        // a cursor into the messages-only feed: resume it with /api/npo/:id/donors?with_message=1&next=
        messages_next: page.next ?? null,
      }))
      .catch((err) => {
        report_error(err, { endow_id: npo.id });
        return { messages: [], messages_next: null };
      }),
    // the layout needs the lists' counts; a rejected read flags its section as failed
    Promise.allSettled([funds, media, programs]),
  ]);

  const now = new Date();
  const lists = layout_lists({
    npo,
    campaigns,
    funds: funds_read,
    programs: programs_read,
    media: media_read,
    now,
  });
  const shape: IOrgShape = {
    story_chars: to_text(npo.overview_pt).trim().length,
    tagline_chars: npo.tagline?.trim().length ?? 0,
    name_chars: npo.name.trim().length,
    has_banner: !!npo.image,
    has_logo: !!npo.logo,
    ...shape_counts(lists),
  };
  const { layout, by } = await pick_layout(shape);

  return data(
    {
      npo: npo_public(npo),
      url: new URL(org_href(npo), request.url).toString(),
      donors,
      messages,
      messages_next,
      campaigns,
      layout,
      layout_by: by,
      shape,
      lists,
      // epoch ms, so the server render and hydration count from one instant
      now: now.getTime(),

      // settled by now; still sent as promises for a client built before `lists`, whose page awaits them
      funds,
      media,
      programs,
    },
    npo.published ? undefined : { headers: PRIVATE }
  );
};
