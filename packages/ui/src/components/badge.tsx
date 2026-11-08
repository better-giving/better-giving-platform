import type { ComponentProps } from "react";

type Variant = "neutral" | "primary" | "success" | "warning" | "destructive";

/** full literal class strings, never composed. every variant is a tinted chip
 *  on the subtle fill with its subtle ink, which is the pair the palette
 *  clears for body text; none of them paints a solid fill. */
const variant_class: Record<Variant, string> = {
  neutral: "bg-gray-3 text-gray-12",
  primary: "bg-secondary text-accent-12",
  success: "bg-success-subtle text-success-subtle-fg",
  warning: "bg-warning-subtle text-warning-subtle-fg",
  destructive: "bg-destructive-subtle text-destructive-subtle-fg",
};

const base =
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";

type Props = Omit<ComponentProps<"span">, "className"> & {
  /** @default "neutral" */
  variant?: Variant;
  /** appended last. */
  classes?: string;
};

/** a small status chip. it is not interactive: for an action use `Button`. */
export function Badge({
  variant = "neutral",
  classes = "",
  children,
  ...props
}: Props) {
  return (
    <span className={`${base} ${variant_class[variant]} ${classes}`} {...props}>
      {children}
    </span>
  );
}
