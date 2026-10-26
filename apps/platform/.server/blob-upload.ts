import { put } from "@vercel/blob";
import { upload_limits, upload_signatures } from "@/constants/upload";
import { blob as blob_env } from "./env";

/** extensions per accepted type, the shape of `upload_limits.types` */
export type UploadTypes = Record<string, readonly string[]>;

/** the photo types: none of them a document, none of them script-bearing */
export const IMAGE_TYPES: UploadTypes = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

/** where user uploads live. The build mirrors content-hashed client assets into
 * the same blob store under `assets/` (`utils/upload-client-assets.ts`), and
 * the app's html points at them, so an upload that could pick its own pathname
 * could replace a live js chunk. One prefix, applied here, keeps the two sets
 * from ever addressing the same object. */
const PREFIX = "u/";

/** the caller names the file, so treat it as a name and not a path: no
 * traversal, no separators, no leading dot. */
export const basename = (raw: string): string =>
  raw.split(/[/\\]/).pop()!.replace(/^\.+/, "").slice(0, 200);

/** a browser that can't sniff a file posts it untyped, and the client sends
 * no content-type of its own — the dropzone accepted it by extension, so the
 * extension is what's left to go on. */
export const type_of = (
  file: Blob,
  name: string,
  types: UploadTypes = upload_limits.types
): string | undefined => {
  if (file.type) {
    return Object.hasOwn(types, file.type) ? file.type : undefined;
  }
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return Object.entries(types).find(([, exts]) => exts.includes(ext))?.[0];
};

/** an svg root, after whatever prolog xml allows before it: processing
 * instructions, comments, doctype (with an internal subset). a linear scan —
 * a regex over repeated comments backtracks exponentially. */
const opens_svg = (text: string): boolean => {
  let i = 0;
  const skip_ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  /** index past `end`, or -1 when it never closes */
  const past = (end: string, from: number) => {
    const j = text.indexOf(end, from);
    return j < 0 ? -1 : j + end.length;
  };
  skip_ws();
  for (;;) {
    if (text.startsWith("<?", i)) i = past("?>", i + 2);
    else if (text.startsWith("<!--", i)) i = past("-->", i + 4);
    else if (text.startsWith("<!DOCTYPE", i)) {
      const close = text.indexOf(">", i);
      const subset = text.indexOf("[", i);
      const has_subset = subset >= 0 && (close < 0 || subset < close);
      const from = has_subset ? past("]", subset) : i;
      i = from < 0 ? -1 : past(">", from);
    } else break;
    if (i < 0) return false;
    skip_ws();
  }
  return text.startsWith("<svg", i) && /[\s/>]/.test(text[i + 4] ?? "");
};

/** what the bytes are, never what the caller says they are */
export const sniff = async (file: Blob): Promise<string | undefined> => {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const signed = Object.entries(upload_signatures).find(([, sig]) =>
    sig.every((b, i) => b === null || head[i] === b)
  );
  if (signed) return signed[0];
  // the decoder drops a leading BOM
  const text = new TextDecoder().decode(head);
  return opens_svg(text) ? "image/svg+xml" : undefined;
};

/** stores a checked file under `u/`; `type` is what `sniff` confirmed */
export const store_upload = (name: string, file: Blob, type: string) =>
  put(`${PREFIX}${name}`, file, {
    access: "public",
    // otherwise put derives it from the name's extension; `type` is what the
    // bytes were checked to be
    contentType: type,
    // the two together are what stop one upload from overwriting another's —
    // the caller's filename is not unique and is not ours to trust
    addRandomSuffix: true,
    allowOverwrite: false,
    token: blob_env.read_write_token,
  });
