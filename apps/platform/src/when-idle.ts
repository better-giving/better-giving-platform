/** runs `fn` once the page has finished loading and the main thread is idle.
 *
 * third-party scripts and the consent banner used to start as soon as react
 * hydrated, on a phone that is while the first view's images, fonts and
 * modules are still arriving. waiting for `load` keeps them out of that
 * window; one idle callback per call spreads their parse and run cost over
 * separate tasks instead of one long one. `timeout` bounds the wait, so
 * nothing is skipped — a script only starts later, never not at all. */
export function when_idle(fn: () => void, timeout = 2000) {
  const run = () => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(fn, { timeout });
    } else {
      setTimeout(fn, 1);
    }
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}
