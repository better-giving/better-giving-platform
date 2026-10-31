import { href, Link } from "react-router";
import { Footer } from "#/components/footer";
import { DappLogo } from "#/components/image";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import { BottomCta } from "./bottom-cta";
import { Brands } from "./brands";
import { Feature } from "./feature";
import { ProbSol } from "./prob-sol";
import { Top } from "./top";
export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/the-smart-move-to-make-for-accepting-crypto-donations")}`,
    title: "The Smart Move to Make for Accepting Crypto Donations",
    description:
      "Accept crypto, stock, and DAF gifts. No platform fee while the optional donor contribution stays on. Turning that ask off is a 1.5% fee.",
  });
export default function Component() {
  return (
    <main className="w-full grid content-start pb-16 @container">
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
        <div className="page py-4 flex justify-between gap-x-4 items-center">
          <DappLogo classes="h-12" />
          <Link to={href("/signup")} className="btn btn-primary text-nowrap">
            Sign up
          </Link>
        </div>
      </div>

      <div className="bg-linear-to-br from-50% from-transparent to-peach/50">
        <Top classes="-mt-24" />
      </div>
      <div className="bg-linear-to-bl via-transparent via-50% from-peach/50 to-lilac/50">
        <Brands classes="my-20 xl:my-56" />
      </div>
      <div className="bg-linear-to-br from-lilac/50 via-transparent via-50% to-transparent">
        <Feature classes="page" />
      </div>
      <div className="bg-linear-to-br from-transparent via-transparent via-50% to-lilac/50">
        <ProbSol classes="page pt-40" />
      </div>
      <div className="bg-linear-to-bl from-lilac/50 via-transparent to-transparent mb-40 px-5 md:px-10">
        <BottomCta classes="max-w-2xl xl:max-w-4xl mx-auto" />
      </div>
      <Footer />
    </main>
  );
}
