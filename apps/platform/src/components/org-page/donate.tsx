import type { Ref } from "react";
import { Link } from "react-router";
import { is_brand_ground, use_ground } from "./brand-band";

interface IDonateButton {
  /** the donate route; the caller's, never built here */
  to: string;
  /** lg in the hero */
  size?: "md" | "lg";
  /** the hero's Donate takes one, so the header can tell when it has left */
  ref?: Ref<HTMLAnchorElement>;
  classes?: string;
}

/** the filled Donate. on a brand fill it inverts, since --primary on
 * --primary-deep is no button at all; the inverse has no hover rung of its
 * own, so it keeps only `.btn-primary`'s press */
export function DonateButton({
  to,
  size = "md",
  ref,
  classes = "",
}: IDonateButton) {
  const fill = is_brand_ground(use_ground())
    ? "bg-primary-fg text-primary active:translate-y-px"
    : "btn-primary";
  return (
    <Link
      ref={ref}
      to={to}
      className={`btn ${fill} ${size === "lg" ? "btn-lg" : ""} ${classes}`}
    >
      Donate
    </Link>
  );
}
