import { type RefObject, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { BookmarkBtn } from "#/components/bookmark-btn";
import { Share } from "#/routes/_app.campaigns.$fund_id/share";
import type { INpoBookmark } from "#/types/user";
import { DonateButton } from "./donate";
import { OrgMark } from "./org-mark";
import { SectionLink } from "./section-link";

interface IShareTarget {
  recipientName: string;
  url: string;
}

/** a section of the page the header links to */
export interface IHeaderSection {
  /** the section's element id */
  id: string;
  label: string;
}

/** one Donate per header: a link or a dialog's trigger, never both */
interface IDonateLink {
  /** a Donate link to this href, when given */
  donate_to?: string;
  on_donate?: never;
}

interface IDonateDialog {
  /** a Donate button that opens the page's own donation dialog, when given */
  on_donate?: () => void;
  donate_to?: never;
}

type IOrgHeader = (IDonateLink | IDonateDialog) & {
  name: string;
  logo?: string | null;
  /** the org's profile */
  to: string;
  bookmark?: INpoBookmark;
  /** a Share icon button for this target, when given */
  share?: IShareTarget;
  /** Donate from lg only, for a page that carries its own below lg */
  donate_from_lg?: boolean;
  /** the hero's own Donate. given, the header's Donate waits until it is out
   * of view (one with no box never is in view); null while it mounts.
   * omitted, Donate always shows */
  donate_after?: Element | null;
  /** the hero's own name. given, the header's mark and name keep their place
   * but stay out of sight until it is out of view; null while it mounts.
   * omitted, they always show */
  identity_after?: Element | null;
  /** in-page links to these sections, from lg; narrower screens get none
   * here, so a page that passes them carries its own strip there */
  sections?: IHeaderSection[];
};

/** a Donate that waits rises in once the hero's are gone, and sinks out as
 * one returns; `display` goes last, so the exit is seen */
const DONATE_IN =
  "transition-[opacity,translate,display] transition-discrete duration-base ease-out starting:translate-y-1 starting:opacity-0";
const DONATE_OUT =
  "hidden translate-y-1 opacity-0 transition-[opacity,translate,display] transition-discrete duration-base ease-in";

/** the bar's identity fades in once the hero's name is gone, and out as it
 * returns, keeping its place in the bar either way */
const IDENTITY_IN = "transition-opacity duration-base ease-out";
const IDENTITY_OUT = "opacity-0 transition-opacity duration-base ease-in";

/** the nonprofit's own masthead — its mark, not Better Giving's. it pins to
 * the top, and lifts once stuck */
export function OrgHeader({
  name,
  logo,
  to,
  bookmark,
  share,
  donate_to,
  on_donate,
  donate_from_lg = false,
  donate_after,
  identity_after,
  sections = [],
}: IOrgHeader) {
  const bar = useRef<HTMLDivElement>(null);
  const donate_in = use_shown_after(donate_after, bar);
  const donate_classes = `ml-1 max-sm:px-4 sm:ml-2 ${donate_after !== undefined ? (donate_in ? DONATE_IN : DONATE_OUT) : ""} ${donate_from_lg ? "max-lg:hidden" : ""}`;
  const identity_in = use_shown_after(identity_after, bar);
  const identity_classes =
    identity_after === undefined
      ? ""
      : identity_in
        ? IDENTITY_IN
        : IDENTITY_OUT;

  return (
    <header
      className="sticky -top-px z-sticky bg-background"
      ref={lift_when_stuck}
    >
      <div
        ref={bar}
        className="page flex items-center gap-1 py-1 sm:gap-4 sm:py-2"
      >
        <Link
          to={to}
          // out of sight is out of reach too: no tab stop, no name read out
          aria-hidden={identity_in ? undefined : true}
          inert={!identity_in}
          className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 font-bold text-gray-12 sm:gap-3 ${identity_classes}`}
        >
          <OrgMark name={name} logo={logo} size="sm" />
          <span className="truncate">{name}</span>
        </Link>
        {sections.length > 0 && (
          <nav aria-label="Sections" className="shrink-0 max-lg:hidden">
            <ul className="flex items-center">
              {sections.map((s) => (
                <li key={s.id}>
                  <SectionLink
                    id={s.id}
                    classes="link inline-flex min-h-11 items-center px-3 font-semibold"
                  >
                    {s.label}
                  </SectionLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className="flex shrink-0 items-center">
          {share && <Share trigger="icon" {...share} />}
          {bookmark && (
            <BookmarkBtn
              npo={bookmark}
              // overlaps Share's 44px target by 4px, so the glyphs sit 20px
              // apart; Favorite, later in the dom, takes those 4px
              classes={`size-11 text-primary hover:bg-secondary-hover ${share ? "-ml-1" : ""}`}
              idle_ink="text-primary"
            />
          )}
          {donate_to ? (
            <DonateButton to={donate_to} classes={donate_classes} />
          ) : on_donate ? (
            <DonateButton on_click={on_donate} classes={donate_classes} />
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** whether what waits on `after` shows: always when it is undefined; never
 * while it is null (mounting) or in view; once it has gone under the bar */
function use_shown_after(
  after: Element | null | undefined,
  bar: RefObject<HTMLElement | null>
): boolean {
  // the watched element itself, once reported out of view: a new element
  // counts as in view until its first report, without a reset
  const [gone, set_gone] = useState<Element | null>(null);
  useEffect(() => {
    if (!after) return;
    // the header pins over the page's top edge, so under it is out of view
    const under = bar.current?.offsetHeight ?? 0;
    const observer = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        set_gone(e.isIntersecting ? null : e.target);
      },
      { rootMargin: `-${under}px 0px 0px 0px` }
    );
    observer.observe(after);
    return () => observer.disconnect();
  }, [after, bar]);
  return after === undefined || (after !== null && gone === after);
}

/** module-level, so its identity holds across renders and react runs it once
 * per mount, with the returned cleanup on unmount */
function lift_when_stuck(node: HTMLElement) {
  // -top-px sticks it one pixel above the viewport, so a stuck header is the
  // one no longer wholly in view
  const observer = new IntersectionObserver(
    ([e]) => {
      e.target.classList.toggle("shadow-floating", e.intersectionRatio < 1);
    },
    { threshold: [1] }
  );
  observer.observe(node);
  return () => observer.disconnect();
}
