import { ArrowUpFromLine, LoaderCircle } from "lucide-react";
import type { FileOutput } from "./types";

interface Props {
  value: FileOutput | undefined;
  /** shown in the size-rejection text so the limit is stated where it is broken */
  mbLimit: number;
}

/** the last path segment of a stored url, percent-decoded. the drop area shows
 * this rather than the whole url: the url is long, unreadable, and — before the
 * link moved out of the drop area — was also the button's accessible name. */
export function file_name(url: string): string {
  const last = url.split("?")[0].split("/").pop() || url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function DropzoneText({ value, mbLimit }: Props) {
  if (value == null || value === "") {
    return (
      <div className="grid justify-items-center text-sm text-gray-11 select-none">
        <ArrowUpFromLine className="mb-5 icon-xl" />
        <p className="font-semibold mb-1">Upload file</p>
        <span>Click to Browse or Drag &amp; Drop</span>
      </div>
    );
  }
  if (value === "loading") {
    return (
      <div className="grid place-items-center">
        <LoaderCircle className="text-gray-11 animate-spin" />
      </div>
    );
  }
  // the three error codes are `value`s like any other, and must not fall
  // through to the url branch, where they render as a link to `href="invalid-type"`.
  // they say what went wrong; the field error below says the field is invalid.
  if (value === "invalid-type") {
    return (
      <p className="text-sm text-center px-4">Not an accepted file type</p>
    );
  }
  if (value === "exceeds-size") {
    return <p className="text-sm text-center px-4">Larger than {mbLimit} MB</p>;
  }
  if (value === "failure") {
    return (
      <p className="text-sm text-center px-4">
        Upload failed — click to try again
      </p>
    );
  }

  return (
    <p className="text-sm text-center px-4 break-all">{file_name(value)}</p>
  );
}
