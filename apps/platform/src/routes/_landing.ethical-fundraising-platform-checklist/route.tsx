import { href, Link } from "react-router";
import { BANNER_POST_SLUG } from "#/components/chrome/announcement-banner";
import { app_name, base_url } from "#/constants/env";
import { metas } from "#/helpers/seo";
import { CtaBand } from "#/pages/@sections/cta-band";
import type { Route } from "./+types/route";
import { Checklist } from "./checklist";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const meta: Route.MetaFunction = () =>
  metas({
    // explicit: `metas` defaults `url` to base_url, which would canonicalize
    // this page into the homepage
    url: `${base_url}${href("/ethical-fundraising-platform-checklist")}`,
    title: `Ethical Fundraising Platform Checklist | ${app_name}`,
    description:
      "28 questions to ask the platform collecting donations in your nonprofit's name, drawn from the National Council of Nonprofits' Principles for Ethical Online Fundraising Platforms. Free, printable, nothing to sign up for.",
  });

export default function Page() {
  return (
    <main>
      {/* paper has its own margin — the screen's breathing room above the fold
          is just a shorter first page */}
      <header className="border-b border-hairline px-6 py-14 md:py-16 print:border-0 print:pt-4 print:pb-0">
        <div className="mx-auto max-w-3xl">
          <p className="eyebrow text-primary">
            Member-powered ethical fundraising
          </p>
          <h1 className="hero-heading mt-4">
            Does your donation platform pass the ethics test?
          </h1>
          <p className="mt-5 text-base/relaxed text-gray-11 text-pretty">
            Work through each question about the platform that collects money in
            your name. Every item maps to the{" "}
            <strong className="font-bold text-gray-12">
              National Council of Nonprofits' Principles for Ethical Online
              Fundraising Platforms
            </strong>
            . Items marked as a flashpoint are the practices that triggered real
            2025-26 lawsuits and cease-and-desist orders. Treat an unchecked one
            as a warning sign, not a footnote.
          </p>
          <p className="font-gochi mt-5 origin-left -rotate-1 text-lg text-primary">
            Print it. Take the unchecked ones to your platform.
          </p>
        </div>
      </header>

      <div className="px-6 py-10 md:py-12 print:px-0 print:py-4">
        <Checklist classes="mx-auto max-w-3xl" />

        <footer className="card shadow-lift-card mx-auto mt-6 max-w-3xl break-inside-avoid text-sm/relaxed text-gray-11">
          <p>
            <strong className="font-bold text-gray-12">How to use this.</strong>{" "}
            Send unchecked items to your platform's support or account team in
            writing and keep the reply. If a platform won't answer a flashpoint
            question in writing, that reluctance is itself informative.
          </p>
          <p className="mt-3">
            <strong className="font-bold text-gray-12">
              Regulatory quick-check.
            </strong>{" "}
            If any of your donors are in California, your platform must be
            registered under AB 488 and remit funds within 5 business days.
            California and Hawaii currently have the most comprehensive platform
            laws; other states are enforcing through consumer-protection and
            charitable-solicitation statutes. You can look up a platform's
            California registration on the state's Registry of Charities and
            Fundraisers.
          </p>
          <p className="mt-3 text-xs">
            Framework adapted from the National Council of Nonprofits,{" "}
            <em>Principles for Ethical Online Fundraising Platforms</em>. This
            is a practical due-diligence aid, not legal advice. Check your own
            state's charitable-solicitation rules or ask a nonprofit attorney
            about your specific situation.
          </p>
          <p className="mt-5 border-t border-hairline pt-4 text-xs print:hidden">
            <Link
              to={href("/blog/:slug", { slug: BANNER_POST_SLUG })}
              className="font-bold link"
            >
              Why {app_name} endorses these principles →
            </Link>
          </p>
        </footer>
      </div>

      {/* the printed sheet is a due-diligence document a nonprofit takes to
          another vendor — an ad for us doesn't belong on it */}
      <CtaBand
        classes="print:hidden"
        title="Fundraising you can audit"
        subtitle="We endorse the same principles this page asks you to check for. Our fees, our code, and our terms are all public."
      />
    </main>
  );
}
