import type { LinksFunction } from "react-router";
import donation_form from "#/assets/images/donation-form.png";
import { app_name, base_url } from "#/constants/env";
import { socials } from "#/constants/urls";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import { FAQ } from "#/pages/@sections/faq";
import { PartnersStrip } from "#/pages/@sections/partners/strip";
import type { Route } from "./+types/route";
import { home_faqs } from "./faqs";
import { GrowFunds } from "./grow-funds";
import { Hero } from "./hero";
import { OpenSource } from "./open-source";
import { OwnGrow } from "./own-grow";
import { Pillars } from "./pillars";
import { Steps } from "./steps";
import { Testimonials } from "./testimonials";

export { headers, loader } from "./api";

const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: app_name,
  url: base_url,
  logo: `${base_url}/logo.png`,
  sameAs: [
    socials.linkedin,
    socials.facebook,
    socials.x,
    socials.youtube,
    socials.instagram,
  ],
};

const website = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: app_name,
  url: base_url,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${base_url}/marketplace?query={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

const faq_page = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: home_faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export const meta: Route.MetaFunction = () =>
  metas({
    description: `Raise more this quarter and grow funds together. ${app_name} offers donation forms, savings, and fund growth tools. No platform fee while the optional donor contribution stays on.`,
    jsonld: [organization, website, faq_page],
  });

export const links: LinksFunction = () => [
  { rel: "preload", href: donation_form, as: "image", fetchPriority: "high" },
];

export default function Page() {
  return (
    <main>
      <Hero />
      <PartnersStrip classes="border-y border-t-hairline border-b-secondary" />
      <Steps classes="py-24" />
      <OwnGrow classes="bg-band py-24" />
      <Pillars classes="py-24" />
      <GrowFunds classes="bg-band py-24" />
      <OpenSource classes="surface-primary py-24" />
      <Testimonials classes="py-24" />
      <div className="bg-band py-24">
        <div className="page">
          <FAQ items={home_faqs} classes="max-w-3xl mx-auto" />
        </div>
      </div>
      <CtaBand
        title="Join the managed platform."
        subtitle="No platform fee while the optional donor contribution stays on. Turning that ask off is a 1.5% fee."
      />
    </main>
  );
}
