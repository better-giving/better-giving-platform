import { to_usd } from "@better-giving/ui/helpers";
import { useState } from "react";
import {
  isRouteErrorResponse,
  Link,
  type LinksFunction,
  useRouteError,
} from "react-router";
import { Steps } from "#/components/donation";
import { ErrorElement } from "#/components/error/error-element";
import { DappLogo } from "#/components/image";
import { richtext_styles } from "#/components/rich-text";
import { to_excerpt, to_text } from "#/components/rich-text/helpers";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { use_now } from "#/hooks/use-now";
import { agents_link, campaign_jsonld } from "@/structured-data/schema-org";
import type { Route } from "./+types/route";
import { headers, loader } from "./api";
import {
  closed_body,
  donor_label,
  ended_label,
  goal_amount,
  legal_line,
  shown_end,
  shown_totals,
  tag_label,
  time_left,
  website_link,
} from "./format";
import { CampaignPage } from "./page";

export { headers, loader };
export const links: LinksFunction = () => [...richtext_styles];

export const meta: Route.MetaFunction = ({ loaderData, params, error }) => {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return metas({
      title: `Campaign not found - ${app_name}`,
      description:
        "The link may be mistyped, or the campaign isn't public yet.",
      url: `/org/${params.org}/${params.campaign}`,
    });
  }
  if (!loaderData) return [];
  const { campaign, canonical, npo } = loaderData;
  const story = to_text(campaign.description_pt);
  const shared = {
    title: `${campaign.name} - ${app_name}`,
    description: story.slice(0, 140),
    name: campaign.name,
    image: campaign.hero,
    url: canonical ?? `/org/${params.org}/${params.campaign}`,
  };
  // a preview of an unpublished owner stays out of every index
  if (campaign.owner_published === false) return metas(shared);
  const project = campaign_jsonld({
    base_url,
    url: canonical,
    name: campaign.name,
    description: to_excerpt(campaign.description_pt),
    image: campaign.hero,
    raised: campaign.raised,
    goal: goal_amount(campaign.target, campaign.raised),
    org: {
      url: `${base_url}/org/${params.org}`,
      name: campaign.owner_name,
      // the org's own logo: `mark` prefers the campaign's
      logo: campaign.owner_logo,
      ein: npo.ein,
      registration_number: npo.registration_number,
      country: npo.hq_country,
      website: npo.url,
    },
  });
  return [...metas({ ...shared, jsonld: project }), agents_link(base_url)];
};

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return <ErrorElement />;
}

function NotFound() {
  return (
    <div className="min-h-screen bg-background text-gray-12">
      <div className="mx-auto w-full max-w-[80rem]">
        <div className="page flex flex-col" data-group="page">
          <div
            className="w-full pt-20 pb-2 text-center"
            data-group="error"
            data-section="error"
            data-shell=""
            data-block="error"
          >
            <h1 className="mb-3 text-xl font-bold" data-heading="">
              Campaign not found
            </h1>
            <p className="mx-auto mb-4 max-w-md text-gray-11">
              The link may be mistyped, or the campaign isn't public yet.
            </p>
            <Link to="/marketplace" className="btn btn-secondary mx-auto w-fit">
              Browse nonprofits
            </Link>
          </div>
          <Footer />
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer
      className="mt-10 flex w-full items-center gap-3 border-t py-6 lg:mt-16"
      data-group="footer"
      data-section="footer"
      data-shell=""
      data-block="footer"
    >
      <DappLogo classes="h-8" />
      <span className="text-sm font-semibold">Better Giving</span>
    </footer>
  );
}

export default function Page({ loaderData, params }: Route.ComponentProps) {
  const {
    campaign,
    npo,
    now: loader_now,
    base_url,
    canonical,
    user,
    donor_count,
  } = loaderData;
  const until = campaign.ends_at ? new Date(campaign.ends_at) : undefined;
  const now = use_now(loader_now, until);
  const open =
    campaign.status === "live" &&
    !(
      campaign.ends_at && new Date(campaign.ends_at).getTime() <= now.getTime()
    );
  const goal = goal_amount(campaign.target, campaign.raised);
  const tag = tag_label(campaign.campaign_type);
  const closed_at = open ? null : shown_end(campaign.ends_at, now);
  const when = open
    ? campaign.ends_at
      ? time_left(campaign.ends_at, now)
      : null
    : ended_label(closed_at);
  const org = `/org/${params.org}`;
  const legal = legal_line(npo.ein);
  const website = website_link(npo.url);
  const [pay_busy, set_pay_busy] = useState(false);
  const thanks = loaderData.thanks_amount
    ? {
        amount: loaderData.thanks_amount,
        name: loaderData.thanks_name ?? "You",
      }
    : null;
  const totals = shown_totals({
    raised: campaign.raised,
    donors: donor_count,
    open,
    thanks_usd: loaderData.thanks_usd,
    thanks_present: thanks != null,
    already_settled: loaderData.thanks_settled,
    repeat_donor: loaderData.thanks_repeat,
  });
  const raised_line =
    goal == null
      ? `${to_usd(totals.raised)} raised`
      : `${to_usd(totals.raised)} raised of ${to_usd(goal)} goal`;
  const donor_line = when
    ? `${donor_label(totals.donors)} · ${when}`
    : donor_label(totals.donors);

  return (
    <CampaignPage
      title={campaign.name}
      org_name={campaign.owner_name}
      org_href={org}
      logo={campaign.mark || null}
      {...(legal ? { legal } : {})}
      {...(website ? { website } : {})}
      tag={tag}
      program_name={campaign.program_name || null}
      hero={campaign.hero || null}
      hero_alt={campaign.name}
      story={{ value: campaign.description_pt }}
      videos={campaign.videos.map((url) => ({ url }))}
      raised_line={raised_line}
      bar={goal == null ? null : { raised: totals.raised, goal }}
      donor_line={donor_line}
      no_gifts={totals.no_gifts}
      open={open}
      ended_body={open ? null : closed_body(closed_at)}
      gift_failed={loaderData.gift_failed}
      pay_busy={pay_busy}
      {...(thanks
        ? {
            thanks: {
              amount: thanks.amount,
              ...(loaderData.thanks_receipt
                ? { receipt: loaderData.thanks_receipt }
                : {}),
            },
            highlight: thanks,
          }
        : {})}
      donors={{
        id: String(campaign.owner_npo_id),
        campaign_id: campaign.id,
      }}
      form={
        open ? (
          <Steps
            source="bg-marketplace"
            mode="live"
            base_url={base_url}
            recipient={{
              id: String(npo.id),
              name: npo.name,
              hide_bg_tip: npo.hide_bg_tip,
              members: [String(npo.id)],
              donor_address_required: npo.donor_address_required,
            }}
            config={{
              id: null,
              success_redirect: canonical,
              freq_opts: campaign.donate_frequencies ?? undefined,
              method_ids: campaign.donate_methods ?? undefined,
              increments: campaign.increments ?? undefined,
              campaign_id: campaign.id,
              campaign_url: canonical,
              campaign_name: campaign.name,
              prefill_amount_usd: loaderData.prefill_amount_usd,
              prefill_frequency: loaderData.prefill_frequency,
            }}
            program={
              campaign.program_id
                ? {
                    id: campaign.program_id,
                    name: campaign.program_name ?? "",
                  }
                : undefined
            }
            user={user}
            wallets_below
            pin
            on_pay_busy={set_pay_busy}
          />
        ) : null
      }
      initial_dialog_open={
        open &&
        Boolean(loaderData.prefill_amount_usd) &&
        campaign.campaign_type !== "monthly"
      }
      share={{ recipientName: campaign.name, url: canonical }}
    />
  );
}
