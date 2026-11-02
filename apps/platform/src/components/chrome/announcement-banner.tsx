import { XIcon } from "lucide-react";
import { useState } from "react";
import { href, Link } from "react-router";

// the campaign id appears as a bare literal in five places: this key, the
// `data-banner` attribute, the `dataset.bannerDismissed` write, the tailwind
// arbitrary variant, and the pre-paint script in root-layout.tsx. two of those
// genuinely cannot be interpolated — tailwind's scanner needs the class
// literal, and the head script must stay a static string — so the drift is
// caught by a test instead: announcement-banner.test.tsx reads root-layout's
// source and asserts it still contains this exact key.
export const KEY = "banner:ncnp-endorsement";

// single literal for the post the bar links to. public-layout suppresses the
// bar on this same post via `href("/blog/:slug", { slug: BANNER_POST_SLUG })`
// — a second copy of the slug there would let a rename silently break the
// suppression and render the bar atop the article as a self-link.
export const BANNER_POST_SLUG = "setting-a-new-standard-for-digital-giving";

/**
 * dismissible marketing announcement bar. the caller decides *whether* to
 * render it (chrome gate + suppress-on-target-page); it takes no styling
 * props.
 *
 * markup always renders — server included. a pre-paint script in the root
 * layout sets `<html data-banner-dismissed="ncnp-endorsement">` from the
 * localStorage key, and the arbitrary variant below empties the bar before it
 * ever paints. gating the first render on a mount effect would shift the
 * layout of every marketing page instead.
 *
 * both dismissal paths — react state and the css variant — act on the *inner*
 * container, never the outer one. callers place this as its own grid row
 * (see PublicLayout), and grid auto-placement assigns tracks to boxes: an
 * outer element that stopped generating a box would slide the header and
 * outlet up a track each. an empty outer element in an `auto` track is 0px,
 * which is what collapsing is supposed to mean here.
 */
export function AnnouncementBanner() {
  const [dismissed, set_dismissed] = useState(false);

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // storage blocked (private mode / cookie policy) — the bar still closes
      // for this session, it just comes back on the next load.
    }
    document.documentElement.dataset.bannerDismissed = "ncnp-endorsement";
    set_dismissed(true);
  };

  return (
    <aside
      aria-label="Announcement"
      data-banner="ncnp-endorsement"
      className="bg-primary text-primary-fg print:hidden"
    >
      {/* the row is full-bleed, bounded by the gutter rather than a
          max-width: capping the column made the sentence wrap with the bar
          half empty. `px-5` is the gutter the marketing header's bar uses, so
          their content edges line up. */}
      {!dismissed && (
        <div className="flex items-start gap-2 px-5 py-2 [html[data-banner-dismissed='ncnp-endorsement']_&]:hidden">
          {/* only the visible "Find out more" text is the link — the sentence
              around it is plain text, so hovering or clicking the rest of the
              bar does nothing. */}
          <p className="flex-1 text-center text-xs leading-relaxed text-balance">
            Setting a new standard for digital giving. Better Giving endorses
            the National Council of Nonprofits Principles for Ethical Online
            Fundraising.{" "}
            <Link
              to={href("/blog/:slug", { slug: BANNER_POST_SLUG })}
              className="font-bold whitespace-nowrap hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-primary-fg"
            >
              Find out more →
            </Link>
          </p>
          {/* the dismiss button stays outside the link's subtree — a <button>
              inside an <a> is invalid markup and its click would bubble into
              the navigation. */}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss announcement"
            className="glyph-btn text-primary-fg/70 hover:text-primary-fg focus-visible:text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-fg"
          >
            <XIcon className="icon-md" />
          </button>
        </div>
      )}
    </aside>
  );
}
