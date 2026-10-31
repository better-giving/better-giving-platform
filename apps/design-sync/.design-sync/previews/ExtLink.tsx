import { ExtLink } from "@better-giving/ui";

// ExtLink is a bare <a target="_blank" rel="noopener noreferrer"> — it carries
// no styling of its own, so every real call site passes className.

export const Unstyled = () => (
  <p className="w-96 text-sm">
    Donations are received by Better Giving, a 501(c)(3) — confirm our status on
    the{" "}
    <ExtLink href="https://www.irs.gov/charities-non-profits">
      IRS tax-exempt organization search
    </ExtLink>
    .
  </p>
);

export const InSentence = () => (
  <p className="w-96 text-sm">
    By donating you agree to our{" "}
    <ExtLink
      href="https://app.better.giving/terms-of-use-donors"
      className="link"
    >
      terms of use
    </ExtLink>{" "}
    and confirm you have read how Rainforest Trust reports grants.
  </p>
);

export const FooterLinks = () => (
  <nav className="grid gap-2 text-sm">
    <ExtLink href="https://www.irs.gov/charities-non-profits" className="link">
      IRS charities and non-profits
    </ExtLink>
    <ExtLink
      href="https://www.guidestar.org/profile/87-3758939"
      className="link"
    >
      Candid profile — EIN 87-3758939
    </ExtLink>
    <ExtLink href="https://oceanconservancy.org" className="link">
      Ocean Conservancy
    </ExtLink>
  </nav>
);

// the profile card: the org's own site, opened away from the app.
export const WithIcon = () => (
  <div className="w-96 bg-card rounded-card p-4 grid gap-2">
    <h3 className="text-lg font-semibold">Books for Kids</h3>
    <p className="text-sm text-gray-11">
      EIN 87-3758939 &bull; Raised $1,200.00 since Nov 14, 2025
    </p>
    <ExtLink
      href="https://booksforkids.org"
      className="inline-flex items-center gap-1.5 link text-sm font-medium justify-self-start"
    >
      Visit booksforkids.org
      <span aria-hidden className="text-xs">
        &#8599;
      </span>
    </ExtLink>
  </div>
);
