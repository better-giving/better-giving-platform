/**
 * the open/close motion every anchored popup runs — tooltip, hovercard, the
 * shared select/combo/multi-combo shell, and the app's own popups through the
 * barrel. one spelling: a popup that animates spends this, not a respelling.
 *
 * the only popup that runs the enter half alone is one that unmounts on close,
 * which never reaches `data-[state=closed]`.
 *
 * `prefers-reduced-motion` needs nothing here — the guard is on the speed
 * ladder in `styles/theme.css`, which `--animate-popup-in|out` spend.
 */
export const popup_anim =
  "origin-(--transform-origin) data-[state=open]:animate-popup-in data-[state=closed]:animate-popup-out";

/**
 * the content shell for a tooltip or hovercard. `select` and `toaster` carry
 * theirs inside their own components; this one is shared by two.
 *
 * a card on the page ink: `bg-card` + `rounded-card`, and no edge — the
 * floating layer is told from the page by `shadow-floating`, which with
 * `z-floating` is the ledger's `floating` elevation row. the arrow tip carries
 * no edge either, and is filled from `--card` by the positioner.
 *
 * the inset is the shell's (`packages/brand/design-system.md` → *A shell owns
 * its padding and radius*). a caller passes its width cap, type size and
 * alignment; never a padding, a fill or an edge. `shell-conformance` sweeps
 * for a respelling.
 */
export const popup_shell =
  "bg-card text-gray-12 shadow-floating rounded-card p-4 z-floating";
