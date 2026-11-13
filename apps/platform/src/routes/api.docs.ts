import type { LoaderFunction } from "react-router";
import { get_session, to_auth } from "#/.server/auth";
import { read_doc } from "$/blob-upload";
import { can_read_doc, doc_source } from "$/doc-access";

/** shown in the browser; anything else a stored file turns out to be is only
 * ever downloaded */
const INLINE = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** a miss and a refusal look the same, so the route doesn't say which
 * documents exist */
const not_found = () => new Response("not found", { status: 404 });

/** opens an uploaded document: `?ref=` is what a record stores for it.
 * signed-out callers are sent to sign in and back; a signed-in caller who may
 * not see it, or a reference that names nothing, gets a 404. */
export const loader: LoaderFunction = async ({ request, url }) => {
  const { user } = await get_session(request);
  if (!user) throw to_auth(url);

  const ref = url.searchParams.get("ref");
  const src = ref ? doc_source(ref) : undefined;
  if (!ref || !src) return not_found();
  if (!(await can_read_doc(user, ref, src.path))) return not_found();

  let body: ReadableStream<Uint8Array> | null;
  let type: string | null;
  if (src.source === "private") {
    // a url off our store reads as an error, which is the same miss
    const r = await read_doc(ref).catch(() => null);
    if (r?.statusCode !== 200) return not_found();
    body = r.stream;
    type = r.blob.contentType;
  } else {
    // a file from before documents went private: read here, for a caller
    // already checked, rather than redirected to
    const r = await fetch(ref, { redirect: "error" });
    if (!r.ok) return not_found();
    body = r.body;
    type = r.headers.get("content-type");
  }

  const mime = type?.split(";")[0]?.trim().toLowerCase() ?? "";
  const inline = INLINE.has(mime);
  return new Response(body, {
    headers: {
      "content-type": inline ? mime : "application/octet-stream",
      "content-disposition": inline ? "inline" : "attachment",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      vary: "cookie",
    },
  });
};
