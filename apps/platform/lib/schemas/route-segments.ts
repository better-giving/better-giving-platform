// flatRoutes id → first static URL segment. Pathless `_` segments and a
// trailing `_` escape follow `createRoutePath` in `@react-router/fs-routes`.
export function first_url_segment(route_id: string): string | null {
  const [segments, raws] = split_route_id(route_id);
  const path: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];
    const raw = raws[i];
    if (segment.startsWith("_") && raw.startsWith("_")) continue;
    if (segment.endsWith("_") && raw.endsWith("_")) {
      segment = segment.slice(0, -1);
    }
    path.push(segment);
  }
  const first = path[0];
  if (!first || first.startsWith(":") || first.startsWith("*")) return null;
  return first;
}

function split_route_id(route_id: string): [string[], string[]] {
  let index = 0;
  let route_segment = "";
  let raw = "";
  let state: "normal" | "escape" = "normal";
  const segments: string[] = [];
  const raws: string[] = [];
  const push = () => {
    if (!route_segment && !raw) return;
    segments.push(route_segment);
    raws.push(raw);
    route_segment = "";
    raw = "";
  };
  while (index < route_id.length) {
    const char = route_id[index];
    index++;
    if (state === "normal") {
      if (char === "." || char === "/") {
        push();
        continue;
      }
      if (char === "[") {
        state = "escape";
        raw += char;
        continue;
      }
      if (!route_segment && char === "$") {
        route_segment += ":";
        raw += char;
        continue;
      }
      route_segment += char;
      raw += char;
      continue;
    }
    if (char === "]") {
      state = "normal";
      raw += char;
      continue;
    }
    route_segment += char;
    raw += char;
  }
  push();
  return [segments, raws];
}

// Words that must not be an org slug even when no route uses them yet.
// Checked before the route list so a word that is both (`api`) names this rule.
export const reserved_words = [
  "org",
  "campaigns",
  "api",
  "admin",
  "dashboard",
  "platform",
  "forms",
] as const;

// First URL segment of every route under `src/routes`. The unit test
// re-derives this from the tree and fails when a route is added or removed.
export const top_level_route_segments = [
  ".well-known",
  "about-us",
  "admin",
  "agents",
  "api",
  "blog",
  "campaigns",
  "check-email",
  "connector",
  "dashboard",
  "donate",
  "donate-fund",
  "donate-widget",
  "donation-calculator",
  "donation-calculator-export",
  "donation-forms",
  "donations",
  "donor",
  "error",
  "ethical-fundraising-platform-checklist",
  "fiscal-sponsorship",
  "for-international-nonprofits",
  "for-nonprofits",
  "form-builder",
  "form-embed.js",
  "forms",
  "fund-management",
  "fundraisers",
  "funds",
  "giving-tuesday",
  "llms.txt",
  "login",
  "logout",
  "marketplace",
  "nonprofit",
  "nonprofits",
  "open-source",
  "org",
  "photo-upload",
  "platform",
  "pricing",
  "privacy-policy",
  "product",
  "profile",
  "referral-program",
  "register",
  "resources",
  "robots.txt",
  "security-policy",
  "see-what-youre-losing",
  "signup",
  "simplify-fundraising-maximize-impact",
  "simplify-fundraising-maximize-impacts",
  "sitemap.xml",
  "terms-of-use",
  "terms-of-use-npo",
  "terms-of-use-npo-2024",
  "terms-of-use-referrals",
  "terms-of-use-sms",
  "the-smart-move-to-make-for-accepting-crypto-donations",
  "unlock-us-donations",
  "wp-plugin",
  "zapier-integration",
] as const;

export function segment_block(value: string): string | undefined {
  const v = value.toLowerCase();
  if ((reserved_words as readonly string[]).includes(v)) {
    return `${value} is reserved`;
  }
  if ((top_level_route_segments as readonly string[]).includes(v)) {
    return `${value} matches a top-level route`;
  }
  return undefined;
}
