import type { Ref } from "react";
import { GroundContext } from "./brand-band";
import { DonateButton } from "./donate";
import { OrgBanner } from "./org-banner";

interface IGivePanel {
  /** the org's name, which names the panel */
  name: string;
  /** the 4:1 banner; none, and the panel is Donate alone */
  banner: string | null | undefined;
  donate_to: string;
  /** the hero Donate the header waits on */
  donate_ref?: Ref<HTMLAnchorElement>;
  classes?: string;
}

/** the banner with Donate floating on its bottom-right corner, or Donate alone
 * on whatever ground the panel sits in. on the banner the ground is the page's
 * whatever band is around it, and so is the ring: the deep band's white one
 * vanishes on a pale photo. blue-8 is --ring's step in
 * packages/brand/src/colors.css */
export function GivePanel({
  name,
  banner,
  donate_to,
  donate_ref,
  classes = "",
}: IGivePanel) {
  if (!banner) {
    return (
      <aside aria-label={`Give to ${name}`} className={`flex ${classes}`}>
        <DonateButton ref={donate_ref} to={donate_to} size="lg" />
      </aside>
    );
  }
  return (
    <aside
      aria-label={`Give to ${name}`}
      className={`relative [--ring:var(--blue-8)] ${classes}`}
    >
      <GroundContext value="page">
        <OrgBanner src={banner} classes="rounded" />
        <DonateButton
          ref={donate_ref}
          to={donate_to}
          size="lg"
          classes="absolute right-3 bottom-3 shadow-floating"
        />
      </GroundContext>
    </aside>
  );
}
