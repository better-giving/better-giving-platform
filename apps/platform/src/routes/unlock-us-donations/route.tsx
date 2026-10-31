import { href, Link } from "react-router";
import { Footer } from "#/components/footer";
import { DappLogo } from "#/components/image";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import { Borders } from "./borders";
import { BottomCta } from "./bottom-cta";
import { Hero } from "./hero";
import { Pillars } from "./pillars";
import { Scenarios } from "./scenarios";
import { Testimonial } from "./testimonial";
import { WhyBg } from "./why-bg";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/unlock-us-donations")}`,
    title: "Unlock US Donations for UK Charities",
    description:
      "Tap into $499 Billion in US donations without the cost of setting up a US entity. Secure grants, DAFs, and crypto gifts for your UK charity.",
  });

export default function Component() {
  return (
    <main className="w-full grid content-start @container">
      <div
        className="sticky -top-px z-sticky bg-card"
        ref={(node) => {
          if (!node) return;
          const observer = new IntersectionObserver(
            ([e]) => {
              const stuck = e.intersectionRatio < 1;
              e.target.classList.toggle("bg-card", stuck);
              e.target.classList.toggle("shadow-floating", stuck);
            },
            { threshold: [1] }
          );
          observer.observe(node);
        }}
      >
        <div className="page py-4 flex justify-between gap-x-4 items-center">
          <DappLogo classes="h-12" />
          <Link to={href("/signup")} className="btn btn-primary text-nowrap">
            Sign up
          </Link>
        </div>
      </div>

      <Hero />
      <Borders />
      <Pillars />
      <Testimonial />
      <WhyBg />
      <Scenarios />
      <BottomCta />

      <Footer />
    </main>
  );
}
