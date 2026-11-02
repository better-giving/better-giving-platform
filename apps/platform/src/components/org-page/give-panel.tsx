import type { Ref } from "react";
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

/** the banner with Donate full-width under it, or Donate alone. either way
 * Donate sits on the band around the panel and takes that ground's fill and
 * ring, never on the photo, where no fill or ring is sure to read. alone, it
 * keeps the right edge the full-width one would have had, so from md it ends
 * the content column instead of floating at the start of the card's */
export function GivePanel({
  name,
  banner,
  donate_to,
  donate_ref,
  classes = "",
}: IGivePanel) {
  return (
    <aside
      aria-label={`Give to ${name}`}
      className={`flex ${banner ? "flex-col gap-3" : "md:justify-end"} ${classes}`}
    >
      {banner && <OrgBanner src={banner} classes="rounded" />}
      <DonateButton ref={donate_ref} to={donate_to} size="lg" />
    </aside>
  );
}
