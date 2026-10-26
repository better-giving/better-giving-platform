import { type ActionFunction, data } from "react-router";
import { nonEmpty, pipe, safeParse, string } from "valibot";
import { get_session } from "#/.server/auth";
import { upload_limits } from "@/constants/upload";
import { resp, search } from "@/helpers/https";
import { basename, sniff, store_upload, type_of } from "$/blob-upload";

export const action: ActionFunction = async ({ request }) => {
  // every surface that uploads is signed in — the img editor, the bank
  // statement field, and the fsa step. nothing else guards this route: it has
  // no parent layout.
  const { user } = await get_session(request);
  if (!user) return resp.fail(401, "Sign in to continue");

  const { filename } = search(request);
  const p = safeParse(pipe(string(), nonEmpty()), filename);
  if (p.issues) return resp.status(400, p.issues[0].message);

  const name = basename(p.output);
  if (!name) return resp.status(400, "invalid filename");

  const file = await request.blob();
  const type = type_of(file, name);
  if (!type) return resp.status(415, "unsupported file type");
  if (file.size > upload_limits.max_bytes) {
    return resp.status(413, "file too large");
  }
  if ((await sniff(file)) !== type) {
    return resp.status(415, "file content does not match its type");
  }

  const blob = await store_upload(name, file, type);

  return data({ url: blob.url });
};
