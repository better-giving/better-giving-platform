import type { Ref } from "react";
import { Link } from "react-router";
import { is_brand_ground, use_ground } from "./brand-band";

interface IDonateLink {
  /** the donate route; the caller's, never built here */
  to: string;
  /** the hero's Donate takes one, so the header can tell when it has left */
  ref?: Ref<HTMLAnchorElement>;
  on_click?: never;
}

/** a Donate that opens the page's own donation dialog */
interface IDonateAction {
  on_click: () => void;
  to?: never;
  ref?: never;
}

type IDonateButton = (IDonateLink | IDonateAction) & {
  /** lg in the hero */
  size?: "md" | "lg";
  classes?: string;
};

/** the filled Donate. on a brand fill it inverts, since --primary on
 * --primary-deep is no button at all; the inverse has no hover rung of its
 * own, so it copies only `.btn-primary`'s press */
export function DonateButton({
  size = "md",
  classes = "",
  ...target
}: IDonateButton) {
  const fill = is_brand_ground(use_ground())
    ? "bg-primary-fg text-primary active:translate-y-px"
    : "btn-primary";
  const className = `btn ${fill} ${size === "lg" ? "btn-lg" : ""} ${classes}`;
  if (target.on_click) {
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={target.on_click}
        className={className}
      >
        Donate
      </button>
    );
  }
  return (
    <Link ref={target.ref} to={target.to} className={className}>
      Donate
    </Link>
  );
}
