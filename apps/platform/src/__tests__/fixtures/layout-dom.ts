import { expect } from "vitest";
import { userEvent } from "vitest/browser";

/** a 4:1 banner that loads with no network, so the img stays mounted rather
 * than falling back to the placeholder */
export const BANNER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="4"><rect width="16" height="4" fill="teal"/></svg>'
)}`;

/** the hero's give card */
export const give_panel = (root: Element) =>
  root.querySelector('main aside[aria-label^="Give to"]') as HTMLElement;

/** every img in main outside the give card: a banner across the page would
 * be one */
export const imgs_outside_panel = (root: Element) =>
  Array.from(root.querySelectorAll("main img")).filter(
    (img) => !give_panel(root).contains(img)
  );

/** the give card's banner: its first child, at 4:1 and flush with the card's
 * top and sides; null when the card starts elsewhere */
export function panel_banner(panel: Element): {
  ratio: number;
  flush: boolean;
} | null {
  const img = panel.firstElementChild;
  if (!(img instanceof HTMLImageElement)) return null;
  const b = img.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  return {
    ratio: b.width / b.height,
    flush:
      Math.abs(b.top - p.top) <= 1 &&
      Math.abs(b.left - p.left) <= 1 &&
      Math.abs(p.right - b.right) <= 1,
  };
}

/** where the give card's Donate sits under its banner: the gap from the
 * banner's bottom edge to Donate's top (negative when they overlap), and
 * whether Donate spans the banner's width edge to edge; null with no banner */
export function donate_under_banner(panel: Element): {
  gap: number;
  spans: boolean;
} | null {
  const img = panel.firstElementChild;
  const [donate] = donates(panel);
  if (!(img instanceof HTMLImageElement) || !donate) return null;
  const b = img.getBoundingClientRect();
  const d = donate.getBoundingClientRect();
  return {
    gap: d.top - b.bottom,
    spans: Math.abs(d.left - b.left) <= 1 && Math.abs(d.right - b.right) <= 1,
  };
}

/** the Donate links under `root`, by their visible name */
export const donates = (root: Element) =>
  Array.from(root.querySelectorAll("a")).filter(
    (a) => a.textContent === "Donate"
  );

/** the give card's children in dom order: "banner" for its image, "donate"
 * for Donate or a block holding it and nothing else, else that block's text */
export const panel_parts = (panel: Element) =>
  Array.from(panel.children).map((el) => {
    if (el instanceof HTMLImageElement) return "banner";
    const only_donate =
      el.textContent === "Donate" &&
      (el.matches("a") || donates(el).length === 1);
    return only_donate ? "donate" : (el.textContent ?? "");
  });

/** elements under `root` pinned to the viewport's bottom edge: fixed or
 * sticky, with a bottom inset */
export const pinned_to_bottom = (root: Element) =>
  Array.from(root.querySelectorAll("*")).filter((el) => {
    const s = getComputedStyle(el);
    return (
      (s.position === "fixed" || s.position === "sticky") && s.bottom !== "auto"
    );
  });

/** the header's Donate, when it shows one: one that waits is mounted and
 * out of the layout (`display: none`) until then, and fades through opacity
 * on its way in and out, so a faded-out one is not shown either */
export const header_donate = (root: Element): HTMLAnchorElement | undefined =>
  donates(root.querySelector("header") as HTMLElement).find((a) =>
    a.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  );

/** scrolls the hero's shown Donate past the top of the viewport, under the
 * pinned header */
export function scroll_past_hero_donate(root: Element) {
  const hero = donates(root.querySelector("main") as HTMLElement).find((a) =>
    a.checkVisibility()
  ) as HTMLElement;
  window.scrollTo(0, hero.getBoundingClientRect().bottom + window.scrollY);
}

/** a colour token as the browser computes it, for comparing with a computed
 * colour of the same notation */
export function token_color(name: `--${string}`) {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** the outline `el` shows under keyboard focus */
export async function keyboard_ring(el: HTMLElement) {
  await userEvent.keyboard("{Tab}");
  el.focus();
  await expect.poll(() => el.matches(":focus-visible")).toBe(true);
  const s = getComputedStyle(el);
  return {
    style: s.outlineStyle,
    color: s.outlineColor,
    offset: Number.parseFloat(s.outlineOffset),
  };
}
