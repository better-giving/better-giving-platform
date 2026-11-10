import type { IMask } from "./mask-types";

const digit = /\d/;

/** full-width digits and punctuation (an IME's default mode) to ascii by NFKC;
 * arabic-indic digits, which NFKC leaves alone, by hand */
function fold(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, ".");
}

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
  const text = fold(inserted);
  const read =
    own || !mask.read
      ? typed(text)
      : mask.read(text, edit.type === "insertText");
  const refused = { value: prev, cursor: p };
  if (read === null) return refused;

  const around = mask.fit?.(typed(before) + typed(after)) ?? mask;
  const formatted = around.format(
    around.unmask(typed(before) + read + typed(after))
  );
  const kept = [...formatted].filter((c) => keep.test(c));
  const tail_typed = typed(after);
  const tail_kept =
    kept.slice(kept.length - tail_typed.length).join("") === tail_typed;
  // an insertion never costs the field a character it already had: a dot
  // that would push "1,2|34"'s digits past the cap, or a digit typed between
  // decimals at the cap, is refused rather than dropping the last digit
  if (inserted && !tail_kept) return refused;

  // the caret goes just after the typed characters in front of the tail; with
  // none, in front of the first one. a delete can lose some of the tail too
  // (the dollar mask's "$ ,000" is "$ 0"), and then it goes after as many as
  // the edit left in front of it
  const lead = tail_kept
    ? kept.length - tail_typed.length
    : Math.min(kept.length, typed(before).length + read.length);
  let caret = 0;
  for (let n = 0; n < lead; caret++) if (keep.test(formatted[caret])) n++;
  if (lead === 0) {
    const first = [...formatted].findIndex((c) => keep.test(c));
    caret = first === -1 ? formatted.length : first;
  }
  return { value: formatted, cursor: caret };
}
