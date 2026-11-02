import { ContentLoader } from "@better-giving/ui";
import { unpack } from "@better-giving/ui/helpers";
import { PortableText } from "@portabletext/react";
import { lazy, type Ref, Suspense, useEffect, useState } from "react";
import { to_document } from "./helpers";
import { pt_components } from "./pt-components";
import { pt_value } from "./pt-value";
import type { Props } from "./types";

const Editor = lazy(() => import("./editor"));

// @portabletext/editor calls useSyncExternalStore without getServerSnapshot;
// it cannot SSR. gate the lazy import behind a client-mount check so the
// fallback (not the editor) renders on the server.
function use_is_client() {
  const [c, set_c] = useState(false);
  useEffect(() => set_c(true), []);
  return c;
}

type El = Pick<HTMLDivElement, "focus">;

/** the editor is a field: the field fill and the --input edge, hovering a step
 *  up unless the edge is already saying invalid. read-only content is prose on
 *  the page and carries none of it. */
const EDITOR_EDGE =
  "rounded bg-surface border border-input hover:not-aria-invalid:border-input-hover aria-invalid:border-destructive";

export function RichText({
  classes,
  ref,
  ...props
}: Props & { ref?: Ref<El> }) {
  const style = unpack(classes);
  const is_client = use_is_client();

  const fallback = Array(10)
    .fill(null)
    .map((_, index) => (
      <ContentLoader key={index} className="mb-3 h-5 w-full" />
    ));

  return (
    <div className={style.container}>
      <div
        aria-invalid={!!props.error}
        aria-disabled={props.disabled}
        className={`relative has-focus-within:outline-2 has-focus-within:outline-ring ${props.readOnly ? "" : EDITOR_EDGE} ${style.field}`}
      >
        {props.readOnly ? (
          <PortableText
            value={pt_value(to_document(props.content.value), pt_components)}
            components={pt_components}
          />
        ) : is_client ? (
          <Suspense fallback={fallback}>
            <Editor classes={classes} ref={ref} {...props} />
          </Suspense>
        ) : (
          fallback
        )}
      </div>
      <p
        className={`empty:hidden text-destructive-subtle-fg text-xs mt-1 ${style.error}`}
      >
        {props.error}
      </p>
    </div>
  );
}
