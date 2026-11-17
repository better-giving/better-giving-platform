import { Check } from "lucide-react";
import type {
  ComponentProps,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { Link, type LinkProps, NavLink } from "react-router";
import { LoadText } from "./load-text";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "soft"
  | "outline"
  | "destructive"
  | "destructive-outline"
  | "success"
  | "warning";

type Size = "sm" | "md" | "lg" | "field";

/** full literal class strings, never composed. tailwind v4 is a jit over source
 *  text, so `btn-${variant}` compiles to no rule, with no error anywhere. */
const variant_class: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  soft: "btn-soft",
  outline: "btn-outline",
  destructive: "btn-destructive",
  "destructive-outline": "btn-destructive-outline",
  success: "btn-success",
  warning: "btn-warning",
};

/** md writes nothing: bare `.btn` IS the md tier, and `btn btn-md` is the
 *  double-spelling the size scale forbids. `btn-md` exists only so a call site
 *  can step *down* responsively (`btn-lg md:btn-md`), which stays the caller's. */
const size_class: Record<Size, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
  field: "btn-field",
};

interface IShared {
  variant: Variant;
  /** @default "md" */
  size?: Size;
  /** in-flight: the label renders through `LoadText`, the control takes the
   *  `pending` fill and stops responding. the button form stays focusable
   *  (`aria-disabled` + `aria-busy`), so focus is still on it when done lands. */
  is_loading?: boolean;
  loading_text?: string;
  /** on the link forms this becomes `aria-disabled` plus an interception — a
   *  `disabled` attribute on an anchor does nothing and leaves it clickable. */
  disabled?: boolean;
  /** the work succeeded: writes `data-done` and puts a check before the label,
   *  which the caller swaps for its done label ("Saved"). on the button form
   *  no activation lands while it shows, by pointer or keyboard. hold it with
   *  `useDone` and announce the outcome in a `role="status"` region. */
  is_done?: boolean;
  /** fills the container's inline size, content centred, on any variant and
   *  tier: the sheet or card footer's one action, a phone's stacked actions. */
  full_width?: boolean;
  /** appended last. padding belongs to the tier and width to the caller
   *  (`full_width`), so no `px-*` and no `w-*` from here. */
  classes?: string;
  children?: ReactNode;
}

/** `btn-icon` removes the only text node, so the icon-only shape is
 *  unconstructible without an accessible name. a square has its tier's width,
 *  so it never fills its container. */
type IconName =
  | { icon: true; "aria-label": string; full_width?: never }
  | { icon?: false };

type Anchor = Omit<ComponentProps<"a">, "className" | "children" | "href">;

type ButtonForm = IShared & { to?: never; href?: never; nav?: never } & Omit<
    ComponentProps<"button">,
    "className" | "children" | "disabled"
  >;

/** `nav` picks `NavLink` over `Link`; both render an `<a href>`. */
type LinkForm = IShared & {
  to: LinkProps["to"];
  nav?: boolean;
  href?: never;
} & Anchor;

type AnchorForm = IShared & { href: string; to?: never; nav?: never } & Anchor;

export type IButton = IconName & (ButtonForm | LinkForm | AnchorForm);

export function Button(props: IButton) {
  const classes = [
    "btn",
    size_class[props.size ?? "md"],
    variant_class[props.variant],
    props.icon ? "btn-icon" : "",
    // a square that slipped past the types keeps its square: icon wins
    props.full_width && !props.icon ? "inline-full" : "",
    props.is_loading ? "pending" : "",
    props.classes ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  /** the link forms' blocked state; the button form splits it below */
  const inert = !!props.disabled || !!props.is_loading;

  const label = (
    <LoadText is_loading={props.is_loading} text={props.loading_text}>
      {props.is_done ? <Check aria-hidden="true" /> : null}
      {props.children}
    </LoadText>
  );
  const done =
    props.is_done === undefined ? {} : { "data-done": String(props.is_done) };

  if (props.to !== undefined) {
    const {
      variant,
      size,
      icon,
      is_loading,
      loading_text,
      is_done,
      disabled,
      full_width,
      classes: _classes,
      children,
      to,
      nav,
      ...rest
    } = props;
    const shared = {
      ...rest,
      ...done,
      ...blocked(inert),
      className: classes,
    };
    return nav ? (
      <NavLink to={to} {...shared}>
        {label}
      </NavLink>
    ) : (
      <Link to={to} {...shared}>
        {label}
      </Link>
    );
  }

  if (props.href !== undefined) {
    const {
      variant,
      size,
      icon,
      is_loading,
      loading_text,
      is_done,
      disabled,
      full_width,
      classes: _classes,
      children,
      href,
      ...rest
    } = props;
    return (
      <a
        href={href}
        {...rest}
        {...done}
        {...blocked(inert)}
        className={classes}
      >
        {label}
      </a>
    );
  }

  const {
    variant,
    size,
    icon,
    is_loading,
    loading_text,
    is_done,
    disabled,
    full_width,
    classes: _classes,
    children,
    type = "button",
    ...rest
  } = props;
  // aria-disabled keeps the button focusable and hoverable, so a tooltip can
  // say why it is off; the click (and with it a submit) is stopped here. done
  // is off to the pointer in css, but Enter and Space still click the focused
  // button, so that click is stopped here too. in flight takes aria-disabled
  // rather than `disabled`: native disabled blurs a focused button to <body>
  // before the done state it is waiting for can land
  const off =
    rest["aria-disabled"] === true || rest["aria-disabled"] === "true";
  return (
    <button
      {...rest}
      {...done}
      {...(is_loading && { "aria-disabled": true, "aria-busy": true })}
      {...((off || is_loading || is_done) && { onClick: stop })}
      type={type}
      disabled={!!disabled}
      className={classes}
    >
      {label}
    </button>
  );
}

const stop = (e: MouseEvent | KeyboardEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/** an anchor has no `disabled` attribute — the state has to be announced and
 *  then enforced by hand, or it renders as a still-navigable link. keydown as
 *  well as click, because Enter on an anchor can be acted on by a handler
 *  bound further up before the synthesized click ever fires. */
function blocked(inert: boolean) {
  if (!inert) return {};
  return {
    "aria-disabled": true,
    onClick: stop,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") stop(e);
    },
  };
}
