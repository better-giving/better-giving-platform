import type { IMask } from "./mask-types";

const digit = /\d/;

export interface Edit {
  /** what the input holds after the keystroke, before the mask runs */
  value: string;
  cursor: number;
  /** `InputEvent.inputType` */
  type?: string;
  /** what the input held before the keystroke */
  prev: string;
}

/** the masked value after an edit, and where the caret goes. */
export function reformat(mask: IMask, edit: Edit) {
  const keep = mask.keep ?? digit;
  let { value, cursor } = edit;

  // deleting a character the mask inserted (a comma) changes nothing once the
  // mask runs, so the keystroke would do nothing at all — take the typed
  // character next to it instead
  const deleted =
    edit.type === "deleteContentBackward" ||
    edit.type === "deleteContentForward";
  if (deleted && mask.format(mask.unmask(value)) === edit.prev) {
    const back = edit.type === "deleteContentBackward";
    let i = back ? cursor - 1 : cursor;
    while (i >= 0 && i < value.length && !keep.test(value[i]))
      i += back ? -1 : 1;
    if (i >= 0 && i < value.length) {
      value = value.slice(0, i) + value.slice(i + 1);
      cursor = i;
    }
  }

  const typed_before = [...value.slice(0, cursor)].filter((c) =>
    keep.test(c)
  ).length;
  const formatted = mask.format(mask.unmask(value));

  let pos = 0;
  let count = 0;
  for (const ch of formatted) {
    pos++;
    if (keep.test(ch)) count++;
    if (count === typed_before) break;
  }
  // nothing typed before the caret means it belongs in front of the first
  // typed character — sending it to the end makes a delete-from-the-front loop
  // chew the value from the wrong side
  if (typed_before === 0) {
    const first = [...formatted].findIndex((c) => keep.test(c));
    pos = first === -1 ? formatted.length : first;
  }
  return { value: formatted, cursor: pos };
}
