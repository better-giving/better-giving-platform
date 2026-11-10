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

/** the masked value after an edit, and where the caret goes.
 *
 * the edit is split against `prev` into the field's own text before it, the
 * text the user put in, and the field's own text after it. only the inserted
 * text is read as typed (`mask.read`); the field's own text keeps just its
 * typed characters, so a comma the mask drew is never mistaken for one the
 * user typed. */
export function reformat(mask: IMask, edit: Edit) {
  const keep = mask.keep ?? digit;
  const typed = (s: string) => [...s].filter((c) => keep.test(c)).join("");
  const { prev, value, cursor } = edit;

  // everything after the caret is untouched tail of `prev` for any single
  // caret edit; anything else (an undo restoring older text) is read whole as
  // the field's own text
  const tail = value.slice(cursor);
  const split = prev.endsWith(tail);
  const tail_at = split ? prev.length - tail.length : prev.length;
  let p = 0;
  const head_max = split ? Math.min(cursor, tail_at) : 0;
  while (p < head_max && prev[p] === value[p]) p++;
  let before = split ? prev.slice(0, p) : "";
  let after = split ? tail : "";
  const inserted = split ? value.slice(p, cursor) : value;
  const removed = split ? prev.slice(p, tail_at) : "";

  // deleting a character the mask inserted (a comma) changes nothing once the
  // mask runs, so the keystroke would do nothing at all — take the typed
  // character next to it instead
  const back = edit.type === "deleteContentBackward";
  if (
    (back || edit.type === "deleteContentForward") &&
    !inserted &&
    removed &&
    !typed(removed)
  ) {
    if (back) {
      let i = before.length - 1;
      while (i >= 0 && !keep.test(before[i])) i--;
      if (i >= 0) before = before.slice(0, i) + before.slice(i + 1);
    } else {
      const i = [...after].findIndex((c) => keep.test(c));
      if (i !== -1) after = after.slice(0, i) + after.slice(i + 1);
    }
  }

  const own = !split || edit.type?.startsWith("history");
  const read = own || !mask.read ? typed(inserted) : mask.read(inserted);
  const refused = { value: prev, cursor: p };
  if (read === null) return refused;

  const formatted = mask.format(
    mask.unmask(typed(before) + read + typed(after))
  );
  const kept = [...formatted].filter((c) => keep.test(c));
  const tail_typed = typed(after);
  // an insertion never costs the field a character it already had: a dot
  // that would push "1,2|34"'s digits past the cap, or a digit typed between
  // decimals at the cap, is refused rather than dropping the last digit
  if (
    inserted &&
    kept.slice(kept.length - tail_typed.length).join("") !== tail_typed
  )
    return refused;

  // the caret goes just after the last typed character before the tail; with
  // none, in front of the tail's first one
  let n = 0;
  let pos = formatted.length;
  while (n < tail_typed.length) {
    pos--;
    if (keep.test(formatted[pos])) n++;
  }
  let caret = pos;
  while (caret > 0 && !keep.test(formatted[caret - 1])) caret--;
  if (caret === 0) {
    const first = [...formatted].findIndex((c) => keep.test(c));
    caret = first === -1 ? formatted.length : Math.min(first, pos);
  }
  return { value: formatted, cursor: caret };
}
