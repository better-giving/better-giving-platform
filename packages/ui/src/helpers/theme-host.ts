import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** the nearest element below <html> that sets a theme, or an open modal
 *  dialog: a floating part is portaled in there, so the variables it reads are
 *  its trigger's, not the page's, and a modal that hides the rest of the page
 *  from the reader does not hide the part with it. inside the nearest scope,
 *  the part also sits under every outer one, so nested themes resolve for it
 *  exactly as they do for the trigger. */
export const theme_scope_of = (el: HTMLElement) => {
  const scope = el.closest<HTMLElement>(
    "[data-theme], .dark, .light, [aria-modal=true]"
  );
  return scope === el.ownerDocument.documentElement ? null : scope;
};

/** the element a floating part is portaled into: the anchor's theme scope, or
 *  <body> when there is none, looked up as it mounts, on every `place()` (call
 *  it as the part opens) and, while `open`, on every class or data-theme
 *  change in the page. the host is moved rather than the portal re-targeted:
 *  a new container would remount the open part, and zag holds its positioner
 *  and its focus. set `anchor` to the trigger; pass `host` to `Portal`'s
 *  `container`. */
export function use_theme_host(open: boolean) {
  const anchor = useRef<HTMLElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  // created in render, unattached, so Portal has its container on first mount
  if (!host.current && typeof document !== "undefined") {
    host.current = document.createElement("div");
    host.current.style.display = "contents";
  }
  const place = useCallback(() => {
    const el = host.current;
    if (!el || !anchor.current) return;
    const doc = anchor.current.ownerDocument;
    const target = theme_scope_of(anchor.current) ?? doc.body;
    if (el.parentElement === target) return;
    // moving the host blurs a focused part: give it back
    const active = doc.activeElement;
    const held = active instanceof HTMLElement && el.contains(active);
    target.append(el);
    if (held) active.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    place();
    const el = host.current;
    return () => el?.remove();
  }, [place]);
  useEffect(() => {
    if (!open || !anchor.current) return;
    const watch = new MutationObserver(place);
    watch.observe(anchor.current.ownerDocument.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => watch.disconnect();
  }, [open, place]);
  return { anchor, host, place };
}
