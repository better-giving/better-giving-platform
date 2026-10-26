import { EIN } from "@better-giving/brand";
import { ExtLink } from "@better-giving/ui";
import { href, Link } from "react-router";
import logo_white from "#/assets/images/bettergiving-logo-white.webp";
import {
  BOOK_A_DEMO,
  guidestar,
  INTERCOM_HELP,
  socials,
  TERMS_OF_USE_NPO,
} from "#/constants/urls";
import { NewsletterForm } from "./newsletter-form";

type Props = {
  classes?: string;
  variant?: "full" | "minimal";
  /**
   * page-width intent of the surface above. defaults to the one each variant
   * usually sits under — `minimal` on browse and the operator surfaces (wide),
   * `full` on marketing (narrow). pass it only where the page disagrees with
   * that default, which today is the npo profile: quiet chrome over a narrow
   * body.
   */
  width?: "narrow" | "wide";
};

const platform = [
  { label: "Donation Processing", to: href("/product") },
  { label: "Fund Management", to: href("/fund-management") },
  { label: "Fiscal Sponsorship", to: href("/fiscal-sponsorship") },
  { label: "Open Source", to: href("/open-source") },
  { label: "Pricing", to: href("/pricing") },
  { label: "Marketplace", to: href("/marketplace") },
  { label: "Campaigns", to: href("/campaigns") },
  { label: "Referral Program", to: href("/referral-program") },
] as const;

const social_links = [
  { label: "LinkedIn", url: socials.linkedin },
  { label: "Facebook", url: socials.facebook },
  { label: "X", url: socials.x },
  { label: "YouTube", url: socials.youtube },
  { label: "Instagram", url: socials.instagram },
] as const;

const link_cls = "text-sm text-primary-fg/90 hover:text-primary-fg";

export function Footer({ classes = "", variant = "full", width }: Props) {
  const page =
    (width ?? (variant === "minimal" ? "wide" : "narrow")) === "wide"
      ? "page"
      : "page";

  // `page` carries the width intent so the footer lands on the same edge as the
  // header above it (see public-chrome.tsx). the <footer> itself paints the
  // full-bleed band and holds the vertical rhythm only — a px-* here would
  // stack a second gutter on the container inside it.
  //
  // minimal: logged-in operator surfaces (dashboard/platform/admin) + npo profile.
  // logo + one quiet socials row + legal bar; no nav/newsletter/mission/seal/perf-disclaimer.
  if (variant === "minimal") {
    return (
      <footer
        className={`${classes} surface-primary border-t border-primary-fg/10 py-8`}
      >
        <div
          className={`${page} flex flex-wrap items-center justify-between gap-x-6 gap-y-5`}
        >
          <Link to={href("/")} title="Go to Home page">
            <img src={logo_white} alt="Better Giving" className="w-32 h-auto" />
          </Link>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1">
            {social_links.map((s) => (
              <ExtLink
                key={s.label}
                href={s.url}
                className="text-xs font-medium text-primary-fg/90 hover:text-primary-fg"
              >
                {s.label}
              </ExtLink>
            ))}
          </div>
        </div>
        <div
          className={`${page} mt-6 pt-5 border-t border-primary-fg/10 flex flex-wrap justify-between gap-x-6 gap-y-2.5`}
        >
          <span className="text-xs text-primary-fg/90">
            © {new Date().getFullYear()} Better Giving.
          </span>
          <span className="flex flex-wrap gap-4">
            <Link
              to={href("/privacy-policy")}
              className="text-xs text-primary-fg/90 hover:text-primary-fg"
            >
              Privacy Policy
            </Link>
            <Link
              to={href("/security-policy")}
              className="text-xs text-primary-fg/90 hover:text-primary-fg"
            >
              Security
            </Link>
            <Link
              to={href("/terms-of-use")}
              className="text-xs text-primary-fg/90 hover:text-primary-fg"
            >
              Donor Terms
            </Link>
            <Link
              to={TERMS_OF_USE_NPO}
              className="text-xs text-primary-fg/90 hover:text-primary-fg"
            >
              Nonprofit Terms
            </Link>
          </span>
        </div>
      </footer>
    );
  }

  return (
    <footer
      className={`${classes} surface-primary border-t border-primary-fg/10 pt-16 pb-10`}
    >
      <div
        className={`${page} grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr]`}
      >
        <div className="grid content-start gap-4 justify-items-start">
          <Link to={href("/")} title="Go to Home page">
            <img src={logo_white} alt="Better Giving" className="w-36 h-auto" />
          </Link>
          <p className="text-sm/relaxed text-primary-fg/90 max-w-70 text-pretty">
            A member-powered, open-source fundraising and financial commons for
            nonprofits.
          </p>
          <p className="text-xs/relaxed text-primary-fg/90">
            Better Giving is a 501(c)(3) nonprofit.
            <br />
            EIN {EIN}
          </p>
          <ExtLink href={guidestar.profile} className="inline-flex">
            <img
              src={guidestar.seal}
              alt="Candid GuideStar Transparency Seal"
              className="h-18 w-auto"
            />
          </ExtLink>
        </div>

        <nav aria-label="Platform" className="grid content-start gap-2.5">
          <span className="text-sm font-bold text-primary-fg mb-1">
            Platform
          </span>
          {platform.map((l) => (
            <Link key={l.to} to={l.to} className={link_cls}>
              {l.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Organization" className="grid content-start gap-2.5">
          <span className="text-sm font-bold text-primary-fg mb-1">
            Organization
          </span>
          <Link to={href("/about-us")} className={link_cls}>
            About &amp; Mission
          </Link>
          {/* better giving's own npo row */}
          <Link to={href("/donate/:id", { id: "1" })} className={link_cls}>
            Donate
          </Link>
          <Link to={href("/blog")} className={link_cls}>
            Blog &amp; Resources
          </Link>
          <ExtLink href={INTERCOM_HELP} className={link_cls}>
            FAQs
          </ExtLink>
          <ExtLink href={BOOK_A_DEMO} className={link_cls}>
            Book a demo
          </ExtLink>
          <Link to={href("/register")} className={link_cls}>
            Sign up
          </Link>
        </nav>

        <div className="grid content-start gap-3">
          <span className="text-sm font-bold text-primary-fg">
            Stay in the loop
          </span>
          <NewsletterForm />
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-1.5">
            {social_links.map((s) => (
              <ExtLink
                key={s.label}
                href={s.url}
                className="text-xs font-medium text-primary-fg/90 hover:text-primary-fg"
              >
                {s.label}
              </ExtLink>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`${page} mt-10 pt-5 border-t border-primary-fg/10 flex flex-wrap justify-between gap-x-6 gap-y-2.5`}
      >
        <span className="text-xs/relaxed text-primary-fg/90 text-pretty">
          Past performance of the Sustainability Fund is not indicative of
          future results; all investments carry risk. ©{" "}
          {new Date().getFullYear()} Better Giving.
        </span>
        <span className="flex flex-wrap gap-4">
          <Link
            to={href("/privacy-policy")}
            className="text-xs text-primary-fg/90 hover:text-primary-fg"
          >
            Privacy Policy
          </Link>
          <Link
            to={href("/security-policy")}
            className="text-xs text-primary-fg/90 hover:text-primary-fg"
          >
            Security
          </Link>
          <Link
            to={href("/terms-of-use")}
            className="text-xs text-primary-fg/90 hover:text-primary-fg"
          >
            Donor Terms
          </Link>
          <Link
            to={TERMS_OF_USE_NPO}
            className="text-xs text-primary-fg/90 hover:text-primary-fg"
          >
            Nonprofit Terms
          </Link>
        </span>
      </div>
    </footer>
  );
}
