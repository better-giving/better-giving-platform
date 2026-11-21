/** a press, a key or typing on the date field: the user is acting on it */
const USER_ACTS = [
  "pointerdown",
  "touchstart",
  "click",
  "keydown",
  "beforeinput",
  "input",
] as const;

/** how long after such an act a segment may still be focused by code: the
 * next segment after a typed digit, the first one after a label press */
const ACT_WINDOW_MS = 300;

/**
 * the date input focuses a segment from a requestAnimationFrame it armed
 * earlier, when focus first lands in it or its value is set. on a page busy
 * loading, that frame arrives late and takes focus from the field the user has
 * since moved to, so their next keystrokes land in the date. a segment's
 * `focus()` is dropped while focus is on another element of the same dialog or
 * form, unless the user has just acted on the date field itself. a call made
 * while focus is on `<body>`, or on the page behind a dialog, still goes
 * through. returns the cleanup
 */
export function guard_segment_focus(root: HTMLElement) {
  let last_act = Number.NEGATIVE_INFINITY;
  const note = () => {
    last_act = performance.now();
  };
  for (const e of USER_ACTS) root.addEventListener(e, note, true);

  const patched = new Set<HTMLElement>();
  const guard = (seg: HTMLElement) => {
    if (patched.has(seg)) return;
    patched.add(seg);
    seg.focus = (options?: FocusOptions) => {
      const active = document.activeElement;
      const scope = root.closest('[role="dialog"], form');
      const elsewhere =
        active instanceof HTMLElement &&
        active !== document.body &&
        !root.contains(active) &&
        !!scope?.contains(active);
      if (elsewhere && performance.now() - last_act > ACT_WINDOW_MS) return;
      HTMLElement.prototype.focus.call(seg, options);
    };
  };
  const guard_all = () => {
    for (const seg of root.querySelectorAll<HTMLElement>('[role="spinbutton"]'))
      guard(seg);
  };
  guard_all();
  const watch = new MutationObserver(guard_all);
  watch.observe(root, { childList: true, subtree: true });

  return () => {
    watch.disconnect();
    for (const e of USER_ACTS) root.removeEventListener(e, note, true);
    for (const seg of patched) delete (seg as { focus?: unknown }).focus;
  };
}
