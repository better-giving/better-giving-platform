import { ExtLink, Info } from "@better-giving/ui";
import { href, Link } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import flying_character from "#/assets/images/flying-character.webp";
import { Steps } from "#/components/donation";
import { DappLogo } from "#/components/image";
import { app_name, base_url } from "#/constants/env";
import { INTERCOM_HELP, PRIVACY_POLICY } from "#/constants/urls";
import { metas } from "#/helpers/seo";
import { use_now } from "#/hooks/use-now";
import { fund_closes_at, fund_is_open } from "@/campaign/is-open";
import type { Route } from "./+types/route";
import FAQ from "./faq";
import { FundCard } from "./fund-card";

export { loader } from "./api";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();
export const meta: Route.MetaFunction = ({ loaderData: d, location: l }) => {
  return metas({
    title: `Donate to ${d.fund.name} - ${app_name}`,
    url: `${base_url}${l.pathname}`,
  });
};

export default CacheRoute(Page);
function Page({
  loaderData: { fund, now: loader_now, user, base_url },
}: Route.ComponentProps) {
  const now = use_now(
    loader_now,
    fund.expiration ? fund_closes_at(fund.expiration) : undefined
  );
  const is_open = fund_is_open(fund, now);
  return (
    <div className="w-full">
      <div className="bg-panel h-14.75 w-full flex items-center justify-between px-10 mb-4">
        <DappLogo classes="h-12" />
        <Link
          to={href("/fundraisers/:fund_id", { fund_id: fund.id })}
          className="font-semibold link"
        >
          Cancel
        </Link>
      </div>
      <div className="md:px-4 max-w-274.5 mx-auto grid md:grid-cols-[1fr_auto] items-start content-start gap-4">
        <div className="@container/fund-card col-start-1 row-start-1">
          <FundCard
            id={fund.id}
            progress={fund.donation_total_usd}
            name={fund.name}
            tagline={fund.description_pt}
            logo={fund.logo || flying_character}
            classes="col-start-1 row-start-1"
            target={fund.target ?? "0"}
          />
        </div>
        {/** small screen but space is still enough to render sidebar */}
        <div className="mx-0 border-b md:contents xs:border xs:mx-4 rounded">
          {!is_open ? (
            <Info classes="row-start-2 self-center bg-panel rounded h-80 content-center justify-items-center grid">
              This campaign is already closed and can't accept any more
              donations
            </Info>
          ) : (
            <Steps
              source="bg-marketplace"
              mode="live"
              base_url={base_url}
              recipient={{
                id: fund.id,
                name: fund.name,
                hide_bg_tip: fund.hide_bg_tip,
                members: fund.members.map((x) => x.id.toString()),
                donor_address_required: false,
              }}
              config={{
                id: null,
                success_redirect: undefined,
                freq_opts: undefined,
                method_ids: fund.fund_donate_methods ?? undefined,
                increments: fund.increments ?? undefined,
              }}
              program={undefined}
              user={user}
              classes="md:border rounded row-start-2"
            />
          )}
        </div>
        <FAQ
          classes="max-md:px-4 md:col-start-2 md:row-span-5 md:w-75.5"
          //TODO: endowId={1}
          endowId={1}
        />
        <p className="max-md:px-4 mb-4 max-md:col-start-1 text-sm leading-normal text-left text-gray-11">
          <span className="block mb-0.5">
            Need help? See{" "}
            <Link to="./#faqs" className="link font-medium">
              FAQs
            </Link>{" "}
            or contact us at our <A href={INTERCOM_HELP}>Help Center</A>.
          </span>
          <span className="block mb-0.5">
            Have ideas for how we can build a better donation experience?{" "}
            <A href={INTERCOM_HELP}>Send us feedback</A>.
          </span>
          <span className="block">
            We respect your privacy. To learn more, check out our{" "}
            <A href={PRIVACY_POLICY}>Privacy Policy</A>.
          </span>
        </p>
      </div>
    </div>
  );
}

const A: typeof ExtLink = ({ className, ...props }) => {
  return <ExtLink {...props} className={`${className} font-medium link`} />;
};
