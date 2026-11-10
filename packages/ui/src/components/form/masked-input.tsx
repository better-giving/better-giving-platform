import type { InputHTMLAttributes, ReactElement, ReactNode } from "react";
import { unpack } from "../../helpers/unpack";
import type { IMask } from "./mask-types";
import type { Classes } from "./types";
import { useMaskedInput } from "./use-masked-input";

type El = HTMLInputElement;

interface Base
  extends Pick<
    InputHTMLAttributes<El>,
    "placeholder" | "inputMode" | "type" | "onBlur"
  > {}

interface Props extends Base {
  id: string;
  /** set it to submit the masked value with a plain form post; controller-driven
   * callers leave it off and submit through their form library instead. */
  name?: string;
  /** one of `./masks/*` — no default, so a caller can never inherit another
   * field's formatting by omission. */
  mask: IMask;
  placeholder?: string;
  classes?: Classes | string;
  label: string | ReactElement;
  /** help text under the label. a string empty after trim counts as absent;
   * any other truthy value counts as present, so a ReactNode must render
   * text — one that renders nothing leaves the control described by an empty
   * node. */
  sub?: ReactNode;
  required?: boolean; // extract to disable native validation
  onChange: (val: string) => void;
  /** refuses edits via `readOnly`, never `disabled` — a disabled input is
   * dropped from a native form post, which would silently lose the value on a
   * pre-hydration submit. `.field-input` paints the affordance off
   * `[readonly]`. */
  disabled?: boolean;
  value: string;
  error?: string;
  ref?: React.Ref<El>;
}

export function MaskedInput({ sub, ...props }: Props) {
  // extract `required` to disable native validation
  const style = unpack(props.classes);
  const errorId = `error_${props.id}`;
  const subId = `sub_${props.id}`;
  const has_sub = typeof sub === "string" ? sub.trim() !== "" : !!sub;

  // every piece of help text on screen for this render, in reading order. the
  // error joins the list rather than standing in for it — a reader that hears
  // only the error loses the guidance that would fix it.
  const described =
    [has_sub ? subId : undefined, props.error ? errorId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  const { ref, onInput } = useMaskedInput({
    mask: props.mask,
    display: props.value,
    on_display: props.onChange,
    ref: props.ref,
  });

  return (
    <div className={`${style.container} `}>
      <label
        data-required={props.required}
        className={`${style.label} label ${has_sub ? "" : "mb-2"}`}
        htmlFor={props.id}
      >
        {props.label}
      </label>
      {has_sub ? (
        typeof sub === "string" ? (
          <p id={subId} className="text-gray-11 text-sm mb-2">
            {sub}
          </p>
        ) : (
          // `sub` is a ReactNode and callers pass block markup, so the wrapper
          // has to hold it — inside a span that is invalid nesting the browser
          // is free to restructure, carrying the content out from under the id
          <div id={subId}>{sub}</div>
        )
      ) : null}

      <input
        type={props.type ?? "text"}
        ref={ref}
        id={props.id}
        name={props.name}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        value={props.value}
        aria-invalid={!!props.error}
        // native `required` is withheld (see `required` above), so this is the
        // only requiredness a screen reader hears — absent, never "false"
        aria-required={props.required || undefined}
        readOnly={props.disabled}
        // see `field.tsx`: the errormessage relationship is the correct one and
        // the describedby is the one every screen reader reads
        aria-errormessage={errorId}
        // absent when no help text is present — a ReactNode `sub` is taken at
        // its word (see the prop)
        aria-describedby={described}
        className={`${style.input} field-input`}
        autoComplete="off"
        spellCheck={false}
        onInput={onInput}
        onBlur={props.onBlur}
      />

      <p id={errorId} className={`${style.error} field-err mt-1 empty:hidden`}>
        {props.error}
      </p>
    </div>
  );
}
