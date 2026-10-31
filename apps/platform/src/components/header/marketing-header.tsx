import { MenuIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { href, Link, NavLink } from "react-router";
import { DappLogo } from "#/components/image";
import { use_session } from "#/hooks/use-session";
import { AccountMenu } from "./account-menu";

const links = [
  { label: "Donation Processing", to: href("/product") },
  { label: "Fund Management", to: href("/fund-management") },
  { label: "Fiscal Sponsorship", to: href("/fiscal-sponsorship") },
  { label: "Open Source", to: href("/open-source") },
  { label: "Pricing", to: href("/pricing") },
  { label: "About", to: href("/about-us") },
] as const;

const link_cls = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium ${isActive ? "text-primary" : "text-gray-12 hover:text-primary"}`;

interface IMarketingHeader {
  classes?: string;
}

export function MarketingHeader({ classes = "" }: IMarketingHeader) {
  const { session } = use_session();
  const [open, set_open] = useState(false);
  const close = () => set_open(false);

  // optimistic-anon: treat loading as anon so CTAs render immediately
  const is_signed_in = !!session?.signed_in;

  return (
    <header className={`${classes} relative bg-card/95 backdrop-blur-md`}>
      {/* the row carries a logo, six labels and two ctas — 944px of intrinsic
          width before a single gap, which is why the nav collapses at 75rem
          rather than at a breakpoint name. the row sits on the same `page`
          shape as the sections below it, so the logo's left edge and the
          first heading's line up. */}
      <div className="page flex items-center justify-between gap-x-6 py-2">
        {/* shrink-0 belongs on the flex item, and DappLogo's own classes land
            on the <img> inside its <a> — without this the anchor shrinks and
            object-contain letterboxes the mark. */}
        <div className="shrink-0">
          <DappLogo classes="h-12 w-auto" />
        </div>
        <nav
          aria-label="Marketing"
          className="hidden nav:flex items-center gap-x-6"
        >
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={link_cls}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        {/* fixed cta/avatar slot: anon->avatar swap doesn't shift the nav */}
        <div className="hidden nav:flex items-center justify-end gap-3">
          {is_signed_in ? (
            <AccountMenu avatar={session?.avatar_url} />
          ) : (
            <>
              <Link
                to={href("/register")}
                className="btn btn-primary shadow-lift-cta"
              >
                Join free forever
              </Link>
              <Link to={href("/login")} className="btn btn-secondary">
                Log In
              </Link>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => set_open((o) => !o)}
          aria-label="Navigation menu"
          aria-expanded={open}
          className="nav:hidden text-gray-12"
        >
          {open ? (
            <XIcon className="icon-2xl" />
          ) : (
            <MenuIcon className="icon-2xl" />
          )}
        </button>
      </div>

      {open && (
        <>
          {/* click-away catcher + scrim below the header bar. height is a
              viewport minus the header's own box (`100%` resolves against the
              containing block, i.e. this header) so the scrim ends exactly at
              the fold when the header is stuck — `h-dvh` from `top-full`
              overhangs by the header height, and by the announcement banner's
              height too while the bar is visible and the page is unscrolled. */}
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={close}
            className="nav:hidden absolute inset-x-0 top-full h-[calc(100dvh_-_100%)] cursor-default bg-gray-12/40 backdrop-blur-sm"
          />
          <div className="nav:hidden absolute inset-x-0 top-full bg-card shadow-floating">
            <nav aria-label="Marketing" className="grid gap-1 p-4">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  onClick={close}
                  className={({ isActive }) =>
                    `rounded px-4 py-2 text-sm font-medium hover:bg-secondary ${isActive ? "text-primary" : "text-gray-12"}`
                  }
                >
                  {l.label}
                </NavLink>
              ))}
              <div className="my-2 h-px bg-hairline" />
              {is_signed_in ? (
                <Link
                  to={href("/dashboard")}
                  onClick={close}
                  className="rounded px-4 py-2 text-sm font-medium hover:bg-secondary text-gray-12"
                >
                  My Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    to={href("/register")}
                    onClick={close}
                    className="btn btn-primary"
                  >
                    Join free forever
                  </Link>
                  <Link
                    to={href("/login")}
                    onClick={close}
                    className="btn btn-secondary"
                  >
                    Log In
                  </Link>
                </>
              )}
            </nav>
          </div>
        </>
      )}
    </header>
  );
}
