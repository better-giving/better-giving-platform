import type { Ref } from "react";
import { GroundContext, is_brand_ground, use_ground } from "./brand-band";
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

/** the banner and a full-width Donate on a light card. a media frame: the
 * banner bleeds to its edges, so the inset is the body's. inside, the ground is
 * the page's whatever band it sits on. on a brand band the fill is its edge,
 * and the ring is the page's, since the band's white one vanishes on this
 * surface: blue-8 is --ring's step in packages/brand/src/colors.css */
export function GivePanel({
  name,
  banner,
  donate_to,
  donate_ref,
  classes = "",
}: IGivePanel) {
  const frame = is_brand_ground(use_ground())
    ? "[--ring:var(--blue-8)]"
    : "border";
  return (
    <aside
      aria-label={`Give to ${name}`}
      className={`flex flex-col overflow-hidden rounded bg-surface text-gray-12 ${frame} ${classes}`}
    >
      <GroundContext value="page">
        <OrgBanner src={banner} />
        <div className="p-4 md:p-6">
          <DonateButton
            ref={donate_ref}
            to={donate_to}
            size="lg"
            classes="w-full"
          />
        </div>
      </GroundContext>
    </aside>
  );
}
