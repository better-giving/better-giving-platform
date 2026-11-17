import { EMAILS } from "@better-giving/brand";
import { ArrowRight } from "lucide-react";
import { href, Link } from "react-router";
import { FaqList } from "#/components/compare/faq-list";
import { index_sources, long_date_of } from "#/components/compare/format";
import { faq_jsonld } from "#/components/compare/jsonld";
import { SourcesList } from "#/components/compare/sources-list";
import { SupRefs } from "#/components/compare/sup-refs";
import { base_url } from "#/constants/env";
import { compare_generated, compare_index } from "#/content/compare/data";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const loader = () => ({
  index: compare_index,
  verified: compare_generated,
});

export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [];
  const url = `${base_url}${href("/compare")}`;
  return metas({
    url,
    canonical: url,
    title: d.index.seo_title,
    description: d.index.meta_description,
    jsonld: faq_jsonld(d.index.faq),
  });
};

const CARD_LINK =
  "card flex items-center justify-between gap-3 hover:border-gray-8 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2";

export default function Page({
  loaderData: { index, verified },
}: Route.ComponentProps) {
  const sources = index_sources(index.includes, index.switching_steps);
  const numbers = new Map(sources.map((s, i) => [s.id, i + 1]));
  return (
    <main>
      <div className="bg-linear-to-b from-background to-band pt-12 pb-16 md:pt-16 md:pb-20">
        <div className="page grid gap-5 justify-items-start">
          <p className="eyebrow text-primary">Comparisons</p>
          <h1 className="hero-heading max-w-4xl">
            Better Giving compared with {index.cards.length} fundraising
            platforms
          </h1>
          <p className="text-lg/relaxed text-gray-11 max-w-3xl text-pretty">
            Each page sets Better Giving beside one platform or payment option,
            with fees, payouts, gift types and features drawn from that
            platform's public pages. Where the other option does something
            better, the page says so.
          </p>
        </div>
      </div>

      <section className="bg-band pb-16 md:pb-24">
        <div className="page">
          <h2 className="section-heading text-center max-w-2xl mx-auto">
            Better Giving vs other fundraising platforms
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 mt-8 md:mt-11">
            {index.cards.map((c) => (
              <li key={c.slug} className="grid">
                <Link
                  to={href("/compare/:slug", { slug: c.slug })}
                  className={CARD_LINK}
                >
                  <span className="text-xl font-bold">{c.competitor}</span>
                  <ArrowRight className="icon-xl text-primary" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="page py-16 md:py-24">
        <h2 className="section-heading text-center max-w-2xl mx-auto">
          What Better Giving includes for nonprofits
        </h2>
        <div className="grid gap-6 md:grid-cols-2 mt-8 md:mt-11 max-w-5xl mx-auto">
          {index.includes.map((it) => (
            <div key={it.h3} className="card grid gap-2.5 content-start">
              <h3 className="text-xl font-bold">{it.h3}</h3>
              <p className="text-base/relaxed text-gray-12 text-pretty">
                {it.text}
                <SupRefs ids={it.sources.map((s) => s.id)} numbers={numbers} />
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-band py-16 md:py-24">
        <div className="page">
          <h2 className="section-heading text-center max-w-2xl mx-auto">
            Switching to Better Giving in three steps
          </h2>
          <ol className="grid gap-8 md:grid-cols-3 md:gap-6 mt-8 md:mt-12 max-w-5xl mx-auto">
            {index.switching_steps.map((s, i) => (
              <li key={s.h3} className="grid gap-2.5 content-start">
                <span className="figures text-2xl font-bold text-primary">
                  {i + 1}
                </span>
                <h3 className="text-xl font-bold">{s.h3}</h3>
                <p className="text-base/relaxed text-gray-12 text-pretty">
                  {s.text}
                  <SupRefs ids={s.sources.map((x) => x.id)} numbers={numbers} />
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="page py-16 md:py-24">
        <h2 className="section-heading text-center max-w-2xl mx-auto">
          Fundraising platform comparison FAQs
        </h2>
        <FaqList items={index.faq} classes="max-w-3xl mx-auto mt-8 md:mt-10" />
      </section>

      <CtaBand title="Getting started with Better Giving" show_demo={false} />

      <div className="page py-10">
        <div className="max-w-3xl mx-auto">
          <SourcesList sources={sources} />
          <p className="mt-4 text-sm/relaxed text-gray-11 text-pretty">
            Sourced from each platform's public pricing and product pages. Last
            verified {long_date_of(verified)}. Spot an error?{" "}
            <a href={`mailto:${EMAILS.support}`} className="link underline">
              Tell us
            </a>{" "}
            and we fix it within 48 hours.
          </p>
        </div>
      </div>
    </main>
  );
}
