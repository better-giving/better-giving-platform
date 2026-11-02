import type { ImageMIMEType } from "@better-giving/ui";
import type { FieldValues, Path, PathValue } from "react-hook-form";
import { notValue, pipe, string } from "valibot";
import { $req } from "@/schemas";

type Classes = { container?: string; dropzone?: string };

const errors = {
  invalid_type: "invalid-type",
  exceeds_size: "exceeds-size",
  failure: "failure",
} as const;

type ImgErr = (typeof errors)[keyof typeof errors];

/**
 * every value of `ImgOutput` that is a status rather than a url. derived from
 * `errors` so a sentinel added there can't silently become a background url.
 */
export const sentinels: string[] = [...Object.values(errors), "loading"];

export const img_output = ({ required = false } = {}) =>
  pipe(
    required ? $req : string(),
    notValue(errors.invalid_type, "invalid file type"),
    notValue(errors.exceeds_size, "exceeds file size limit"),
    notValue(errors.failure, "failed to upload")
  );

export type ImgOutput = "loading" | ImgErr | (string & {});

export interface ImgSpec {
  type: ImageMIMEType[];
  aspect: [number, number];
  rounded?: boolean;
  /** in bytes */
  max_size?: number;
}

export type Props<T extends FieldValues, K extends Path<T>> = {
  // we get common props with this intersection,
  // which are only props from T
  // (Path<T> returns all possible paths through T)
  name: PathValue<T, K> extends ImgOutput ? K : never;
  classes?: Classes;
  spec: ImgSpec;
};

/** what a form library gets to focus. RHF only ever calls `.focus()`, and
 * without a handle exposing one it skips the field entirely on an invalid
 * submit — the register-time `_f.ref` placeholder has no focus method. */
export type ImgEditorHandle = { focus: () => void };

export interface ControlledProps extends Omit<Props<any, any>, "name"> {
  ref?: React.Ref<ImgEditorHandle>;
  /** the file input's id — what the caller's caption `<label htmlFor>` points at */
  id?: string;
  value: ImgOutput;
  /** optional: also run some validation */
  on_change: (value: ImgOutput) => void;
  on_undo: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  classes?: Classes;
  disabled?: boolean;
  error?: string;
  /** help text under the dropzone — what the crop does to the image shown */
  hint?: string;
}
