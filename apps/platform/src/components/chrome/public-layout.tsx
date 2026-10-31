import { href, Outlet, useLocation } from "react-router";
import { AnnouncementBanner, BANNER_POST_SLUG } from "./announcement-banner";
import { chrome_for, PublicFooter, PublicHeader } from "./public-chrome";

// the post the banner links to — the bar must not sit above the article it
// points at. derived from the component's own slug through the typed route
// helper, so a rename can't leave the two copies pointing at different urls.
const BANNER_TARGET = href("/blog/:slug", { slug: BANNER_POST_SLUG });

// shared shell for the pathless public layout wrappers (`_app`, `_landing`).
// header/footer resolve their intent bucket from the pathname via the chrome
// seam (see public-chrome.tsx).
export function PublicLayout() {
  const { pathname } = useLocation();
  const marketing = chrome_for(pathname) === "marketing";
  const banner = marketing && pathname.replace(/\/+$/, "") !== BANNER_TARGET;

  return (
    // the row template tracks whether the banner renders: grid auto-placement
    // fills tracks in child order, so a fixed 4-track template with the banner
    // gated off would slide the header into the banner's row and the outlet
    // into the 4rem header row.
    //
    // the `4rem` / `calc(100dvh-4rem)` values are deliberately left as they
    // are, and that is a trade-off, not a no-op: the fold reference they encode
    // excludes the banner, so while the bar is visible the minimum document
    // height is `banner_h + 100dvh` and a short marketing page that used to end
    // exactly at the fold now carries the banner's height as dead scroll below
    // the footer.
    // `print:block` drops the grid on paper. viewport units resolve against the
    // page box when printing, so the `100dvh` minimum would reserve a full
    // sheet for the outlet whatever it contains — a page of white before the
    // content on anything printed from these routes.
    // the header pins: a sticky grid item is bounded by the grid container, not
    // its 4rem track, so it rides the whole page. `scroll-pt-16` is that 4rem,
    // set on the scroller (<html>) while this shell is mounted, so a `#id` jump
    // lands below the pinned header instead of under it. the banner scrolls
    // away and needs no padding.
    // a marketing page sits on plain white: index.css paints --background
    // instead of the gray --ground for a root holding
    // `data-surfaces="marketing"`.
    <div
      data-surfaces={marketing ? "marketing" : undefined}
      className={`grid grid-cols-[minmax(0,1fr)] [html:has(&)]:scroll-pt-16 print:block ${
        banner
          ? "grid-rows-[auto_4rem_minmax(calc(100dvh-4rem),1fr)_auto]"
          : "grid-rows-[4rem_minmax(calc(100dvh-4rem),1fr)_auto]"
      }`}
    >
      {banner && <AnnouncementBanner />}
      {/* site navigation is not part of any printed document. sticky is worse
          than useless on paper: it lands the bar mid-sheet, in flow. */}
      <PublicHeader classes="sticky z-sticky -top-px print:hidden" />
      <Outlet />
      <PublicFooter />
    </div>
  );
}
