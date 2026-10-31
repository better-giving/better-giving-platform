import { href, Link } from "react-router";
import { Footer } from "#/components/footer";
import { DappLogo } from "#/components/image";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import type { Route } from "./+types/route";
import { Top } from "./top";
export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    title: "You’re Losing Donations - Find Out How Much | Better Giving",
    description:
      "Don’t let lost fees, idle cash, and missed gifts drain your nonprofit’s revenue. Use the free Better Giving Donation Calculator to see what you’re missing in under a minute.",
    url: `${base_url}${href("/see-what-youre-losing")}`,
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

      <Top classes="page bg-transparent mt-16 mb-28" />

      <Footer />
    </main>
  );
}
