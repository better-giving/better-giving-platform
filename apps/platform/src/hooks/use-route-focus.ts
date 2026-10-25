import { useContext, useEffect, useRef } from "react";
import { UNSAFE_DataRouterStateContext, useLocation } from "react-router";

/**
 * moves focus to the element the URL's `#hash` names, else the new page's
 * `h1` (else `main`), after a navigation that changes the pathname, so a
 * client-side navigation doesn't leave focus on `<body>` or on the control
 * that triggered it.
 */
export function use_route_focus() {
  const { pathname, hash } = useLocation();
  // the only export carrying the navigation's preventScrollReset (UNSAFE_, not in the docs) —
  // ScrollRestoration reads the same context.
  const prevent_scroll_reset =
    useContext(UNSAFE_DataRouterStateContext)?.preventScrollReset ?? false;
  const prev_pathname = useRef(pathname);

  useEffect(() => {
    if (prev_pathname.current === pathname) return;
    prev_pathname.current = pathname;
    // an in-place swap (tab, filter, closing a route modal) keeps its focus
    if (prevent_scroll_reset) return;
    focus_page(hash);
  }, [pathname, hash, prevent_scroll_reset]);
}

function focus_page(hash: string) {
  // a route-as-modal moves focus into itself
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
  const main = document.querySelector("main");
  if (main?.contains(document.activeElement)) return;

  const anchor = hash_target(hash);
  // focus without preventScroll keeps the anchor the browser scrolled to in view
  if (anchor) return focus_without_ring(anchor);

  const target = (main ?? document.body).querySelector("h1") ?? main;
  if (!target) return;
  // ScrollRestoration owns the scroll position
  focus_without_ring(target, { preventScroll: true });
}

function hash_target(hash: string) {
  if (!hash) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    // malformed percent-encoding names no element
    return null;
  }
}

export function focus_without_ring(el: HTMLElement, options?: FocusOptions) {
  if (!el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "-1");
    // chromium paints the UA focus-visible ring on script focus that follows a keypress
    el.style.outline = "none";
  }
  el.focus(options);
}
