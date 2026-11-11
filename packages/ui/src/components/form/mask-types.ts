export interface IMask {
  /** raw string → display string */
  format: (raw: string) => string;
  /** display string → raw string */
  unmask: (masked: string) => string;
  /** which characters of the display string the user typed (default: digits).
   * the caret is kept after the same count of them, so characters the mask
   * inserts — a comma, a dash — never pull it. */
  keep?: RegExp;
  /** an edit that would cost the value a typed character it was given is
   * refused, not cut (a money amount: a cut is a different number). a mask that
   * stops at a length on purpose, like an ein, leaves this off. */
  lossless?: boolean;
  /** how text the user types or pastes is read before it joins the value —
   * the field's own characters around it never go through this. `typed` is
   * true for a keystroke (or a finished IME composition), false for a paste,
   * drop or autofill. `null` refuses the edit. default: as typed. */
  read?: (text: string, typed: boolean) => string | null;
  /** the mask for an edit whose own text — the field's typed characters
   * either side of what the user put in — is `own`. default: this mask. */
  fit?: (own: string) => IMask;
}
