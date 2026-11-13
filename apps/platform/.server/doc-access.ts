import { DOC_PREFIX } from "./blob-upload";
import { doc_holders, is_npo_member } from "./pg/queries/doc-holders";

/** where a stored document reference points */
export type DocSource = "private" | "legacy";

/** a stored reference is a url into the private store (under `docs/`) or an
 * older url in the original store. anything else is no document of ours, so
 * nothing is ever fetched from it. */
export const doc_source = (
  ref: string
): { source: DocSource; path: string } | undefined => {
  let u: URL;
  try {
    u = new URL(ref);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const path = decodeURIComponent(u.pathname.replace(/^\//, ""));
  // an encoded dot segment decodes past the url parser's own normalising
  if (path.split("/").some((s) => s === "." || s === "..")) return undefined;
  // the local blob emulator the verification stub runs stands in for the store
  const emulator = process.env.VERCEL_BLOB_API_URL;
  const private_host =
    u.hostname.endsWith(".private.blob.vercel-storage.com") ||
    (!!emulator && u.origin === new URL(emulator).origin);
  if (private_host && path.startsWith(DOC_PREFIX)) {
    return { source: "private", path };
  }
  if (
    u.protocol === "https:" &&
    u.hostname.endsWith(".public.blob.vercel-storage.com")
  ) {
    return { source: "legacy", path };
  }
  return undefined;
};

interface IViewer {
  id: string;
  email: string;
  role?: string | null;
}

/** whether the viewer may open the document `ref` names:
 * - Better Giving staff (`role: "admin"`), for any document a record holds
 * - the registrant, for the documents on their own registration
 * - a nonprofit's own admins, for its banking applications' statements
 * - the uploader, for a private document nothing holds yet (their own folder)
 */
export async function can_read_doc(
  viewer: IViewer,
  ref: string,
  path: string
): Promise<boolean> {
  const h = await doc_holders(ref);
  const held = h.reg_owners.length > 0 || h.npo_ids.length > 0;
  if (viewer.role === "admin") return held;
  if (h.reg_owners.includes(viewer.email)) return true;
  if (await is_npo_member(viewer.id, h.npo_ids)) return true;
  return path.startsWith(`${DOC_PREFIX}${viewer.id}/`);
}
