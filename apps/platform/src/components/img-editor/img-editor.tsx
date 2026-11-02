import { Image, use_ask } from "@better-giving/ui";
import { unpack } from "@better-giving/ui/helpers";
import { ArrowUpFromLine, Crop, Undo } from "lucide-react";
import type React from "react";
import { useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { report_error } from "#/errors/report";
import { uploadFile } from "#/helpers/upload-file";
import { humanize } from "@/helpers/decimal";
import { AspectTooltip } from "./aspect-tooltip";
import { type IImgCropperProps, ImgCropper } from "./img-cropper";
import { type ControlledProps, sentinels } from "./types";

const BYTES_IN_MB = 1e6;

export function ImgEditor({ ref, id, ...props }: ControlledProps) {
  const ask = use_ask();
  const fallback_id = useId();
  const input_id = id ?? fallback_id;
  const hint_id = `${input_id}-hint`;
  const crop_hint_id = `${input_id}-crop-hint`;
  const error_id = `${input_id}-error`;
  const described_by = [
    hint_id,
    props.hint && crop_hint_id,
    props.error && error_id,
  ]
    .filter(Boolean)
    .join(" ");
  const [file, setFile] = useState<File>();
  const [drag_active, set_drag_active] = useState(false);
  const root_ref = useRef<HTMLDivElement>(null);
  const dropzone_ref = useRef<HTMLDivElement>(null);
  const input_ref = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        // the file input is the control, but an upload in flight disables it
        // and focus() is then a no-op. read the outcome back rather than
        // predict it, and fall back to the dropzone, so focus-on-error never
        // lands nowhere.
        // the dropzone and not the root: it is what paints the ring, so the
        // fallback is visible rather than a silent scroll to an unmarked field.
        input_ref.current?.focus({ preventScroll: true });
        const dropzone = dropzone_ref.current;
        if (document.activeElement !== input_ref.current && dropzone) {
          // after a mouse submit this focus is not :focus-visible, so the
          // ring would not paint; the attribute paints it until blur
          dropzone.dataset.focusError = "";
          dropzone.focus({ preventScroll: true });
        }
        // "start", not "nearest": nearest no-ops when the field is already
        // partly in view, which is the case scroll-mt-24 exists to correct
        root_ref.current?.scrollIntoView({ block: "start" });
      },
    }),
    []
  );

  const preview = useMemo(
    () =>
      file
        ? props.spec.type.includes(file.type as any)
          ? URL.createObjectURL(file)
          : ""
        : props.value && !sentinels.includes(props.value)
          ? props.value
          : "",
    [file, props.spec.type, props.value]
  );

  async function crop_and_upload(source: File) {
    // shown behind the cropper, and what the undo/crop controls act on
    setFile(source);

    const cropped = await ask<File, IImgCropperProps>(
      ImgCropper,
      {
        input: source,
        aspect: props.spec.aspect,
        rounded: props.spec.rounded,
      },
      // reachable from the dropzone and the crop button, neither disabled
      // while it runs — one slot keeps a double press to one cropper
      { key: "img-cropper" }
    );
    // dismissed: the staged file goes with it, so the dropzone reads empty
    if (!cropped) return setFile(undefined);

    setFile(cropped);
    if (props.spec.max_size && cropped.size > props.spec.max_size) {
      return props.on_change("exceeds-size");
    }

    try {
      props.on_change("loading");
      const url = await uploadFile(cropped);
      return props.on_change(url);
    } catch (err) {
      report_error(err);
      props.on_change("failure");
    }
  }

  const handle_files = (files: File[]) => {
    const newFile = files[0];
    if (!newFile) return;

    if (!props.spec.type.includes(newFile.type as any)) {
      //don't show cropper, render blank preview
      return props.on_change("invalid-type");
    }

    if (props.spec.max_size && newFile.size > props.spec.max_size) {
      return props.on_change("exceeds-size");
    }

    crop_and_upload(newFile);
  };

  const styles = unpack(props.classes);
  const is_loading = props.value === "loading";
  const disabled = props.disabled || is_loading;
  const overlay = `before:content-[''] before:grid before:place-items-center before:absolute before:inset-0 data-[drag="true"]:before:bg-secondary data-[loading="true"]:before:bg-secondary/90 data-[loading="true"]:before:content-['._._.'] before:text-xl before:font-bold `;

  const file_input = (
    <input
      ref={input_ref}
      id={input_id}
      type="file"
      className="sr-only"
      accept={props.spec.type.join(",")}
      disabled={disabled}
      aria-invalid={!!props.error}
      aria-describedby={described_by}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length) handle_files(files);
        e.target.value = "";
      }}
    />
  );

  return (
    <div
      ref={root_ref}
      // scroll-mt-24 clears the sticky header when the handle scrolls here
      className={`${styles.container} grid w-full min-w-0 max-w-full grid-rows-[1fr_auto] scroll-mt-24`}
    >
      <p className="text-sm text-gray-11 mb-2 min-w-0 break-words">
        <span id={hint_id}>
          Valid types are:{" "}
          {props.spec.type
            .map((m) => m.split("/")[1].toUpperCase().replace(/\+xml/gi, ""))
            .join(", ")}
          .{" "}
          {props.spec.max_size ? (
            <>
              Image should be less than {props.spec.max_size / BYTES_IN_MB}MB in
              size.
              <br />
              {file?.size
                ? `Current image size: ${humanize(file.size / BYTES_IN_MB)}MB.`
                : ""}
            </>
          ) : (
            ""
          )}
        </span>{" "}
        <AspectTooltip aspect={props.spec.aspect} />
      </p>
      {/* a div, not a <label> around the input: a wrapping label names the
          input from its whole subtree, which would read the undo/crop buttons'
          names into it. keyboard users reach the input itself, so the click is
          pointer-only convenience. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the input inside is the keyboard path */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same — the click only forwards to the input */}
      <div
        ref={dropzone_ref}
        // -1: never in the tab order, but focusable as the handle's fallback
        // target. a mouse press focuses it too, so the ring and the controls
        // key off :focus-visible, never :focus — or a click leaves both painted
        // over the preview after the pointer has gone
        tabIndex={-1}
        onBlur={(e) => {
          if (e.target === e.currentTarget)
            delete e.currentTarget.dataset.focusError;
        }}
        data-loading={is_loading}
        data-invalid={!!props.error}
        data-drag={drag_active}
        data-disabled={disabled}
        onClick={(e) => {
          const target = e.target as Element;
          // the forwarded click bubbles back here; buttons act for themselves
          if (target === input_ref.current || target.closest("button")) return;
          input_ref.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) set_drag_active(true);
        }}
        onDragLeave={() => set_drag_active(false)}
        onDrop={(e) => {
          e.preventDefault();
          set_drag_active(false);
          if (disabled) return;
          const files = Array.from(e.dataTransfer.files);
          if (files.length) handle_files(files);
        }}
        className={`relative isolate min-w-0 max-w-full ${overlay} ${styles.dropzone} group rounded border border-dashed border-gray-7 bg-surface cursor-pointer
          focus-visible:outline-2 has-focus-visible:outline-2 data-[focus-error]:outline-2 data-[drag="true"]:outline-2 outline-ring
          hover:bg-secondary-hover
          data-[disabled="true"]:bg-gray-3 data-[disabled="true"]:pointer-events-none
          data-[invalid="true"]:border-destructive
          `}
      >
        {/* an <img> rather than a background so a url that fails to load
            shows the placeholder instead of an empty box; -z-10 inside the
            isolated dropzone keeps it under the drag/loading overlay */}
        {preview && (
          <Image
            src={preview}
            className="absolute inset-0 -z-10 size-full object-cover rounded"
          />
        )}
        {!preview ? (
          <div
            className="absolute-center relative grid justify-items-center text-sm text-gray-11 select-none"
            tabIndex={-1}
          >
            {file_input}
            <ArrowUpFromLine className="mb-5 icon-xl" />
            {/* pointer-only instructions: a keyboard user is on the input,
                which the caller's caption names and the hint describes */}
            <p aria-hidden className="font-semibold mb-1">
              Upload file
            </p>
            <span aria-hidden className="text-center">
              Click to Browse or Drag &amp; Drop
            </span>
          </div>
        ) : (
          /** something is uploaded and would disrupt text above
           *  so just show upload icon instead of it.
           */
          // sr-only at rest, not `hidden`: display:none takes the input and
          // buttons out of the tab order, so focus could never reveal them.
          // only where the device can hover — a touch screen has no hover to
          // reveal them with, so there they always show
          <div className="absolute-center flex [@media(hover:hover)]:not-group-hover:not-group-has-focus-visible:sr-only">
            <div className={buttonStyle}>
              {file_input}
              <ArrowUpFromLine className="icon-md" />
            </div>
            {
              /** only show controls if new file is uploaded */
              (file || props.value === "invalid-type") && !is_loading && (
                <IconButton
                  aria-label="Undo image change"
                  disabled={props.disabled}
                  onClick={(e) => {
                    setFile(undefined);
                    props.on_undo(e);
                  }}
                >
                  <Undo className="icon-lg" />
                </IconButton>
              )
            }
            {file && !props.error && (
              <IconButton
                aria-label="Crop image"
                onClick={(e) => {
                  e.stopPropagation();
                  crop_and_upload(file);
                }}
                disabled={props.disabled}
              >
                <Crop className="icon-md" />
              </IconButton>
            )}
          </div>
        )}
      </div>

      {props.hint && (
        <p
          id={crop_hint_id}
          className="text-sm text-gray-11 mt-2 min-w-0 break-words"
        >
          {props.hint}
        </p>
      )}

      {/* always mounted: a message raised by picking a file is announced as
          a change, which a region inserted with its text is not reliably */}
      <span
        id={error_id}
        aria-live="polite"
        className="empty:hidden text-destructive-subtle-fg text-xs mt-1"
      >
        {props.error}
      </span>
    </div>
  );
}

const buttonStyle =
  "text-primary-fg text-lg bg-primary hover:bg-primary/80 disabled:bg-gray-3 disabled:text-gray-11 p-2 m-1 rounded";
function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" className={buttonStyle} />;
}
