import { useLocation } from "react-router";
import { Footer } from "#/components/footer";
import { AppHeader, MarketingHeader } from "#/components/header";

export type Chrome = "marketing" | "minimal" | "bare";

// single source of truth for public chrome intent buckets. keyed by the first
// path segment of every public route (routes under `_app.*` / `_landing.*`).
// the drift test in `public-chrome.test.tsx` enumerates the actual
// route table and fails if any public top-level segment is missing here — so a
// new route becomes a red test, not a silent marketing misbucket.
//
//   bare      — auth funnel; logo-only, no footer
//   minimal   — transactional/browse; logo + auth-aware avatar
//   marketing — informational/landing; full marketing nav + footer
//
// the bucket also carries the page-width intent, and the header and footer
// both read it from here: marketing is `page`, minimal is `page`.
// bare has no footer and its header stays flush-wide.
export const CHROME_BY_SEGMENT: Record<string, Chrome> = {
  // bare — auth funnel
  login: "bare",
  signup: "bare",
  register: "bare",
  "check-email": "bare",

  // minimal — transactional / browse
  //
  // note: `funds`, `profile` and `fundraisers` are redirect-only resource routes
  // (route.ts, no component) — they never mount the layout, so they carry no
  // chrome entry.
  marketplace: "minimal",
  campaigns: "minimal",
  forms: "minimal",

  // marketing — informational / landing
  "about-us": "marketing",
  blog: "marketing",
  product: "marketing",
  donor: "marketing",
  resources: "marketing",
  "donation-calculator": "marketing",
  "wp-plugin": "marketing",
  "zapier-integration": "marketing",
  "privacy-policy": "marketing",
  "security-policy": "marketing",
  "terms-of-use": "marketing",
  "terms-of-use-npo": "marketing",
  "terms-of-use-npo-2024": "marketing",
  "terms-of-use-referrals": "marketing",
  "terms-of-use-sms": "marketing",
  "donation-forms": "marketing",
  "ethical-fundraising-platform-checklist": "marketing",
  "fiscal-sponsorship": "marketing",
  "for-nonprofits": "marketing",
  "for-international-nonprofits": "marketing",
  "fund-management": "marketing",
  "giving-tuesday": "marketing",
  "open-source": "marketing",
  pricing: "marketing",
};

export function chrome_for(pathname: string): Chrome {
  const segment = pathname.replace(/^\/+/, "").split("/")[0];
  // "/" (empty segment) and any unmapped segment resolve to marketing chrome.
  return CHROME_BY_SEGMENT[segment] ?? "marketing";
}

interface IPublicHeader {
  classes?: string;
}

export function PublicHeader({ classes }: IPublicHeader) {
  const { pathname } = useLocation();
  const chrome = chrome_for(pathname);

  if (chrome === "marketing") return <MarketingHeader classes={classes} />;
  if (chrome === "minimal")
    return <AppHeader variant="minimal" classes={classes} />;
  return <AppHeader variant="bare" classes={classes} />;
}

export function PublicFooter() {
  const { pathname } = useLocation();
  const chrome = chrome_for(pathname);

  // nav, socials and newsletter signup are chrome, not document — see the
  // matching print rules in public-layout.
  if (chrome === "marketing") return <Footer classes="print:hidden" />;
  if (chrome === "minimal")
    return <Footer variant="minimal" classes="print:hidden" />;
  return null;
}
