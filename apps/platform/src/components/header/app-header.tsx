import type { ReactNode } from "react";
import { href, Link, useLocation } from "react-router";
import { DappLogo } from "#/components/image";
import { auth_routes } from "#/constants/routes";
import { login_url } from "#/helpers/login-url";
import { use_session } from "#/hooks/use-session";
import { AuthBtns } from "./auth-btns";
import { UserAvatar } from "./user-avatar";

interface IAppHeader {
  variant?: "default" | "minimal" | "bare";
  classes?: string;
  /** rendered right of the logo from `md` up; below it the dashboard drawer
   *  carries it instead, since a phone header has no room beside the logo */
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
  // content to it. sidebar layouts (default/bare) stay flush-wide.
  const inner = variant === "minimal" ? "page" : "px-6";

  return (
    <header
      className={`${classes} bg-card`}
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
          <DappLogo classes="h-12 w-auto inline-block" />
          {context && (
            <div className="max-md:hidden flex items-center min-w-0">
              {context}
            </div>
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
  // fixed width reserves the slot so resolving SWR state doesn't reflow the header
  return (
    <div className="flex-none flex items-center justify-end w-48">
      {!is_loading && signed_in && (
        <Link
          to={href("/dashboard")}
          aria-label="Your dashboard"
          className="contents"
        >
          <UserAvatar avatar={avatar} classes="size-7" />
        </Link>
      )}
      {/* loading: render nothing visible; correct control appears when SWR resolves */}
      {!is_loading && !signed_in && to && variant === "default" && (
        <AuthBtns to={to} />
      )}
      {!is_loading && !signed_in && to && variant === "minimal" && (
        <Link to={login_url(to)} className="btn btn-secondary">
          Log In
        </Link>
      )}
    </div>
  );
}
