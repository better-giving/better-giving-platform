// the payment element's controller iframe is also named `__privateStripeFrame`
// and served from js.stripe.com. that name alone is not a challenge.
const CHALLENGE =
  /three-ds-2-challenge|three-d-secure|linked-accounts|financial-connections/i;

function is_challenge_frame(frame: HTMLIFrameElement): boolean {
  const fields = [
    frame.getAttribute("src"),
    frame.getAttribute("name"),
    frame.getAttribute("id"),
    frame.getAttribute("title"),
  ];
  return fields.some(
    (value) => value != null && value !== "" && CHALLENGE.test(value)
  );
}

function is_challenge_root(node: Element): boolean {
  if (node instanceof HTMLIFrameElement) return is_challenge_frame(node);
  for (const frame of node.querySelectorAll("iframe")) {
    if (is_challenge_frame(frame)) return true;
  }
  return false;
}

function event_target_node(event: Event): Node | null {
  const target = event.target;
  return target instanceof Node ? target : null;
}

/**
 * while a dialog is open, a 3ds / financial-connections frame stripe
 * appends to `document.body` stays a body child. the dialog box is translated,
 * and that transform is the containing block for `position: fixed`, so moving
 * the frame into the dialog clips a viewport-sized overlay to the box.
 *
 * `pointer-events: none` on `body` is inherited by a later sibling, so the
 * frame needs its own `pointer-events: auto`. `on_present` flips only when a
 * matching body child appears or leaves; the dialog uses that to ignore
 * escape and scrim clicks. those two are read when the event fires.
 *
 * the focus trap is not. `@zag-js/dialog` runs `trapFocus` on entering open
 * and does not run it again when the prop changes, so the trap stays armed.
 * the keydown listener is what keeps tab from being wrapped away from the
 * frame.
 */
export function watch_stripe_challenge(
  on_present: (present: boolean) => void
): () => void {
  const body = document.body;
  const held = new Set<HTMLElement>();
  let present = false;

  const publish = () => {
    const next = held.size > 0;
    if (next === present) return;
    present = next;
    on_present(next);
  };

  const release = (node: HTMLElement) => {
    if (!held.delete(node)) return;
    node.style.pointerEvents = "";
    publish();
  };

  const claim = (node: Element) => {
    if (!(node instanceof HTMLElement)) return;
    if (held.has(node) || node.parentElement !== body) return;
    if (!is_challenge_root(node)) return;
    node.style.pointerEvents = "auto";
    held.add(node);
    publish();
  };

  const inside = (event: Event) => {
    const target = event_target_node(event);
    if (!target) return false;
    for (const node of held) {
      if (node === target || node.contains(target)) return true;
    }
    return false;
  };

  const on_focus = (event: FocusEvent) => {
    if (inside(event)) event.stopPropagation();
  };
  // window capture runs before zag's document capture listener, which
  // preventDefaults Tab and wraps it inside the dialog. stopping every Tab
  // while a challenge is up leaves the browser's own order, so the frame
  // appended after the dialog is reachable. a keydown inside a cross-origin
  // frame never arrives here.
  const on_key = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || held.size === 0) return;
    event.stopPropagation();
  };

  window.addEventListener("focusin", on_focus, true);
  window.addEventListener("keydown", on_key, true);

  const scan = () => {
    for (const node of [...held]) {
      if (
        !node.isConnected ||
        node.parentElement !== body ||
        !is_challenge_root(node)
      ) {
        release(node);
        continue;
      }
      // stripe wipes the inline value after the frame mounts. the frame
      // then inherits `pointer-events: none` from body and stops taking clicks.
      if (node.style.pointerEvents !== "auto")
        node.style.pointerEvents = "auto";
    }
    for (const child of body.children) claim(child);
  };

  // childList sees a frame appended with its src already set. a src, name,
  // id, or title that lands afterwards is an attribute record — being added
  // is not itself a match.
  const observer = new MutationObserver(scan);
  observer.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "name", "id", "title", "style"],
  });
  scan();

  return () => {
    observer.disconnect();
    window.removeEventListener("focusin", on_focus, true);
    window.removeEventListener("keydown", on_key, true);
    for (const node of [...held]) release(node);
  };
}
