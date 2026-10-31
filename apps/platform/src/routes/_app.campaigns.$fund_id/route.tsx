import { Image, Target, to_target } from "@better-giving/ui";
import { unpack } from "@better-giving/ui/helpers";
import { ArrowLeft } from "lucide-react";
import { href, Link, NavLink } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import flying_character from "#/assets/images/flying-character.webp";
import { FundCreator, FundStatus, status_fn } from "#/components/campaign";
import { DonorMsgs } from "#/components/donor-msgs";
import {
  RichText,
  richtext_styles,
  to_excerpt,
  to_text,
} from "#/components/rich-text";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { use_now } from "#/hooks/use-now";
import { goal_amount } from "#/routes/org.$org.$campaign/format";
import type { IFund } from "#/types/fund";
import { fund_closes_at } from "@/campaign/is-open";
import { MAX_EXPIRATION_ISO } from "@/campaign/schema";
import { agents_link, fund_jsonld } from "@/structured-data/schema-org";
import type { Route } from "./+types/route";
import { Share } from "./share";
import { Video } from "./video";

export { headers, loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const links: Route.LinksFunction = () => [...richtext_styles];

export const meta: Route.MetaFunction = ({ loaderData: d, location: l }) => {
  if (!d) return [];
  const url = `${base_url}${l.pathname}`;
  const shared = {
    title: `${d.name} - ${app_name}`,
    description: to_text(d.description_pt).slice(0, 140),
    name: d.name,
    image: d.banner || flying_character,
    url,
  };
  // a hidden or deactivated fund stays out of every index
  if (!(d.published && d.active)) return metas(shared);
  const goal = goal_amount(d.target, d.donation_total_usd);
  const project = fund_jsonld({
    base_url,
    url,
    donate_url: `${base_url}${href("/campaigns/:fund_id/donate", { fund_id: d.id })}`,
    // an expired fund keeps its description but loses its DonateAction, as
    // `Fund` shows it closed
    closed: !fund_status(d, new Date(d.now)).active,
    name: d.name,
    description: to_excerpt(d.description_pt),
    image: d.banner,
    // the page shows the raised figure only inside `<Target>`, which needs a goal
    raised: goal == null ? undefined : d.donation_total_usd,
    goal,
    members: d.members,
  });
  return [...metas({ ...shared, jsonld: project }), agents_link(base_url)];
};
export { ErrorBoundary } from "#/components/error";
export default CacheRoute(Fund);

const fund_status = (fund: IFund, now: Date) =>
  status_fn(
    fund.expiration ?? MAX_EXPIRATION_ISO,
    fund.active,
    fund.donation_total_usd,
    now
  );

function Fund({ loaderData }: Route.ComponentProps) {
  const { url, now: loader_now, ...fund } = loaderData;
  const now = use_now(
    loader_now,
    fund.expiration ? fund_closes_at(fund.expiration) : undefined
  );

  const status = fund_status(fund, now);

  return (
    <section className="grid pb-10 bg-gray-3">
      <div className="group relative page grid md:grid-cols-[3fr_2fr] gap-4">
        <div className="self-start mt-14 z-10 grid gap-4 relative">
          <div className="absolute -top-8 flex items-center justify-between w-full">
            <Link
              className="flex items-center gap-x-1 active:-translate-x-1"
              to="../campaigns"
            >
              <ArrowLeft className="icon-md" />
              <span>Campaigns</span>
            </Link>
            <FundStatus
              status={status}
              classes={{
                container: "text-xs",
                active: "",
                inactive: "text-destructive-subtle-fg",
                completed: "text-success-subtle-fg",
                expired: "text-gray-11",
              }}
            />
          </div>

          <div className="card">
            <div className="grid max-md:gap-y-4 items-center max-md:justify-items-center md:grid-cols-[auto_1fr]">
              <div className="mr-4 md:row-span-2">
                <Image
                  src={fund.logo || flying_character}
                  width={60}
                  className="rounded-full object-cover bg-panel"
                />
              </div>

              <h4 className="md:col-start-2 max-md:text-center  font-bold text-2xl w-full wrap-break-word">
                {fund.name}
              </h4>
              <div className="pl-0.5">
                <span className="text-sm font-medium text-gray-11 mr-1">
                  by
                </span>
                <FundCreator
                  name={fund.creator_name}
                  id={fund.creator_id}
                  classes="font-medium inline"
                />
              </div>
              <DonateSection
                {...fund}
                open={status.active}
                classes={{
                  container: "col-span-full md:hidden",
                  target: "mt-8",
                }}
              />
            </div>
          </div>

          <div className="bg-card rounded-card overflow-hidden">
            {fund.banner && (
              <img
                src={fund.banner}
                className="w-full object-cover object-center max-sm:h-40"
                alt={`${fund.name} banner`}
              />
            )}
            <RichText
              content={{
                value: fund.description_pt,
              }}
              classes={{
                field: "",
                container: "p-4",
              }}
              readOnly
            />
          </div>

          {fund.videos.map((v, idx) => (
            <div key={idx} className="rounded">
              <Video url={v} />
            </div>
          ))}

          <DonorMsgs id={fund.id} classes="mt-4" />
        </div>
        <div
          id="info-card"
          className="md:sticky md:top-30 card self-start flex flex-col content-start z-10"
        >
          {" "}
          <DonateSection
            {...fund}
            open={status.active}
            classes={{ container: "max-md:hidden", link: "mb-4 order-first" }}
          />
          <p className="text-gray-11 md:mt-8 mb-2 font-bold uppercase text-xs">
            Donations go to
          </p>
          <div className="grid gap-y-4 mb-4 grid-cols-[auto_1fr]">
            {fund.members.map((m) => (
              <div
                key={m.id}
                className="grid items-center gap-x-2 grid-cols-subgrid col-span-2"
              >
                <Image src={m.logo} className="aspect-2/1 rounded" width={50} />
                <Link
                  to={href("/org/:org", { org: m.id.toString() })}
                  className="font-bold link"
                >
                  {m.name}
                </Link>
              </div>
            ))}
          </div>
          <Share recipientName={fund.name} url={url} classes="mt-auto" />
        </div>
      </div>
    </section>
  );
}

interface Classes {
  container?: string;
  link?: string;
  target?: string;
}
interface IDonateSection extends IFund {
  open: boolean;
  classes?: Classes | string;
}
function DonateSection(props: IDonateSection) {
  const s = unpack(props.classes);
  return (
    <>
      {props.target && (
        <Target
          text={<Target.Text classes="mb-2" />}
          progress={props.donation_total_usd}
          target={to_target(props.target)}
          classes={`${s.target} ${s.container} w-full`}
        />
      )}
      <NavLink
        aria-disabled={!props.open}
        to={href("/donate-fund/:fund_id", { fund_id: props.id })}
        className={`w-full btn btn-primary ${s.link} ${s.container}`}
      >
        Donate now
      </NavLink>
    </>
  );
}
