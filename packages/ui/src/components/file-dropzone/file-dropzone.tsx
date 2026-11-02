import { FileUpload, useFileUpload } from "@ark-ui/react/file-upload";
import type { ReactNode, Ref } from "react";
import { useId, useImperativeHandle, useRef, useState } from "react";
import { ExtLink } from "../ext-link";
import { DropzoneText, file_name } from "./dropzone-text";
import type { FileOutput, FileSpec } from "./types";

interface Props {
  label?: ReactNode;
  /** accessible name of the drop area, derived from the visible label at the
   * call site. required: zag's generic "dropzone" only reads unambiguously
   * when the form holds a single one. */
  dropzone_name: string;
  value: FileOutput;
  onChange: (val: FileOutput) => void;
  disabled?: boolean;
  classes?: string;
  specs: FileSpec;
  error?: string;
  /** hands the accepted file to the app's upload endpoint and resolves to the
   * stored url. injected: the endpoint is the app's, not the design system's. */
  upload: (file: File) => Promise<string>;
  /** where a failed upload goes (sentry, a logger). required: `onChange("failure")`
   * is the user-visible outcome, so without this a failed upload is silent to
   * everyone but the donor in front of it. */
  report_error: (err: unknown) => void;
}
/** what a form library gets to focus. the drop area is the control — it is
 * `role="button"`, named, and paints the ring; the hidden input is
 * `aria-hidden` by zag's own design and announces nothing. */
type El = Pick<HTMLElement, "focus">;

const states = ["loading", "invalid-type", "exceeds-size", "failure"];
/** a `value` that is a stored url rather than one of the machine's own states */
const is_url = (v: FileOutput) => !!v && !states.includes(v);

export function FileDropzone({ ref, ...props }: Props & { ref?: Ref<El> }) {
  const [file, setFile] = useState<File>();
  const root_ref = useRef<HTMLDivElement>(null);
  const dropzone_ref = useRef<HTMLDivElement>(null);
  const error_id = useId();

  useImperativeHandle(
    ref,
    () => ({
      // the root scrolls, not the drop area: scroll-mt-24 lives there and clears
      // the sticky header, and it carries the label the drop area is named for
      focus: () => {
        dropzone_ref.current?.focus({ preventScroll: true });
        // "start", not "nearest": nearest no-ops when the field is already
        // partly in view, which is the case scroll-mt-24 exists to correct
        root_ref.current?.scrollIntoView({ block: "start" });
      },
    }),
    []
  );

  // uploading is `aria-busy`, not `disabled`. routing it through zag's
  // `disabled` strips the drop area's tabIndex mid-interaction, so the
  // element the user had just activated left the tab order and focus fell to
  // <body>. zag offers no busy state — `readOnly` and `disableClick` drop
  // tabIndex too (and `disableClick` swaps role=button for role=application) —
  // so the machine is left alone and the window is guarded here instead.
  const busy = props.value === "loading";

  const handle_accept = async (files: File[]) => {
    if (busy) return;
    const f = files[0];
    if (!f) return;
    setFile(f);
    try {
      props.onChange("loading");
      const url = await props.upload(f);
      props.onChange(url);
    } catch (err) {
      props.report_error(err);
      props.onChange("failure");
    } finally {
      // zag keeps the accepted File and rejects an identical re-pick as
      // FILE_EXISTS — and fires that rejection only when it differs from the
      // last one, so a held file swallows every repeat after the first. holding
      // nothing makes each pick a fresh accept. the clear re-enters here with
      // `[]`, which the `!f` guard above absorbs.
      api.clearFiles();
    }
  };

  // the machine's own File is the best name; a value restored from the server
  // arrives as a url with no File behind it, and a bare "loading" has neither
  const subject =
    file?.name || (is_url(props.value) ? file_name(props.value) : "") || "file";
  // one polite region for every transition, always mounted with only its text
  // changing — an element inserted at the same moment as its text is announced
  // unreliably. it sits outside the drop area so it is a status rather than
  // part of the button's name. rejection is polite too, not assertive: it only
  // ever lands right after the user's own action, with nothing else speaking.
  const status = busy
    ? `Uploading ${subject}`
    : props.value === "invalid-type"
      ? `Rejected ${subject}: not an accepted file type`
      : props.value === "exceeds-size"
        ? `Rejected ${subject}: larger than ${props.specs.mbLimit} MB`
        : props.value === "failure"
          ? `Upload failed for ${subject}`
          : is_url(props.value)
            ? `Uploaded ${subject}`
            : "";

  const api = useFileUpload({
    translations: { dropzone: props.dropzone_name },
    accept: props.specs.mimeTypes,
    maxFileSize: props.specs.mbLimit * 1e6,
    maxFiles: 1,
    disabled: props.disabled,
    allowDrop: !busy,
    invalid: !!props.error,
    onFileAccept: (d) => handle_accept(d.files),
    onFileReject: (d) => {
      if (busy) return;
      const f = d.files[0];
      if (f) setFile(f.file);
      const codes = f?.errors ?? [];
      if (codes.includes("FILE_INVALID_TYPE")) {
        return props.onChange("invalid-type");
      }
      if (codes.includes("FILE_TOO_LARGE")) {
        return props.onChange("exceeds-size");
      }
    },
  });

  return (
    <FileUpload.RootProvider
      value={api}
      ref={root_ref}
      className={`${props.classes ?? ""} scroll-mt-24`}
    >
      {props.label}
      <p className="text-sm text-gray-11 mb-2">
        Valid types are:{" "}
        {props.specs.mimeTypes
          .map((m) => m.split("/")[1].toUpperCase())
          .join(", ")}
        . File should be less than {props.specs.mbLimit} MB{" "}
      </p>
      <FileUpload.Dropzone
        ref={dropzone_ref}
        // describedby, not invalid/errormessage: neither is global in ARIA 1.2
        // and role="button" supports neither, so both were inert here. the
        // destructive border comes from zag's data-invalid off `invalid` above.
        aria-describedby={props.error ? error_id : undefined}
        aria-busy={busy || undefined}
        // zag's own click/keydown handlers bail on a defaultPrevented event, so
        // this is the machine's documented way to refuse an activation without
        // taking the element out of the tab order
        onClickCapture={(ev) => {
          if (busy) ev.preventDefault();
        }}
        onKeyDownCapture={(ev) => {
          if (busy) ev.preventDefault();
        }}
        className={`relative grid place-items-center rounded border border-dashed border-gray-7 w-full h-45.5 cursor-pointer
          bg-surface
          focus-within:outline-2 data-dragging:outline-2 outline-ring
          hover:bg-secondary-hover
          aria-busy:bg-gray-3 aria-busy:cursor-progress aria-busy:hover:bg-gray-3
          data-disabled:bg-gray-3 data-disabled:pointer-events-none data-disabled:outline-0
          data-invalid:border-destructive
          `}
      >
        <FileUpload.HiddenInput />
        <DropzoneText
          value={props.value || file}
          mbLimit={props.specs.mbLimit}
        />
      </FileUpload.Dropzone>

      {/* outside the drop area on purpose: nested inside, this anchor was a
          focusable link inside a role="button" — in the tab order, and folded
          into the button's accessible name, so the button announced a url. */}
      {is_url(props.value) && (
        <ExtLink href={props.value} className="text-sm link mt-1 inline-block">
          View uploaded file
        </ExtLink>
      )}

      <span role="status" className="sr-only">
        {status}
      </span>

      <span id={error_id} className="field-err mt-1 empty:hidden">
        {props.error}
      </span>
    </FileUpload.RootProvider>
  );
}
