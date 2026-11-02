import { ExtLink } from "@better-giving/ui";
import { href, Link } from "react-router";
import { BOOK_A_DEMO } from "#/constants/urls";

export function BottomCta({ classes = "" }) {
  return (
    <section className={`${classes} surface-primary py-20`}>
      <div className="page grid justify-items-center text-center">
        <h2 className="section-heading text-primary-fg max-w-3xl text-balance">
          The all-in-one fundraising solution you deserve is only a few clicks
          away
        </h2>
        <div className="flex max-sm:flex-col sm:flex-wrap justify-center gap-3.5 mt-8">
          <Link to={href("/register")} className="btn btn-inverse btn-lg">
            Join us today!
          </Link>
          <ExtLink href={BOOK_A_DEMO} className="btn btn-lg btn-outline">
            Book a demo
          </ExtLink>
        </div>
      </div>
    </section>
  );
}
