import { socials as brand_socials, INTERCOM_HELP } from "@better-giving/brand";

import { base_url } from "./env";

// re-exported so app code keeps one import path for urls; the value itself lives
// in the brand package because the email templates deep-link into the same centre.
export { INTERCOM_HELP };

export const PRIVACY_POLICY = `${base_url}/privacy-policy/`;
export const TERMS_OF_USE_NPO = `${base_url}/terms-of-use-npo/`;
export const TERMS_OF_USE_DONOR = `${base_url}/terms-of-use/`;
export const guidestar = {
  seal: "https://widgets.guidestar.org/prod/v1/pdp/transparency-seal/14574957/svg",
  profile:
    "https://app.candid.org/profile/14574957/better-giving-inc-87-3758939",
};

export const DEV_DOCS_BASE_URL = "https://developer.better.giving";
export const BOOK_A_DEMO =
  "https://meetings-eu1.hubspot.com/chauncey-st-john/better-giving-nonprofit-demo";
export const GITHUB_REPO =
  "https://github.com/AngelProtocolFinance/better-giving";

export const socials = {
  ...brand_socials,
  intercom: INTERCOM_HELP,
};

export const referrals_hub = `${INTERCOM_HELP}/collections/13341032-referral-program-resource-hub`;

/** the app's own vercel blob store */
export const BLOB_STORE_HOST =
  "cnfc6hjkztdschkg.public.blob.vercel-storage.com";

export const static_url = (path: string) =>
  `https://${BLOB_STORE_HOST}/migrated/static/${path}`;
