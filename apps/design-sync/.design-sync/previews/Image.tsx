import { Image } from "@better-giving/ui";

// the capture environment has no network, so previews use inline SVG data URIs
// rather than the real CDN-hosted org logos and fundraiser covers.
const cover =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='160'><rect width='240' height='160' fill='%23dbe7de'/><circle cx='60' cy='52' r='22' fill='%23a8c4b0'/><path d='M0 160 L84 82 L150 132 L196 96 L240 132 L240 160 Z' fill='%237fa08c'/></svg>";

const logo =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><circle cx='48' cy='48' r='48' fill='%23cfd9e4'/><path d='M48 24 L68 68 L28 68 Z' fill='%236b7f95'/></svg>";

export const Default = () => (
  <Image
    src={cover}
    alt="Rainforest Trust fundraiser cover"
    className="h-40 w-60 rounded border object-cover"
  />
);

// isSrcLoading swaps in a pulsing ContentLoader sized by the same className,
// so the layout never shifts when the image lands.
export const Loading = () => (
  <Image
    isSrcLoading
    alt="Rainforest Trust fundraiser cover"
    className="h-40 w-60 rounded border"
  />
);

// no src (and not loading) falls back to ImagePlaceholder rather than a
// broken-image glyph. same fallback on an onError.
export const MissingSrc = () => (
  <Image alt="Books for Kids logo" className="h-40 w-60 rounded border" />
);

// `render` wraps the <img> without losing the loading/fallback logic — how
// the header logo becomes a link home.
export const Linked = () => (
  <Image
    src={logo}
    alt="Ocean Conservancy"
    className="h-24 w-24"
    render={(img) => (
      <a href="/marketplace/24" title="Ocean Conservancy" className="block">
        {img}
      </a>
    )}
  />
);

// donor avatar: small, round, beside the message it belongs to.
export const Avatar = () => (
  <div className="flex bg-card items-start gap-4 p-4 rounded-card w-80">
    <Image
      src={logo}
      alt="Marisol Vega"
      height={35}
      width={35}
      className="shrink-0 h-9 w-9 object-cover rounded-full"
    />
    <div>
      <p className="text-nowrap text-sm font-semibold">Marisol Vega</p>
      <p className="text-gray-11 mt-1 text-sm">
        Gave $250.00 on Nov 14, 2025 — keep up the work.
      </p>
    </div>
  </div>
);
