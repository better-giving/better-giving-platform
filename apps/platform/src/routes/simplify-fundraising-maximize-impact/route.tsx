import { href, Link } from "react-router";
import { Footer } from "#/components/footer";
import { DappLogo } from "#/components/image";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import { BottomCta } from "./bottom-cta";
import { Brands } from "./brands";
import { DonationFormInfo } from "./donation-form-info";
import { Feature } from "./feature";
import Testimonials from "./testimonials";
import { Top } from "./top";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/simplify-fundraising-maximize-impact")}`,
    title: "Simplify Fundraising, Maximize Impact",
    description:
      "Simplify Fundraising, Maximize Impact: Register Your Nonprofit With Better Giving Today",
  });
export default function Component() {
  return (
    <main className="w-full grid content-start pb-16 @container">
      <div
        className="sticky -top-px z-sticky bg-card"
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
        <div className="page py-4 flex justify-between gap-x-4 items-center">
          <DappLogo classes="h-12" />
          <Link to={href("/signup")} className="btn btn-primary text-nowrap">
            Sign up
          </Link>
        </div>
      </div>

      <div className="bg-linear-to-br from-50% from-transparent to-peach/50">
        <Top classes="page bg-transparent" />
      </div>
      <div className="bg-linear-to-bl via-transparent via-50% from-peach/50 to-lilac/50">
        <Brands classes="my-20 xl:my-56" />
      </div>
      <div className="bg-linear-to-br from-lilac/50 via-transparent via-50% to-transparent">
        <Feature classes="page" />
      </div>
      <div className="bg-linear-to-br from-transparent via-transparent via-50% to-lilac/50">
        <DonationFormInfo classes="mt-20 xl:mt-60 page" />
      </div>
      <div className="bg-linear-to-bl from-lilac/50 via-50% via-transparent to-transparent">
        <Testimonials classes="page" />
      </div>
      <div className="my-20 xl:my-40">
        <BottomCta classes="max-w-4xl w-full justify-self-center px-5 md:px-10" />
      </div>
      <Footer />
    </main>
  );
}
