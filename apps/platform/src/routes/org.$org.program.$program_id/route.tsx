import { Image } from "@better-giving/ui";
import { to_usd } from "@better-giving/ui/helpers";
import { ArrowLeft } from "lucide-react";
import { href, Link } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import { OrgFooterMinimal } from "#/components/org-page/footer";
import { GoalBar } from "#/components/org-page/goal-bar";
import { OrgHeader } from "#/components/org-page/header";
import { RichText, richtext_styles, to_text } from "#/components/rich-text";
import { app_name } from "#/constants/env";
import { org_href } from "#/helpers/org-href";
import { metas } from "#/helpers/seo";
import {
  donor_label,
  goal_amount,
  percent_label,
} from "#/routes/org.$org.$campaign/format";
import type { Route } from "./+types/route";
import { Milestones } from "./milestones";

export { ErrorBoundary } from "#/components/error";
export { headers, loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const links: Route.LinksFunction = () => [...richtext_styles];
export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [];
  return metas({
    title: `${d.prog.title} - ${d.npo.name} - ${app_name}`,
    description: to_text(d.prog.description_pt).slice(0, 140),
    name: d.prog.title,
    image: d.prog.banner ?? undefined,
    url: d.url,
  });
};

type TCampaign = Route.ComponentProps["loaderData"]["campaigns"][number];

const h2 = "text-xl font-bold";

export default CacheRoute(Page);
function Page({ loaderData: d }: Route.ComponentProps) {
  const { npo, prog } = d;
  const donate_to = `${href("/donate/:id", { id: String(npo.id) })}?programId=${prog.id}`;
  const profile = org_href(npo);

  return (
    <div className="flex min-h-[100dvh] flex-col text-gray-12">
      <OrgHeader
        name={npo.name}
        logo={npo.logo}
        to={profile}
        donate_to={donate_to}
      />
      <main className="page flex flex-1 flex-col gap-6 pt-4 pb-6 lg:gap-8 lg:pt-8 lg:pb-20">
        {/* -my-3 keeps the 44px target off the rhythm: the gaps meet the text */}
        <Link
          to={profile}
          className="link -my-3 inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold"
        >
          <ArrowLeft aria-hidden className="icon-sm" />
          Back to {npo.name}
        </Link>
        <section className="flex flex-col overflow-hidden bg-card rounded-card">
          {prog.banner && (
            <Image
              src={prog.banner}
              alt=""
              className="aspect-video w-full object-cover lg:aspect-auto lg:h-80"
            />
          )}
          <div className="flex flex-col gap-4 p-6 lg:p-8">
            <p className="self-start rounded bg-secondary px-2 py-1 text-xs font-bold uppercase tracking-badge text-gray-12">
              Program
            </p>
            <h1 className="text-3xl font-bold break-words lg:text-4xl">
              {prog.title}
            </h1>
          </div>
        </section>
        {/* a phone reads the raised card before About; from lg it is the
            right column */}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:items-start lg:gap-8">
          <aside className="card flex flex-col gap-3 lg:col-start-2 lg:row-start-1">
            <Raised
              received={prog.total_donations ?? 0}
              target={prog.target_raise ?? 0}
              donors={d.donors}
            />
            <Link to={donate_to} className="btn btn-primary btn-lg mt-1">
              Donate to this program
            </Link>
          </aside>
          <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
            <section className="flex flex-col gap-4">
              <h2 className={h2}>About this program</h2>
              <RichText
                readOnly
                content={{ value: prog.description_pt }}
                classes={{
                  field: "flex w-full flex-col gap-3 text-base leading-relaxed",
                }}
              />
            </section>
            <Milestones milestones={prog.milestones} />
          </div>
        </div>
        <Campaigns campaigns={d.campaigns} />
      </main>
      <OrgFooterMinimal />
    </div>
  );
}

interface IRaised {
  received: number;
  /** 0 when the program has no target */
  target: number;
  /** null when the count is unavailable */
  donors: number | null;
}

function Raised({ received, target, donors }: IRaised) {
  return (
    <>
      <p className="text-sm">
        <strong className="text-lg">{to_usd(received)}</strong>{" "}
        {donors == null ? "raised" : `raised from ${donor_label(donors)}`}
      </p>
      {target > 0 && (
        <>
          <GoalBar raised={received} goal={target} />
          <p className="text-xs text-gray-11">
            {percent_label(received, target)} of {to_usd(target)} goal
          </p>
        </>
      )}
    </>
  );
}

interface ICampaigns {
  campaigns: TCampaign[];
}

function Campaigns({ campaigns }: ICampaigns) {
  if (campaigns.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className={h2}>Campaigns in this program</h2>
      {/* fixed tracks, so a lone card keeps one column's width */}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((c) => (
          <li key={c.id}>
            <CampaignCard {...c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** the name is the link, stretched over the card, so the card opens the
 * campaign while the link's name stays the campaign's */
function CampaignCard(c: TCampaign) {
  const goal = goal_amount(c.target, c.raised);
  return (
    <article className="relative flex h-full flex-col overflow-hidden bg-card rounded-card has-focus-visible:outline-2 has-focus-visible:outline-ring has-focus-visible:-outline-offset-2">
      {/* stacked in one grid cell, not positioned, so the card stays the
          box the link's ::after covers. grid-rows-1 makes the row the
          definite 160px, which size-full resolves against; an auto row
          grows to the photo's own height */}
      <div className="grid h-40 grid-rows-1 overflow-hidden bg-gray-3">
        {c.image && (
          <Image
            src={c.image}
            alt=""
            className="col-start-1 row-start-1 size-full object-cover"
          />
        )}
        {/* primary-deep/70 is the measured scrim for white copy over a photo */}
        <div className="col-start-1 row-start-1 flex items-center justify-center bg-primary-deep/70 p-4 text-center text-white">
          <h3 className="text-lg font-bold">
            <Link
              to={c.to}
              className="outline-0 after:absolute after:inset-0 after:content-['']"
            >
              {c.name}
            </Link>
          </h3>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {goal != null ? (
          <>
            <GoalBar raised={c.raised} goal={goal} />
            <p className="flex justify-between gap-2 text-sm">
              <strong>{to_usd(c.raised)}</strong>
              <span className="text-gray-11">of {to_usd(goal)}</span>
            </p>
          </>
        ) : (
          <p className="text-sm">
            <strong>{to_usd(c.raised)}</strong> raised
          </p>
        )}
      </div>
    </article>
  );
}
