import art from "#/assets/images/footer-landscape.webp";

interface ILandscape {
  className?: string;
}

/**
 * decorative winter landscape for the bottom of the marketing footer. the
 * raster is opaque and its sky is painted in --primary's hex mirror
 * (`accent_9` in packages/brand/src/colors.ts), so it only belongs on the
 * `surface-primary` band — moved onto another fill, its sky shows as a box.
 */
export function Landscape({ className = "" }: ILandscape) {
  return (
    <img
      src={art}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      width={2880}
      height={600}
      // anchored bottom-left: narrow screens keep the pines and hikers and
      // crop the far right; wide ones crop sky
      className={`${className} pointer-events-none select-none block w-full h-auto aspect-24/5 min-h-44 max-h-80 object-cover object-left-bottom`}
    />
  );
}
