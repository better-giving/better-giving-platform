import { Field } from "@ark-ui/react/field";
import type { InputHTMLAttributes, ReactNode } from "react";

interface Props {
  classes?: string;
  input: ReactNode;
  label: string;
  error?: string;
  required?: boolean;
}

/** floating-label field. the label sits inside the control and rises on focus
    or once the input has content.

    use it for a GROUP of adjacent fields whose labels would otherwise stack
    into a column of repeated small text — first name / last name, street /
    city / zip. everywhere else the default is the top-label `Field` in
    `./field`. the two languages are both the system; the group is what picks
    between them. */
export function FloatingField({
  classes = "",
  input,
  error,
  label,
  required,
}: Props) {
  return (
    <Field.Root invalid={!!error} className={`${classes} group/field relative`}>
      {input}
      <Field.Label data-required={required} className="label-floating">
        {label}{" "}
        {error && (
          <span
            data-error
            className="text-destructive-subtle-fg mt-0.5 text-right text-xs font-normal"
          >
            {error}
          </span>
        )}
      </Field.Label>
    </Field.Root>
  );
}

interface IFloatingInput
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "placeholder"> {
  ref?: React.Ref<HTMLInputElement>;
}

/** the input half of the pair. placeholder is forced empty — the floating
    label recipe keys off `:placeholder-shown` to decide whether the label is
    resting or raised, so a real placeholder would pin it up permanently. */
export function FloatingInput({
  className = "",
  ref,
  ...props
}: IFloatingInput) {
  return (
    <Field.Input
      {...props}
      placeholder=""
      className={`${className} peer w-full py-3.5 text-sm rounded border border-input hover:border-input-hover bg-surface px-4 transition-colors outline-ring data-invalid:border-destructive`}
      ref={ref}
    />
  );
}
