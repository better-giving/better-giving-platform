import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { DappLogo } from "#/components/image";
import { auth_routes } from "#/constants/routes";
import { login_url } from "#/helpers/login-url";
import { use_session } from "#/hooks/use-session";
import { AccountMenu } from "./account-menu";
import { AuthBtns } from "./auth-btns";

interface IAppHeader {
  variant?: "default" | "minimal" | "bare";
  classes?: string;
  /** takes the logo's place at every width: the npo admin's header leads with
   *  the org it is working in (its switcher), not with our brand */
  context?: ReactNode;
}

export function AppHeader({
  variant = "default",
  classes,
  context,
}: IAppHeader) {
  const { session, is_loading } = use_session();
  const { pathname: p, search: s } = useLocation();
  const to = auth_routes.includes(p) ? undefined : p + s;

  // browse pages (minimal) center their body in page — align the header
  // content to it. the dashboard (default) lines up with the shell under it:
  // its right edge with the views' gutter (`px-4 md:px-10`), its left on a
  // phone with that same gutter and from md with the sidebar's icons (nav
  // `px-3` + row `px-3`). bare stays flush-wide.
  const inner =
    variant === "minimal"
      ? "page"
      : variant === "default"
        ? "px-4 md:pl-6 md:pr-10"
        : "px-6";

  return (
    <header
      className={`${classes} bg-background border-b border-hairline`}
      ref={(node) => {
        if (!node) return;
        const observer = new IntersectionObserver(
          ([e]) => {
            const isIntersecting = e.intersectionRatio < 1;
            e.target.classList.toggle("shadow-floating", isIntersecting);
          },
          { threshold: [1] }
        );
        observer.observe(node);
        return () => observer.disconnect();
      }}
    >
      <div className={`${inner} flex items-center gap-4 py-2`}>
        <div className="flex-1 flex items-center gap-4 min-w-0">
          {context ? (
            // -ml-3: the context's hover box (the org switcher) starts on the
            // sidebar rows' edge, so its content sits over their icons
            <div className="flex items-center min-w-0 min-h-12 -ml-3">
              {context}
            </div>
          ) : (
            <DappLogo classes="h-12 w-auto inline-block" />
          )}
        </div>
        {variant !== "bare" && (
          <AuthSlot
            variant={variant}
            signed_in={!!session?.signed_in}
            avatar={session?.avatar_url}
            is_loading={is_loading}
            to={to}
          />
        )}
      </div>
    </header>
  );
}

interface IAuthSlot {
  variant: "default" | "minimal";
  signed_in: boolean;
  avatar: string | undefined;
  is_loading: boolean;
  to: string | undefined;
}

function AuthSlot({ variant, signed_in, avatar, is_loading, to }: IAuthSlot) {
  // the reserve keeps resolving SWR state from reflowing the header: the
  // avatar's width under sm, where a wider one starves the header context (the
  // org switcher) of the room it truncates in; the sign-in pair's from sm up
  return (
    <div className="flex-none flex items-center justify-end min-w-6 sm:w-48">
      {!is_loading && signed_in && <AccountMenu avatar={avatar} />}
      {/* loading: render nothing visible; correct control appears when SWR resolves */}
      {!is_loading && !signed_in && to && variant === "default" && (
        <AuthBtns to={to} />
      )}
      {!is_loading && !signed_in && to && variant === "minimal" && (
        <Link to={login_url(to)} className="btn btn-secondary">
          Log in
        </Link>
      )}
    </div>
  );
}
