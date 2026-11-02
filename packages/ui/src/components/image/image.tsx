import type React from "react";
import {
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ContentLoader } from "../content-loader";
import { ImagePlaceholder } from "./image-placeholder";

type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  isSrcLoading?: boolean;
  render?: (img: ReactNode) => ReactElement;
};

export function Image({
  alt = "",
  className,
  isSrcLoading,
  render,
  onError,
  ref: forwarded_ref,
  ...props
}: ImageProps & { ref?: Ref<HTMLImageElement> }) {
  const ref = useRef<HTMLImageElement>(null);
  // the src that failed, not a flag: a new src gets its own attempt
  const [failed_src, set_failed_src] = useState<string>();
  const is_error = !!props.src && failed_src === props.src;

  // https://legacy.reactjs.org/docs/hooks-reference.html#useimperativehandle
  useImperativeHandle<HTMLImageElement | null, HTMLImageElement | null>(
    forwarded_ref,
    () => ref.current
  );

  // a src that fails before hydration fires its error event before react has
  // attached onError, so the browser's broken-image glyph would stay. a settled
  // image with no intrinsic width may be that failure, read after the fact — or
  // a viewBox-only svg, which firefox reports the same way. decode() rejects
  // only for the broken one.
  useEffect(() => {
    const img = ref.current;
    const src = props.src;
    if (!src || onError || !img) return;
    if (!img.complete || img.naturalWidth > 0) return;
    let live = true;
    img.decode().catch(() => {
      if (live) set_failed_src(src);
    });
    return () => {
      live = false;
    };
  }, [props.src, onError]);

  if ((!props.src && !isSrcLoading) || is_error) {
    const placeholder = <ImagePlaceholder classes={className} />;
    return render ? render(placeholder) : placeholder;
  }

  /**
   *
   * Using `ref.current.complete` instead of some internal `is_loading` state to check if image
   * was already loaded as it maintains state on re-render.
   *
   * Were we to use some `is_loading` state, then `Image` would flicker on every render.
   *
   * Explanation for the flicker:
   * 1. Let's assume the image was already loaded and rendered, but the user navigated away from
   *    the page/component that displayed it.
   * 2. The user decides to navigate back to the page/component with the loaded image.
   * 3. As the default `is_loading` state is `true`, the `img` component is hidden and
   *    `ContentLoader` component is displayed.
   * 4. As  the image is already loaded and cached, the `img.onLoad` triggers immediately and
   *    updates `is_loading` to `false` triggering a new render
   * 5. Component `Image` flickers as it transitions from displaying `ContentLoader` to displaying `img`
   *
   */
  const is_loading = !ref.current?.complete && isSrcLoading;
  const commonClasses = `${className} ${is_loading ? "hidden" : ""}`;

  return (
    <>
      {is_loading && <ContentLoader className={className} />}
      {/**
       *
       * Setting the logic to add `hidden` class name is necessary on both
       * `WithLink` wrapper and on the child `img`.
       *
       * Reason:
       * if no `href` was passed, that means only the image would be returned and since
       * it is returned without a wrapper, we need to apply `hidden` className manually.
       * Otherwise (if `href` was passed), we need to apply `hidden` to the link component
       * wrapping the `img`.
       *
       */}

      {render?.(
        <img
          ref={ref}
          {...props}
          className={`object-contain ${commonClasses}`}
          alt={alt}
          onError={(e) => (onError ? onError(e) : set_failed_src(props.src))}
        />
      ) || (
        <img
          ref={ref}
          {...props}
          className={`object-contain ${commonClasses}`}
          alt={alt}
          onError={(e) => (onError ? onError(e) : set_failed_src(props.src))}
        />
      )}
    </>
  );
}
