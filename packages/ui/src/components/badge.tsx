import type { ComponentProps } from "react";

type Variant =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "quiet"
  | "outline";
type Status = Exclude<Variant, "quiet" | "outline">;

/** full literal class strings, never composed. every status variant is a
 *  tinted chip on the subtle fill with its subtle ink, which is the pair the
 *  palette clears for body text; none of them paints a solid fill. quiet and
 *  outline are the `badge-quiet` and `badge-outline` component classes, which
 *  carry their own weight: a weight utility here would outrank theirs. */
const variant_class: Record<Variant, string> = {
  neutral: "font-semibold bg-gray-3 text-gray-12",
  primary: "font-semibold bg-secondary text-accent-12",
  success: "font-semibold bg-success-subtle text-success-subtle-fg",
  warning: "font-semibold bg-warning-subtle text-warning-subtle-fg",
  destructive: "font-semibold bg-destructive-subtle text-destructive-subtle-fg",
  quiet: "badge-quiet",
  outline: "badge-outline",
};

/** over a photo: each variant's solid step-9 fill with its -fg ink (the APCA
 *  ledger in contrast.test.ts records each pair), and a mark in the ink whose
 *  shape tells the variants apart without their color. forced colors repaint
 *  every background, the marks' too, so each mark opts out and draws in the
 *  system ink. */
const photo_class: Record<Status, string> = {
  // filled square
  neutral:
    "bg-gray-12 text-gray-1 before:bg-current forced-colors:before:forced-color-adjust-none forced-colors:before:bg-[color:CanvasText]",
  // filled diamond
  primary:
    "bg-primary text-primary-fg before:bg-current before:[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)] forced-colors:before:forced-color-adjust-none forced-colors:before:bg-[color:CanvasText]",
  // filled circle
  success:
    "bg-success text-success-fg before:rounded-full before:bg-current forced-colors:before:forced-color-adjust-none forced-colors:before:bg-[color:CanvasText]",
  // hollow ring
  warning:
    "bg-warning text-warning-fg before:rounded-full before:border-2 before:border-current forced-colors:before:forced-color-adjust-none forced-colors:before:border-[color:CanvasText]",
  // filled cross
  destructive:
    "bg-destructive text-destructive-fg before:bg-current before:[clip-path:polygon(20%_0,50%_30%,80%_0,100%_20%,70%_50%,100%_80%,80%_100%,50%_70%,20%_100%,0_80%,30%_50%,0_20%)] forced-colors:before:forced-color-adjust-none forced-colors:before:bg-[color:CanvasText]",
};

const base =
  "inline-flex items-center-safe rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap tabular-nums";

// the mark is a pseudo-element, so the label alone is the accessible name. the
// ring in the page color cuts the pill from whatever pixels sit under it.
const photo_base =
  "gap-1.5 font-semibold ring-1 ring-background before:size-2 before:shrink-0";

type Props = Omit<ComponentProps<"span">, "className"> & {
  /** appended last. */
  classes?: string;
} & (
    | {
        /** @default "neutral" */
        variant?: Status;
        /** the look for a badge laid over an image: a solid fill, a ring and
         *  a shape mark. it carries no position; the caller places it. */
        on_photo?: boolean;
      }
    | {
        /** quiet: secondary metadata beside a title. outline: an ended or
         *  archived record, never a status colour. neither has a photo look. */
        variant: "quiet" | "outline";
        on_photo?: false;
      }
  );

/** a small chip: a status, or quiet metadata, or an ended record. it is not
 *  interactive: for an action use `Button`. */
export function Badge({
  variant = "neutral",
  on_photo = false,
  classes = "",
  children,
  ...props
}: Props) {
  const look =
    on_photo && variant !== "quiet" && variant !== "outline"
      ? `${photo_base} ${photo_class[variant]}`
      : `gap-1 ${variant_class[variant]}`;
  return (
    <span className={`${base} ${look} ${classes}`} {...props}>
      {children}
    </span>
  );
}
