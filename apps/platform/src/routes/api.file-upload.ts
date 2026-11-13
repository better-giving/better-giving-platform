import { type ActionFunction, data } from "react-router";
import { nonEmpty, picklist, pipe, safeParse, string } from "valibot";
import { get_session } from "#/.server/auth";
import { upload_limits } from "@/constants/upload";
import { resp, search } from "@/helpers/https";
import {
  basename,
  DOC_TYPES,
  PUBLIC_IMAGE_TYPES,
  sniff,
  store_doc,
  store_upload,
  type_of,
} from "$/blob-upload";

/** what the caller says it is uploading. it picks the allowed types and the
 * store, so it is the one thing the caller is never trusted past: a document
 * is private whatever it looks like, and an image route takes no pdf. */
const kinds = ["document", "image"] as const;

export const action: ActionFunction = async ({ request, url }) => {
  // every surface that uploads is signed in — the img editor, the bank
  // statement field, and the fsa step. nothing else guards this route: it has
  // no parent layout.
  const { user } = await get_session(request);
  if (!user) return resp.fail(401, "Sign in to continue");

  const { filename, kind } = search(url);
  const k = safeParse(picklist(kinds), kind);
  if (k.issues) return resp.status(400, "unknown upload kind");

  const p = safeParse(pipe(string(), nonEmpty()), filename);
  if (p.issues) return resp.status(400, p.issues[0].message);

  const name = basename(p.output);
  if (!name) return resp.status(400, "invalid filename");

  const types = k.output === "document" ? DOC_TYPES : PUBLIC_IMAGE_TYPES;
  const file = await request.blob();
  const type = type_of(file, name, types);
  if (!type) return resp.status(415, "unsupported file type");
  if (file.size > upload_limits.max_bytes) {
    return resp.status(413, "file too large");
  }
  if ((await sniff(file)) !== type) {
    return resp.status(415, "file content does not match its type");
  }

  const blob =
    k.output === "document"
      ? await store_doc(user.id, name, file, type)
      : await store_upload(name, file, type);

  return data({ url: blob.url });
};
