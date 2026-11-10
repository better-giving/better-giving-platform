export interface IMask {
  /** raw string → display string */
  format: (raw: string) => string;
  /** display string → raw string */
  unmask: (masked: string) => string;
  /** which characters of the display string the user typed (default: digits).
   * the caret is kept after the same count of them, so characters the mask
   * inserts — a comma, a dash — never pull it. */
  keep?: RegExp;
}
