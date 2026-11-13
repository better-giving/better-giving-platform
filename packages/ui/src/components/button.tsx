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
   *  `pending` fill and stops responding. */
  is_loading?: boolean;
  loading_text?: string;
  /** on the link forms this becomes `aria-disabled` plus an interception — a
   *  `disabled` attribute on an anchor does nothing and leaves it clickable. */
  disabled?: boolean;
  /** appended last. padding belongs to the tier and width to the caller, so no
   *  `px-*` and no `w-*` from here. */
  classes?: string;
  children?: ReactNode;
}

/** `btn-icon` removes the only text node, so the icon-only shape is
 *  unconstructible without an accessible name. */
type IconName = { icon: true; "aria-label": string } | { icon?: false };

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
    props.is_loading ? "pending" : "",
    props.classes ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const inert = !!props.disabled || !!props.is_loading;

  const label = (
    <LoadText is_loading={props.is_loading} text={props.loading_text}>
      {props.children}
    </LoadText>
  );

  if (props.to !== undefined) {
    const {
      variant,
      size,
      icon,
      is_loading,
      loading_text,
      disabled,
      classes: _classes,
      children,
      to,
      nav,
      ...rest
    } = props;
    const shared = { ...rest, ...blocked(inert), className: classes };
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
      disabled,
      classes: _classes,
      children,
      href,
      ...rest
    } = props;
    return (
      <a href={href} {...rest} {...blocked(inert)} className={classes}>
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
    disabled,
    classes: _classes,
    children,
    type = "button",
    ...rest
  } = props;
  return (
    <button {...rest} type={type} disabled={inert} className={classes}>
      {label}
    </button>
  );
}

/** an anchor has no `disabled` attribute — the state has to be announced and
 *  then enforced by hand, or it renders as a still-navigable link. keydown as
 *  well as click, because Enter on an anchor can be acted on by a handler
 *  bound further up before the synthesized click ever fires. */
function blocked(inert: boolean) {
  if (!inert) return {};
  const stop = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return {
    "aria-disabled": true,
    onClick: stop,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") stop(e);
    },
  };
}
