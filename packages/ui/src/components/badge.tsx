import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "secondary"
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "on-primary";

interface Props {
  tone?: BadgeTone;
  /** `sm` inside a card or a dense row, `md` on a marketing section */
  size?: "sm" | "md";
  /** outer placement only — margin, self-alignment */
  className?: string;
  children: ReactNode;
}

// each tone is an authored surface + its own ink, never a fill tinted toward
// its own step-9 text (see packages/brand/design-system.md).
const tones: Record<BadgeTone, string> = {
  neutral: "bg-gray-3 text-gray-11",
  secondary: "bg-secondary text-gray-12",
  primary: "bg-secondary text-blue-11",
  success: "bg-success-subtle text-success-subtle-fg",
  warning: "bg-warning-subtle text-warning-subtle-fg",
  destructive: "bg-destructive-subtle text-destructive-subtle-fg",
  // only inside `surface-primary`
  "on-primary": "bg-primary-fg/15 text-primary-fg",
};

const sizes = {
  sm: "px-2 py-0.5",
  md: "px-3 py-1.5",
};

export function Badge({
  tone = "neutral",
  size = "sm",
  className = "",
  children,
}: Props) {
  return (
    <span
      data-tone={tone}
      className={`${className} inline-flex items-center rounded-full text-xs font-medium ${tones[tone]} ${sizes[size]}`}
    >
      {children}
    </span>
  );
}
