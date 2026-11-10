import type {
  CompositionEvent,
  FormEvent,
  Ref,
  RefCallback,
  SyntheticEvent,
} from "react";
import {
  useCallback,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type { IMask } from "./mask-types";
import { reformat } from "./reformat";

type El = HTMLInputElement;

/** the typing behaviour of a masked `<input>`, for a caller that owns the
 * markup: spread what it returns (`ref`, `value`, `onInput`,
 * `onCompositionEnd`) onto it. `display` is what the field shows;
 * `on_display` receives the next one. */
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

  // the range a keystroke or paste is about to replace: read at `beforeinput`,
  // while the input still holds it
  const selection_ref = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const node = input_ref.current;
    if (!node) return;
    const remember = () => {
      selection_ref.current = {
        start: node.selectionStart ?? 0,
        end: node.selectionEnd ?? 0,
      };
    };
    node.addEventListener("beforeinput", remember);
    return () => node.removeEventListener("beforeinput", remember);
  }, []);

  // an open IME composition shows its raw text: reformatting it mid-way would
  // write a value back into the input and end the session. the mask runs once
  // on the finished text, read as typed
  const [composing, set_composing] = useState<string | null>(null);

  const apply = useCallback(
    (e: SyntheticEvent<El>, type: string | undefined) => {
      const input = e.currentTarget;
      const out = reformat(mask, {
        value: input.value,
        cursor: input.selectionStart ?? 0,
        type,
        prev: display,
        selection: selection_ref.current ?? undefined,
      });
      selection_ref.current = null;
      cursor_ref.current = out.cursor;
      on_display(out.value);
      rerender();
    },
    [mask, display, on_display]
  );

  const onInput = useCallback(
    (e: FormEvent<El>) => {
      const native = e.nativeEvent as InputEvent;
      if (native.isComposing) set_composing(e.currentTarget.value);
      else apply(e, native.inputType);
    },
    [apply]
  );

  const onCompositionEnd = useCallback(
    (e: CompositionEvent<El>) => {
      set_composing(null);
      // the range captured mid-composition is the composition's own
      selection_ref.current = null;
      apply(e, "insertText");
    },
    [apply]
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

  return { ref, value: composing ?? display, onInput, onCompositionEnd };
}
