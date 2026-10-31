import { ExtLink } from "@better-giving/ui";
import { href, Link } from "react-router";
import { CacheRoute, createClientLoaderCache } from "remix-client-cache";
import flying_character from "#/assets/images/flying-character.webp";
import { Steps } from "#/components/donation";
import { DappLogo } from "#/components/image";
import { app_name, base_url } from "#/constants/env";
import { INTERCOM_HELP, PRIVACY_POLICY } from "#/constants/urls";
import { metas } from "#/helpers/seo";
import type { DonateMethodId, TFrequency } from "@/schemas";
import type { Route } from "./+types/route";
import { FAQ } from "./faq";
import { OrgCard } from "./org-card";

export { loader } from "#/api/donate-loader";
export const clientLoader = createClientLoaderCache<Route.ClientLoaderArgs>();

export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [];
  const { endow } = d;
  return metas({
    title: `Donate to ${endow.name} - ${app_name}`,
    description: endow.tagline?.slice(0, 140),
    name: endow.name,
    image: endow.logo,
    url: `${base_url}/donate/${d.arrived || endow.id}`,
  });
};
export default CacheRoute(Page);
function Page({ loaderData }: Route.ComponentProps) {
  const { endow, program, user, base_url } = loaderData;
  return (
    <div className="w-full">
      <div className="bg-card h-14.75 w-full flex items-center justify-between px-10 mb-4">
        <DappLogo classes="h-12" />
        <Link
          to={href("/org/:org", { org: endow.id.toString() })}
          className="font-semibold link"
        >
          Cancel
        </Link>
      </div>
      <div className="md:px-4 max-w-274.5 mx-auto grid md:grid-cols-[1fr_auto] items-start content-start gap-4">
        <div className="@container/org-card col-start-1 row-start-1">
          <OrgCard
            id={endow.id}
            name={endow.name}
            tagline={endow.tagline ?? undefined}
            logo={endow.logo || flying_character}
            classes=""
            program={program}
          />
        </div>

        {/** small screen but space is still enough to render sidebar */}
        <div className="mx-0 md:contents xs:mx-4">
          <Steps
            base_url={base_url}
            source="bg-marketplace"
            mode="live"
            recipient={{
              id: endow.id.toString(),
              name: endow.name,
              hide_bg_tip: endow.hide_bg_tip,
              members: [],
              donor_address_required: endow.donor_address_required,
            }}
            config={{
              id: null,
              method_ids: (endow.donate_methods ?? undefined) as
                | DonateMethodId[]
                | undefined,
              increments: endow.increments ?? undefined,
              success_redirect: undefined,
              freq_opts: (endow.donate_frequencies ?? undefined) as
                | TFrequency[]
                | undefined,
            }}
            program={
              program ? { id: program.id, name: program.title } : undefined
            }
            user={user}
            classes="rounded-card shadow-card row-start-2"
          />
        </div>
        <FAQ classes="max-md:px-4 md:col-start-2 md:row-span-5 md:w-75.5" />
        <p className="max-md:px-4 mb-4 max-mbcol-start-1 text-sm leading-normal text-left text-gray-11">
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
