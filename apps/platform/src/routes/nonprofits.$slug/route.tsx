import { href } from "react-router";
import { Footer } from "#/components/footer";
import { DappLogo } from "#/components/image";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { Partners } from "#/pages/@sections/partners";
import { Products } from "#/pages/@sections/products";
import { Steps } from "#/pages/@sections/steps";
import { Testimonials } from "#/pages/@sections/testimonials";
import { Underdog } from "#/pages/@sections/underdog";
import type { Route } from "./+types/route";
import { animal_rescue } from "./contexts/animal-rescue";
import { arts_culture } from "./contexts/arts-culture";
import { civil_rights } from "./contexts/civil-rights";
import { community_improvement } from "./contexts/community-improvement";
import { disease_awareness } from "./contexts/disease-awareness";
import { education } from "./contexts/education";
import { environment } from "./contexts/environment";
import { food_nutrition } from "./contexts/food-nutrition";
import { health_care } from "./contexts/health-care";
import { housing_shelter } from "./contexts/housing-shelter";
import { human_services } from "./contexts/human-services";
import { medical_research } from "./contexts/medical-research";
import { mental_health } from "./contexts/mental-health";
import { public_safety } from "./contexts/public-safety";
import { religious_organizations } from "./contexts/religious-organizations";
import { Cta } from "./cta";
import { Faq } from "./faq";
import { Features } from "./features";
import { Hero } from "./hero";
import type { PageContext } from "./types";

const page_context: Record<string, PageContext> = {
  "arts-culture": arts_culture,
  education: education,
  environment: environment,
  "animal-rescue": animal_rescue,
  healthcare: health_care,
  "mental-health": mental_health,
  "civil-rights": civil_rights,
  "public-safety": public_safety,
  "disease-awareness": disease_awareness,
  "medical-research": medical_research,
  "food-nutrition": food_nutrition,
  "housing-shelter": housing_shelter,
  "human-services": human_services,
  "community-improvement": community_improvement,
  "religious-organizations": religious_organizations,
};

export const meta: Route.MetaFunction = ({ params: { slug = "" } }) => {
  const ctx = page_context[slug];
  return metas({
    title: `Fundraising Platform for ${ctx.meta_subject.title} | ${app_name}`,
    description: `${app_name} helps ${ctx.meta_subject.description} increase giving and build long-term growth. No platform fee while the optional donor contribution stays on. Turning that ask off is a 1.5% fee.`,
    image: ctx.hero,
    url: `${base_url}${href("/nonprofits/:slug", { slug })}`,
  });
};

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const loader = async ({ params }: Route.LoaderArgs) => {
  const ctx = page_context[params.slug];
  if (!ctx) throw new Response("Not Found", { status: 404 });
  return ctx;
};

export default function Page({ loaderData: ctx }: Route.ComponentProps) {
  return (
    <main className="w-full grid content-start @container">
      <div
        className="sticky -top-px z-sticky"
        ref={(node) => {
          if (!node) return;
          const observer = new IntersectionObserver(
            ([e]) => {
              const isIntersecting = e.intersectionRatio < 1;
              e.target.classList.toggle("bg-card", isIntersecting);
              e.target.classList.toggle("shadow-floating", isIntersecting);
            },
            { threshold: [1] }
          );
          observer.observe(node);
        }}
      >
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 page py-2">
          <DappLogo classes="h-12" />
        </div>
      </div>
      <Hero classes="page" {...ctx} />
      <Partners of_what={ctx.partners} classes="page my-10 xl:my-20" />
      <Steps classes="page my-10 xl:my-20" />
      <Products classes="page my-10 xl:my-20" />
      <Features classes="page my-10 xl:my-20" />
      <Underdog classes="page my-10 xl:my-20" />
      <Testimonials classes="page my-10 xl:my-20" />
      <div className="bg-gray-3 pb-24">
        <Faq classes="page mt-24" />
      </div>
      <div className="page my-10 xl:my-20">
        <Cta {...ctx} />
      </div>
      {/* quiet chrome, but the body above it is narrow — the default width for
          this variant is the operator surfaces' wide one. */}
      <Footer variant="minimal" width="narrow" />
    </main>
  );
}
