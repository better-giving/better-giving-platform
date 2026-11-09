import type React from "react";
import {
  createElement,
  type HTMLInputTypeAttribute,
  type ReactElement,
  type ReactNode,
} from "react";
import { unpack } from "../../helpers/unpack";
import { Label } from "./label";
import type { Classes } from "./types";

const textarea = "textarea" as const;
type TextArea = typeof textarea;
type InputType = HTMLInputTypeAttribute | TextArea;

/** a constrained *text* type is a rule the browser enforces itself, in its own
 * bubble, before the action ever runs — so a malformed address fires no submit,
 * the app's error summary stays empty, nothing is marked `aria-invalid` and the
 * focus move never happens. `required` is withheld from the control for exactly
 * that reason (see the prop below); a type named here is translated rather than
 * spread, for the same one.
 *
 * the keyboard is the only half worth keeping, and `inputMode` carries it
 * without the constraint. the schema is what validates. `date`, `number` and
 * `checkbox` are absent — their type is the control, not a rule over free
 * text. */
const unconstrained: Partial<Record<string, "email" | "url" | "tel">> = {
  email: "email",
  url: "url",
  tel: "tel",
};

type Props<T extends InputType> = Omit<
  T extends TextArea
    ? React.TextareaHTMLAttributes<HTMLTextAreaElement>
    : React.InputHTMLAttributes<HTMLInputElement>,
  "className" | "id" | "spellCheck" | "type"
> & {
  classes?: Classes | string;
  tooltip?: ReactNode;
  label: string | ReactElement;
  /** help text under the label. a string empty after trim counts as absent;
   * any other truthy value counts as present, so a ReactNode must render
   * text — one that renders nothing leaves the control described by an empty
   * node. */
  sub?: ReactNode;
  /** id(s) of help text the caller renders OUTSIDE this component, joined onto
   * the ids this component mints. nothing here can reach that markup, so its
   * id has to be handed in — notes sitting below a field built at the call
   * site, say. a `sub` needs none of this: it is described either way. */
  describedby?: string;
  type?: T;
};

export function Field<T extends InputType = InputType>({
  type = "text" as T,
  label,
  classes,
  tooltip,
  sub,
  describedby,
  required, //extract from props to disable native validation
  // off by default: most fields here are somebody else's data (a contact's
  // details, a delivery address), which the browser must not prefill from
  // the user's own saved values
  autoComplete = "off",
  error,
  ref,
  ...props
}: Props<T> & {
  error?: string;
  ref?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
}) {
  const style = unpack(classes);

  const id = `__${String(props.name)}`;
  const errorId = `__error_${String(props.name)}`;
  const subId = `__sub_${String(props.name)}`;
  const tooltipId = `__tooltip_${String(props.name)}`;
  const mode = unconstrained[type as string];
  const has_sub = typeof sub === "string" ? sub.trim() !== "" : !!sub;

  // every piece of help text on screen for this render, in reading order. the
  // error joins the list rather than standing in for it — a reader that hears
  // only the error loses the guidance that would fix it.
  const described =
    [
      has_sub ? subId : undefined,
      tooltip ? tooltipId : undefined,
      describedby,
      error ? errorId : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={`${style.container} min-w-0`}>
      <Label
        className={`${style.label} label ${has_sub ? "" : "mb-1"}`}
        required={required}
        htmlFor={id}
      >
        {label}
      </Label>
      {has_sub ? (
        typeof sub === "string" ? (
          <p id={subId} className="text-gray-11 text-sm mb-2 break-words">
            {sub}
          </p>
        ) : (
          // `sub` is a ReactNode and callers pass a paragraph, so the wrapper
          // has to hold block markup — inside a span that is invalid nesting
          // the browser is free to restructure, carrying the content out from
          // under the id
          <div id={subId}>{sub}</div>
        )
      ) : null}

      {createElement(type === textarea ? textarea : "input", {
        ref,
        ...props,
        ...(type === textarea ? {} : { type: mode ? "text" : type }),
        // a caller's own inputMode wins. autoCapitalize is off by default on a
        // constrained type and on by default on `text`, so it is restated here
        ...(mode
          ? {
              inputMode: props.inputMode ?? mode,
              autoCapitalize: props.autoCapitalize ?? "none",
            }
          : {}),
        id,
        "aria-invalid": !!error,
        "aria-disabled": props.disabled,
        // native `required` is withheld (see `unconstrained` above), so this
        // is the only thing that announces the asterisk the label draws
        "aria-required": required || undefined,
        // both, because neither alone is enough: `aria-errormessage` is the
        // right relationship but several screen readers still ignore it, and
        // `aria-describedby` is the one they all honour. it is absent when no
        // help text is present — a ReactNode `sub` is taken at its word (see
        // the prop).
        "aria-errormessage": errorId,
        "aria-describedby": described,
        className: `${style.input} field-input`,
        autoComplete,
        spellCheck: false,
      })}

      {(tooltip && ( //tooltip in normal flow
        <p className={`${style.error} text-left mt-1 left-0 text-xs`}>
          {/* the id sits on the tooltip alone, not the paragraph around it:
              the paragraph also holds the error span, and describing the
              control by both would read the message out twice. */}
          <span
            id={tooltipId}
            className={typeof tooltip === "string" ? "text-gray-11" : ""}
          >
            {tooltip}
          </span>{" "}
          <span
            id={errorId}
            className="empty:hidden text-destructive-subtle-fg text-xs before:content-['('] before:mr-0.5 after:content-[')'] after:ml-0.5 empty:before:hidden empty:after:hidden"
          >
            {error}
          </span>
        </p>
      )) || (
        <p
          id={errorId}
          className={`${style.error} field-err mt-1 empty:hidden`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
