import { useRmxForm } from "@better-giving/ui";
import { href } from "react-router";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import { FAQ } from "#/pages/@sections/faq";
import { PartnersStrip } from "#/pages/@sections/partners/strip";
import type { ILeadInvalid } from "@/reg/lead";
import type { Route } from "./+types/route";
import { CtaForm } from "./cta-form";
import { np_faqs } from "./faqs";
import { GiftTypes } from "./gift-types";
import { Grow } from "./grow";
import { Hero } from "./hero";
import { Portability } from "./portability";
import { Proof } from "./proof";
import { TrustStrip } from "./trust-strip";

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
    url: `${base_url}${href("/for-nonprofits")}`,
    title: `For Nonprofits | ${app_name}`,
    description: `Fundraising for U.S. 501(c)(3)s. No platform fee while the optional donor contribution stays on. ${app_name} accepts cash, crypto, stock and DAF gifts, and donation records export from the dashboard.`,
  });

export default function Page() {
  const { nav, data } = useRmxForm<ILeadInvalid>();

  return (
    <main>
      <header className="border-b border-hairline py-14 md:py-16">
        <div className="page grid gap-10 lg:gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <Hero />
          <CtaForm
            classes="max-lg:mx-auto lg:justify-self-end"
            errors={data?.errors}
            values={data?.values}
            signed_in_as={data?.signed_in_as}
            message={data?.message}
            pending={nav.state === "submitting"}
          />
        </div>
      </header>

      <TrustStrip classes="border-b border-hairline py-5" />

      <PartnersStrip classes="border-b border-hairline" />

      <Proof classes="border-b border-hairline py-16 md:py-20" />

      <GiftTypes classes="bg-gray-3 border-b border-hairline py-16 md:py-20" />

      <Grow classes="border-b border-hairline py-16 md:py-20" />

      <Portability classes="border-b border-hairline py-16 md:py-20" />

      <div className="bg-gray-3 border-b border-hairline py-16 md:py-20">
        <div className="page">
          <FAQ
            items={np_faqs}
            heading="So how is it actually free?"
            sub="Skepticism is healthy. It's why our answers are verifiable, not just written here."
            classes="max-w-3xl mx-auto"
          />
        </div>
      </div>

      <CtaBand
        title="Join the platform"
        subtitle="No platform fee while the optional donor contribution stays on. Turning that ask off is a 1.5% fee."
      />
    </main>
  );
}
