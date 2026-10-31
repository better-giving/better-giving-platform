import { href, useActionData, useNavigation } from "react-router";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import { PartnersStrip } from "#/pages/@sections/partners/strip";
import type { ILeadInvalid } from "@/reg/lead";
import type { Route } from "./+types/route";
import { Credentials } from "./credentials";
import { Ethical } from "./ethical";
import { FeeGap } from "./fee-gap";
import { Hero } from "./hero";
import { HowItWorks } from "./how-it-works";
import { Paperwork } from "./paperwork";
import { Quote } from "./quote";
import { RateComparison } from "./rate-comparison";

export { action } from "./api";

/* `meta` runs in the browser: re-exporting it from `./api` would drag that
 * module's server-only reach into the client graph and the page would never
 * hydrate. these two stay here, where nothing server-only is in scope. */
export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    // explicit: `metas` defaults `url` to base_url, which would canonicalize
    // this page into the homepage
    url: `${base_url}${href("/for-international-nonprofits")}`,
    title: `For International Nonprofits | ${app_name}`,
    description: `Reach U.S. donors without your own 501(c)(3). ${app_name}'s fiscal sponsorship makes gifts tax-deductible for your U.S. supporters at 2.9%, versus the 4-10% market rate (as of 2026).`,
  });

export default function Page() {
  // success is a redirect into the wizard, so the only thing that ever comes
  // back here is a failed submit
  const result = useActionData<ILeadInvalid>();
  const nav = useNavigation();

  return (
    <main>
      <Hero
        classes="border-b border-hairline pt-9 md:pt-14 pb-9 md:pb-12"
        errors={result?.errors}
        values={result?.values}
        signed_in_as={result?.signed_in_as}
        message={result?.message}
        pending={nav.state === "submitting"}
      />
      <Credentials classes="bg-panel py-4" />
      <PartnersStrip classes="border-y border-hairline" />
      <FeeGap classes="bg-gray-3 border-b border-hairline py-10 md:py-16" />
      <RateComparison classes="border-b border-hairline py-10 md:py-16" />
      <HowItWorks classes="border-b border-hairline py-10 md:py-16" />
      <Paperwork classes="bg-gray-3 border-b border-hairline py-10 md:py-16" />
      <Ethical classes="border-b border-hairline py-10 md:py-14" />
      <Quote classes="bg-gray-3 border-b border-hairline py-10 md:py-16" />
      <CtaBand
        title="Your mission. U.S. donors. 2.9%."
        subtitle="One short application, reviewed in 3 business days, is all that stands between your organization and tax-deductible U.S. fundraising."
        cta_label="Unlock U.S. donors"
      />
    </main>
  );
}
