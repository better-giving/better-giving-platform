import { Image } from "@better-giving/ui";
import { href, Link } from "react-router";
import laira_shake_hands_x2 from "#/assets/laira/laira-shaking-hands-x2.webp";

export function BottomCta({ classes = "" }) {
  return (
    <div
      id="register-nonprofit"
      className={`${classes} grid @4xl:grid-cols-2 gap-4 content-start scroll-mt-10`}
    >
      <h4 className="col-span-full text-lg text-primary text-center">
        Simple. Sustainable. Free.
      </h4>
      <h2 className="col-span-full text-center text-3xl @4xl:text-4xl leading-snug max-w-2xl justify-self-center mb-12 capitalize">
        The all-in-one fundraising solution you deserve is only a few clicks
        away
      </h2>

      <div
        className={`${classes} justify-items-center col-span-full grid w-full bg-linear-to-br from-primary to-transparent p-6 rounded`}
      >
        <h3 className="text-center text-primary-fg @3xl:leading-snug  text-xl @sm:text-2xl mb-4 col-span-full">
          US 501(c)(3) Nonprofit?
        </h3>
        <p className="text-primary-fg text-lg font-bold mb-2 text-center capitalize">
          Register your nonprofit
        </p>
        <Image width={200} src={laira_shake_hands_x2} className="mt-4 mb-8" />
        <Link
          to={href("/register")}
          className="btn btn-primary flex items-center font-bold"
        >
          Get Started
        </Link>
      </div>
    </div>
  );
}
