import { Image } from "@better-giving/ui";
import { type TGround, use_ground } from "./brand-band";

export type TOrgMarkSize = "sm" | "md" | "lg";

/** sm is the header's; md and lg step up a size at the md breakpoint */
const BOX: Record<TOrgMarkSize, { box: string; px: number; letter: string }> = {
  sm: { box: "size-7", px: 28, letter: "text-sm" },
  md: { box: "size-12 md:size-16", px: 64, letter: "text-xl md:text-2xl" },
  lg: { box: "size-20 md:size-26", px: 104, letter: "text-3xl md:text-4_5xl" },
};

const RING_WIDTH: Record<TOrgMarkSize, string> = {
  sm: "border",
  md: "border-2",
  lg: "border-4",
};

/** the ring cuts the mark out of what it overlaps in the ground's own colour;
 * on the deep band it is the band's ink */
const RING_INK: Record<TGround, string> = {
  page: "border-background",
  tint: "border-band",
  deep: "border-primary-fg",
};

interface IOrgMark {
  name: string;
  logo?: string | null;
  size: TOrgMarkSize;
  /** a ring in the ground's colour, for a mark that overlaps a banner or sits
   * on a band */
  ring?: boolean;
  classes?: string;
}

/** the org's logo in a square frame, or the first letter of its name in the
 * same square when it has none. decorative: the name always sits beside it */
export function OrgMark({
  name,
  logo,
  size,
  ring = false,
  classes = "",
}: IOrgMark) {
  const ground = use_ground();
  const { box, px, letter } = BOX[size];
  const edge = ring ? `${RING_WIDTH[size]} ${RING_INK[ground]}` : "";
  const shape = `${box} shrink-0 rounded ${classes}`;

  if (logo) {
    // fitted whole on the light fill: a legacy upload need not be square, and
    // no stored logo is re-cropped
    return (
      <Image
        src={logo}
        alt=""
        width={px}
        height={px}
        className={`${shape} bg-surface object-contain ${edge || "border"}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      data-monogram
      className={`${shape} grid place-items-center bg-secondary font-bold text-gray-12 ${letter} ${edge}`}
    >
      {monogram(name)}
    </span>
  );
}

/** the name's first letter or digit, so "(CLICCS)" gives C rather than ( */
function monogram(name: string): string {
  const ch = name.match(/[\p{L}\p{N}]/u)?.[0] ?? name.trim().charAt(0);
  return ch.toLocaleUpperCase();
}
