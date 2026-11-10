import { Field, type FormClasses } from "@better-giving/ui";
import type { ReactElement } from "react";
import {
  type Control,
  type FieldValues,
  type Path,
  useController,
} from "react-hook-form";
import { useMoneyInput } from "./use-money-input";

export { useMoneyInput } from "./use-money-input";

interface Props<T extends FieldValues> {
  control: Control<T>;
  /** a path whose value is a string */
  name: Path<T>;
  label: string | ReactElement;
  /** decimals allowed: see {@link useMoneyInput} */
  places?: number;
  classes?: FormClasses | string;
  placeholder?: string;
  sub?: string;
  required?: boolean;
  disabled?: boolean;
  /** drop the value from the form when the field unmounts */
  unregister?: boolean;
  error?: string;
}

/** `Field`, typing as money: the form holds "9627.92" and the box shows
 * "9,627.92". `error` is passed in like on `Field`, so the caller's own error
 * source (a server refusal, `setError`) keeps working. */
export function MoneyField<T extends FieldValues>({
  control,
  name,
  places,
  unregister,
  ...props
}: Props<T>) {
  const { field } = useController({
    control,
    name,
    shouldUnregister: unregister,
  });
  const money = useMoneyInput({
    value: String(field.value ?? ""),
    onChange: field.onChange,
    places,
    ref: field.ref,
  });
  return <Field {...props} {...money} name={name} onBlur={field.onBlur} />;
}
