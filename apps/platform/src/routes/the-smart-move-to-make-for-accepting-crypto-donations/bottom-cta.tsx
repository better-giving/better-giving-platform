import { Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import logo from "#/assets/images/bg-logo.webp";
import laira_pointing from "#/assets/laira/laira-pointing.webp";

export function BottomCta({ classes = "" }) {
  return (
    <div
      className={`${classes} grid sm:grid-cols-[3fr_1fr] bg-linear-to-tr from-primary to-primary-fg rounded sm:rounded px-8 py-8 sm:px-12 sm:py-12`}
    >
      <div className="order-2 sm:order-1">
        <h4 className="text-center sm:text-left sm:text-lg text-primary-fg leading-normal mb-6">
          Simple. Sustainable.
        </h4>
        <h3 className="text-center sm:text-left sm:leading-snug  text-2xl text-primary-fg mb-9">
          No platform fee while the optional donor contribution stays on.
          Turning that ask off is a 1.5% fee.
        </h3>
        <div className="relative max-sm:justify-self-center">
          <Link
            to={href("/register")}
            className="btn sm:btn-lg btn-primary font-bold"
          >
            Start Today
          </Link>
          <div className="absolute -left-20 isolate">
            <Image
              src={laira_pointing}
              width={90}
              className="z-10 max-sm:w-24"
            />
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
        </div>
      </div>
      <Image
        alt="Letters B & G forming a circle like 8"
        width={120}
        src={logo}
        className="place-self-center mb-8 order-1 sm:order-2 max-xl:w-28"
      />
    </div>
  );
}
