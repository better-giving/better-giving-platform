import type React from "react";

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "autoComplete" | "className" | "id" | "spellCheck" | "type"
> & {
  error?: string;
  classes?: string;
  ref?: React.Ref<HTMLInputElement>;
};

export function FieldCell({
  required,
  error,
  classes = "",
  ref,
  ...props
}: Props) {
  const id = `__${props.name}`;

  return (
    <td className={`${classes} has-focus:bg-warning/10 relative`}>
      <input
        ref={ref}
        {...props}
        id={id}
        autoComplete="off"
        spellCheck={false}
        className="focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 p-2 text-sm placeholder:text-gray-11"
      />
      <p className="empty:hidden text-xs text-destructive-subtle-fg right-0 absolute -bottom-1.5">
        {error}
      </p>
    </td>
  );
}
