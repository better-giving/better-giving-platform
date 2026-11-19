import { type ReactNode, useEffect, useState } from "react";

/** full literal class strings, never composed: tailwind reads source text.
 *  `field-help` is the field hint's size, ink and wrapping, reused above the
 *  field; its 4px top margin is the field's spacing, so it comes off here.
 *  empty, the note stays in the page with no height: the hint's own empty
 *  rule hides it, which would take an error's live region out with it. */
const tone_class = {
  help: "field-help mbs-0 empty:block empty:block-0 empty:overflow-clip",
  error:
    "field-help mbs-0 empty:block empty:block-0 empty:overflow-clip text-destructive-subtle-fg",
} as const;

/** one plain line of help, or an error, for a whole block or card rather than
 *  one field. help is plain text, which a card can name with
 *  `aria-describedby` through `id`. an error is a polite live region that
 *  stays mounted: its text lands a frame after the region is in the page, so
 *  an error rendered with the page is announced. a clear lands at once, so
 *  one said again after it was cleared is announced again, even with the
 *  clear and the repeat a frame apart or less; the clear has to render on
 *  its own, as one batched into the same update as the error is no change. */
export function BlockNote({
  children,
  tone = "help",
  id,
  classes = "",
}: {
  /** the text; for an error, nothing while there is none */
  children?: ReactNode;
  /** @default "help" */
  tone?: "help" | "error";
  id?: string;
  /** appended last: the note's place in the block is the caller's */
  classes?: string;
}) {
  const live = tone === "error";
  const said = useLanded(live ? children : null);
  return (
    <p
      id={id}
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      aria-atomic={live ? true : undefined}
      className={`${tone_class[tone]} ${classes}`}
    >
      {live ? said : children}
    </p>
  );
}

/** `next`, a frame after it changes: a live region announces what changes in
 *  it, not what it is born holding. an empty `next` lands at once instead, so
 *  a clear the same text follows within the frame still empties the region
 *  and the repeat is a change; only an empty `next` clears, so children of a
 *  new identity every render never blank it */
function useLanded(next: ReactNode) {
  const [landed, set_landed] = useState<ReactNode>(null);
  useEffect(() => {
    if (next == null || next === false || next === "") {
      set_landed(null);
      return;
    }
    const frame = requestAnimationFrame(() => set_landed(next));
    return () => cancelAnimationFrame(frame);
  }, [next]);
  return landed;
}
