import { EMAILS } from "@better-giving/brand";
import { href, Link } from "react-router";
import { Chips } from "#/components/compare/chips";
import { FaqList } from "#/components/compare/faq-list";
import { FeatureTable } from "#/components/compare/feature-table";
import {
  long_date_of,
  source_numbers,
  split_suits,
} from "#/components/compare/format";
import { faq_jsonld } from "#/components/compare/jsonld";
import { SourcesList } from "#/components/compare/sources-list";
import { base_url } from "#/constants/env";
import { compare_chips, compare_page } from "#/content/compare/data";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const loader = ({ params }: Route.LoaderArgs) => {
  const page = compare_page(params.slug);
  if (!page) throw new Response("Not Found", { status: 404 });
  return { page, chips: compare_chips() };
};

export const meta: Route.MetaFunction = ({ loaderData: d }) => {
  if (!d) return [];
  const url = `${base_url}${href("/compare/:slug", { slug: d.page.slug })}`;
  return metas({
    url,
    canonical: url,
    title: d.page.seo_title,
    description: d.page.meta_description,
    jsonld: faq_jsonld(d.page.faq),
  });
};

export default function Page({
  loaderData: { page, chips },
}: Route.ComponentProps) {
  const numbers = source_numbers(page.sources);
  return (
    <main>
      <div className="bg-linear-to-b from-background to-band pt-12 pb-16 md:pt-16 md:pb-20">
        <div className="page grid gap-5 justify-items-start">
          <p className="eyebrow text-primary">{page.eyebrow}</p>
          <h1 className="hero-heading max-w-4xl">{page.h1}</h1>
          <p className="text-lg/relaxed text-gray-11 max-w-3xl text-pretty">
            {page.intro_p1}
          </p>
          <p className="text-lg/relaxed text-gray-11 max-w-3xl text-pretty">
            {page.intro_p2}
          </p>
          <div className="flex max-sm:flex-col max-sm:w-full gap-3.5 mt-1.5">
            <Link to={href("/register")} className="btn btn-lg btn-primary">
              Join free forever
            </Link>
            <Link to={href("/pricing")} className="btn btn-lg btn-secondary">
              See pricing
            </Link>
          </div>
        </div>
      </div>

      <Chips chips={chips} current={page.slug} />

      <section className="page pt-16 md:pt-24">
        <h2 className="section-heading text-center max-w-2xl mx-auto">
          {page.h2.table}
        </h2>
        <div className="max-w-5xl mx-auto mt-8 md:mt-11">
          <FeatureTable
            competitor={page.competitor}
            rows={page.rows}
            numbers={numbers}
          />
          <p className="mt-4 text-sm text-gray-11">
            Not listed means we found no mention on that platform's public
            pricing or product pages. Small numbers link to each source.
          </p>
        </div>
      </section>

      <section className="page py-16 md:py-24 grid gap-12 md:gap-16">
        {page.sections.map((s) => (
          <div
            key={s.h2}
            className="w-full max-w-3xl mx-auto grid gap-5 justify-items-start"
          >
            <h2 className="section-heading">{s.h2}</h2>
            <p className="text-gray-11 leading-relaxed max-w-2xl text-pretty">
              {s.text}
            </p>
          </div>
        ))}
      </section>

      <section className="bg-band py-16 md:py-24">
        <div className="page">
          <h2 className="section-heading text-center max-w-2xl mx-auto">
            {page.h2.suits}
          </h2>
          <div className="grid gap-4 md:grid-cols-2 md:gap-6 mt-8 md:mt-11 max-w-5xl mx-auto">
            {split_suits(page.who_each_suits).map((t) => (
              <div key={t} className="card">
                <p className="text-base/relaxed text-gray-12">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="page py-16 md:py-24">
        <h2 className="section-heading text-center max-w-2xl mx-auto">
          {page.h2.faq}
        </h2>
        <FaqList items={page.faq} classes="max-w-3xl mx-auto mt-8 md:mt-10" />
      </section>

      <CtaBand
        title={page.h2.cta}
        cta_label={page.cta.label}
        show_demo={false}
      />

      <div className="page py-10">
        <div className="max-w-3xl mx-auto">
          <SourcesList sources={page.sources} />
          <p className="mt-4 text-sm/relaxed text-gray-11 text-pretty">
            Sourced from each platform's public pricing and product pages. Last
            verified {long_date_of(page.last_verified)}. Spot an error?{" "}
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
