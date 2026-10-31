import type { ReactNode, Ref } from "react";

interface IFormNotice {
  classes?: string;
  /** the form focuses this when the notice appears, so it is announced and in view */
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/** a form-level refusal no field owns. nothing typed was wrong, so it takes the
 * muted surface rather than the destructive one. */
export function FormNotice({ classes = "", ref, children }: IFormNotice) {
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={`${classes} grid gap-2.5 bg-gray-3 rounded p-4 text-sm/relaxed focus-visible:outline-2 focus-visible:outline-offset-2`}
    >
      {children}
    </div>
  );
}
