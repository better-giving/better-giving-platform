import { Image } from "@better-giving/ui";
import { ArrowRight } from "lucide-react";
import { href, Link } from "react-router";
import laira_shake_hands_x2 from "#/assets/laira/laira-shaking-hands-x2.webp";
import laira_yellow from "#/assets/laira/laira-yellow.webp";
import { app_name } from "#/constants/env";

export function Top({ classes = "" }) {
  return (
    <section className={`${classes} relative grid py-20`}>
      <p className="text-sm md:text-lg font-bold text-center mb-5 text-primary">
        Earn while supporting nonprofits
      </p>
      <h1 className="mx-auto text-3xl/tight md:text-4xl/tight lg:text-5xl/tight text-center text-pretty mb-6 px-6 ">
        Join the {app_name}
        <br /> Referral Program
      </h1>
      <p className="px-6 max-w-5xl mx-auto max-md:block md:text-2xl text-center text-pretty sm:text-balance">
        Empower nonprofits and earn, simply by sharing {app_name}. Make an
        impact while building a community of changemakers.
      </p>
      <div className="flex items-baseline justify-self-center mt-4">
        <div className="relative bottom-6">
          <Image src={laira_yellow} width={100} className="z-10 rotate-z-360" />
          {/** shadow */}
          <svg
            className="absolute -bottom-3 z-0"
            width="100%"
            height="20"
            aria-hidden="true"
          >
            <defs>
              <filter id="blur">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
              </filter>
            </defs>
            <ellipse
              cx="50%"
              cy="50%"
              rx="40"
              ry="6"
              filter="url(#blur)"
              className="fill-gray-3"
            />
          </svg>
        </div>
        <div className="relative">
          <Image
            src={laira_shake_hands_x2}
            width={250}
            className="z-10 rotate-z-360"
          />
          {/** shadow */}
          <svg
            className="absolute bottom-3 left-0 -z-10"
            width="100%"
            aria-hidden="true"
            height="20"
          >
            <defs>
              <filter id="blur">
                <feGaussianBlur in="SourceGraphic" stdDeviation="40" />
              </filter>
            </defs>
            <ellipse
              cx="50%"
              cy="50%"
              rx="110"
              ry="12"
              filter="url(#blur)"
              className="fill-gray-3/70"
            />
          </svg>
        </div>
      </div>

      <Link
        to={{
          pathname: href("/signup"),
          search: `?redirect=${href("/dashboard/referrals")}`,
        }}
        className="btn btn-lg btn-primary mt-8 justify-self-center ml-1 font-bold inline-flex items-center gap-1"
      >
        Become an Affiliate
        <ArrowRight className="icon-lg" />
      </Link>
    </section>
  );
}
