import { ArrowUpRight } from "lucide-react";
import { useId } from "react";
import { Link } from "react-router";
import type { INpo } from "$/pg/queries/npo";
import { OrgMark } from "./org-mark";
import { Socials } from "./socials";

export interface IOrgDetails {
  registration_number?: string | null;
  address?: string | null;
  active_in?: string | null;
}

interface IOrgFooter extends Pick<INpo, "social_media_urls"> {
  name: string;
  logo?: string | null;
  /** an "Organization details" row, when given; an empty field is left out */
  details?: IOrgDetails;
  classes?: string;
}

/** the org's mark, name and accounts, its details, then the platform credit */
export function OrgFooter({
  name,
  logo,
  social_media_urls,
  details,
  classes = "",
}: IOrgFooter) {
  const details_id = useId();
  const facts = details
    ? [
        { term: "EIN / Registration", value: details.registration_number },
        { term: "Address", value: details.address },
        { term: "Active in", value: details.active_in },
      ].filter((f) => f.value)
    : [];
  return (
    <footer className={`border-t border-hairline ${classes}`}>
      {/* a phone reads name, details, then the accounts, each its own row;
          wider screens put the accounts right of the name and the details,
          their heading kept for assistive tech only, on the row under */}
      <div
        className={`page flex flex-wrap items-center gap-x-3 gap-y-4 pt-6 ${facts.length > 0 ? "pb-4 sm:pb-6" : "pb-2"}`}
      >
        <OrgMark name={name} logo={logo} size="sm" />
        <span className="text-sm font-semibold">{name}</span>
        {facts.length > 0 && (
          <section
            aria-labelledby={details_id}
            className="flex basis-full flex-col gap-2 sm:order-last"
          >
            <h2
              id={details_id}
              className="text-xs font-bold uppercase tracking-badge text-gray-11 sm:sr-only"
            >
              Organization details
            </h2>
            <dl className="flex flex-wrap gap-x-7 gap-y-3 text-sm lg:gap-x-12">
              {facts.map((f) => (
                <div key={f.term} className="flex flex-col gap-1">
                  <dt className="text-xs font-bold uppercase tracking-badge text-gray-11">
                    {f.term}
                  </dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {/* on a phone, the glyphs (not their 44px targets) on the name's
            edge */}
        <Socials
          social_media_urls={social_media_urls}
          classes="empty:hidden max-sm:-ml-2.5 max-sm:basis-full sm:ml-auto"
        />
      </div>
      <div className="page">
        <div className="flex border-t border-hairline py-1">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-gray-11"
          >
            Powered by Better Giving
            <ArrowUpRight aria-hidden className="icon-xs" />
          </Link>
        </div>
      </div>
    </footer>
  );
}

/** the platform credit alone, for a page whose header already names the org */
export function OrgFooterMinimal() {
  return (
    <footer className="border-t border-hairline">
      <div className="page flex justify-center py-3">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-gray-11"
        >
          Powered by Better Giving
        </Link>
      </div>
    </footer>
  );
}
