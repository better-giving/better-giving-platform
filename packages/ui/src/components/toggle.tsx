import { Field } from "@ark-ui/react/field";
import { Switch } from "@ark-ui/react/switch";
import type { PropsWithChildren } from "react";
import { unpack } from "../helpers/unpack";

type Classes = { container?: string; label?: string; error?: string };

interface Props extends PropsWithChildren {
  classes?: Classes;
  disabled?: boolean;
  required?: boolean;
  value: boolean;
  onChange: (val: boolean) => void;
  error?: string;
}

/**
 * switch height is `--toggle-h` (default `1lh`, so it tracks the text size set
 * on `classes.container`), width `--toggle-w` (default twice the height). set
 * either on `classes.container`, e.g. `[--toggle-h:1.5rem]`; thumb diameter and
 * travel derive from both.
 */
export const Toggle = ({ children, ...props }: Props) => {
  const cls = unpack(props.classes);
  return (
    <Field.Root
      invalid={!!props.error}
      disabled={props.disabled}
      required={props.required}
      className={`grid grid-cols-[auto_1fr] ${
        children ? "gap-x-3" : ""
      } items-center ${cls.container}`}
    >
      <Switch.Root
        checked={props.value}
        onCheckedChange={(e) => props.onChange(e.checked)}
        className="contents"
      >
        {/* focus lands on the hidden input, so :focus-visible never matches here */}
        <Switch.Control className="[--th:var(--toggle-h,1lh)] [--tw:var(--toggle-w,calc(var(--th)*2))] [--inset:calc(var(--th)*0.1)] relative inline-flex shrink-0 items-center h-(--th) w-(--tw) rounded-full bg-gray-3 inset-shadow-track inset-ring inset-ring-gray-9 transition-colors not-data-disabled:data-[state=checked]:bg-primary not-data-disabled:data-[state=checked]:inset-ring-primary data-focus-visible:outline-2 data-focus-visible:outline-ring data-disabled:cursor-default">
          <Switch.Thumb className="pointer-events-none inline-block size-[calc(var(--th)-2*var(--inset))] translate-x-(--inset) data-[state=checked]:translate-x-[calc(var(--tw)-var(--th)+var(--inset))] rounded-full bg-background shadow-track-fill transition-transform" />
        </Switch.Control>
        <Switch.Label
          className={`${cls.label} ${
            props.required
              ? "after:ml-1 after:content-['*'] after:text-destructive-subtle-fg"
              : ""
          }`}
        >
          {children}
        </Switch.Label>
        <Switch.HiddenInput />
      </Switch.Root>

      <p className={`${cls.error} col-span-full field-err empty:hidden`}>
        {props.error}
      </p>
    </Field.Root>
  );
};
