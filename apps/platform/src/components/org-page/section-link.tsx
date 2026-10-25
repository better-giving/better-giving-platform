import type { MouseEvent, ReactNode } from "react";
import { focus_without_ring } from "#/hooks/use-route-focus";

interface ISectionLink {
  /** the section's element id */
  id: string;
  classes?: string;
  children: ReactNode;
}

/** an in-page link that scrolls smoothly, unless motion is reduced */
export function SectionLink({ id, classes = "", children }: ISectionLink) {
  return (
    <a href={`#${id}`} onClick={glide} className={classes}>
      {children}
    </a>
  );
}

/** not root `scroll-behavior`, or every route change would glide too. the
 * hash replaces: an entry the router didn't make would pop back on Back. under
 * reduced motion it jumps, but by the same path, so Back behaves the same */
function glide(e: MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return;
  }
  const { hash } = e.currentTarget;
  const target = document.getElementById(hash.slice(1));
  if (!target) return;
  e.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  focus_without_ring(target, { preventScroll: true });
  window.history.replaceState(window.history.state, "", hash);
}
