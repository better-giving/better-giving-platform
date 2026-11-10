import type { FormEvent, Ref, RefCallback } from "react";
import { useCallback, useLayoutEffect, useReducer, useRef } from "react";
import type { IMask } from "./mask-types";
import { reformat } from "./reformat";

type El = HTMLInputElement;

/** the typing behaviour of a masked `<input>`, for a caller that owns the
 * markup: spread `ref`, `onInput` onto it and give it `value={display}`.
 * `display` is what the field shows; `on_display` receives the next one. */
export function useMaskedInput(opts: {
  mask: IMask;
  display: string;
  on_display: (next: string) => void;
  ref?: Ref<El>;
}) {
  const { mask, display, on_display } = opts;
  const input_ref = useRef<El | null>(null);
  const cursor_ref = useRef<number | null>(null);
  // a refused keystroke (a letter) leaves the value as it was, so React skips
  // the render and the browser parks the caret at the end; this render is what
  // puts it back
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useLayoutEffect(() => {
    if (cursor_ref.current != null && input_ref.current) {
      input_ref.current.setSelectionRange(
        cursor_ref.current,
        cursor_ref.current
      );
      cursor_ref.current = null;
    }
  });

  const onInput = useCallback(
    (e: FormEvent<El>) => {
      const input = e.currentTarget;
      const out = reformat(mask, {
        value: input.value,
        cursor: input.selectionStart ?? 0,
        type: (e.nativeEvent as InputEvent).inputType,
        prev: display,
      });
      cursor_ref.current = out.cursor;
      on_display(out.value);
      rerender();
    },
    [mask, display, on_display]
  );

  const outer = opts.ref;
  const ref: RefCallback<El> = useCallback(
    (node) => {
      input_ref.current = node;
      if (typeof outer === "function") outer(node);
      else if (outer) (outer as { current: El | null }).current = node;
    },
    [outer]
  );

  return { ref, onInput };
}
