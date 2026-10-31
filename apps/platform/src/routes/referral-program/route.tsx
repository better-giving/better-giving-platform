import { href, Link } from "react-router";
import { Footer } from "#/components/footer";
import { UserAvatar } from "#/components/header/user-avatar";
import { DappLogo } from "#/components/image";
import { base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { use_session } from "#/hooks/use-session";
import type { Route } from "./+types/route";
import { Bottom } from "./bottom";
import { Faq } from "./faq";
import { Feature } from "./feature";
import { Feature2 } from "./feature-2";
import { Top } from "./top";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    url: `${base_url}${href("/referral-program")}`,
    title: "Referral Program | Better Giving",
    description:
      "Support nonprofits and earn rewards by sharing Better Giving. Join our referral program to make an impact, earn effortlessly, and grow a community of changemakers. Sign up for your unique link and start sharing today!",
  });

export default function Referrals() {
  const { session, is_loading } = use_session();
  return (
    <div className="w-full grid content-start pb-16 @container">
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
          {/* wait for session so the wide cta doesn't flash then shift to the avatar */}
          {!is_loading && !session?.signed_in && (
            <Link
              to={{
                pathname: href("/signup"),
                search: `?redirect=${href("/dashboard/referrals")}`,
              }}
              className="btn btn-primary text-nowrap"
            >
              Sign up
            </Link>
          )}
          {!is_loading && session?.signed_in && (
            <Link
              to={href("/dashboard")}
              aria-label="Your dashboard"
              className="contents"
            >
              <UserAvatar avatar={session.avatar_url} classes="size-7" />
            </Link>
          )}
        </div>
      </div>

      <div className="bg-linear-to-br from-50% from-transparent to-peach/50">
        <Top />
      </div>
      <div className="bg-linear-to-bl from-peach/50 via-transparent via-50% to-lilac/50">
        <Feature classes="page" />
      </div>
      <div className="bg-linear-to-br from-lilac/50 via-transparent via-50% to-transparent">
        <Feature2 classes="page" />
      </div>
      <Faq classes="page mt-10" />

      {/* the card paints its own fill and owns its inner padding, so the page
          container is the element around it, not the card itself. */}
      <div className="page my-10 xl:my-32">
        <Bottom />
      </div>
      <Footer />
    </div>
  );
}
