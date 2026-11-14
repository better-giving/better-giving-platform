import { BLOB_STORE_HOST } from "#/constants/urls";
import { DOC_PREFIX } from "./blob-upload";
import { blob, blob_private } from "./env";
import { doc_holders, is_npo_member } from "./pg/queries/doc-holders";

/** where a stored document reference points */
export type DocSource = "private" | "legacy";

/** the host of the store a read-write token belongs to. a token reads
 * `vercel_blob_rw_<store id>_<secret>`, which is how `@vercel/blob` finds it;
 * hostnames compare lowercased. */
const store_host = (
  token: string | undefined,
  access: "private" | "public"
) => {
  const id = token?.split("_")[3]?.toLowerCase();
  return id ? `${id}.${access}.blob.vercel-storage.com` : undefined;
};

/** a stored reference is a url into our private store (under `docs/`) or an
 * older url in one of our public stores. anything else is no document of ours,
 * so nothing is ever fetched from it — and the store token is never sent to it. */
export const doc_source = (
  ref: string
): { source: DocSource; path: string } | undefined => {
  let u: URL;
  let path: string;
  try {
    u = new URL(ref);
    path = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  // records hold the bare url, and holders are matched on the exact string: a
  // query or fragment would pass the folder check below with no holder found
  if (u.search || u.hash) return undefined;
  // an encoded dot segment decodes past the url parser's own normalising
  if (path.split("/").some((s) => s === "." || s === "..")) return undefined;
  // the local blob emulator the verification stub runs stands in for the store
  const emulator = process.env.VERCEL_BLOB_API_URL;
  const private_host =
    (u.protocol === "https:" &&
      u.hostname === store_host(blob_private.read_write_token, "private")) ||
    (!!emulator && u.origin === new URL(emulator).origin);
  if (private_host && path.startsWith(DOC_PREFIX)) {
    return { source: "private", path };
  }
  const legacy_hosts = [
    BLOB_STORE_HOST,
    store_host(blob.read_write_token, "public"),
  ];
  if (u.protocol === "https:" && legacy_hosts.includes(u.hostname)) {
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
  if (viewer.role === "admin" && held) return true;
  if (h.reg_owners.includes(viewer.email)) return true;
  if (await is_npo_member(viewer.id, h.npo_ids)) return true;
  // only until a record holds it: after that, who may open it is the record's
  // call, and an uploader no longer on the nonprofit is not on it
  return !held && path.startsWith(own_folder(viewer.id));
}

/** where a user's own uploads land: `store_doc` files them by uploader */
const own_folder = (user_id: string) => `${DOC_PREFIX}${user_id}/`;

/** whether `writer_id` may put `next` in a document field now holding
 * `stored`: the value already there (which keeps a url from before documents
 * went private), or a private document the writer uploaded. a record naming
 * anyone else's upload would make the writer its holder, and `/api/docs` would
 * serve it to them. */
export const may_store_doc = (
  writer_id: string,
  next: string,
  stored: string | null | undefined
): boolean => {
  if (next === stored) return true;
  const src = doc_source(next);
  return (
    src?.source === "private" && src.path.startsWith(own_folder(writer_id))
  );
};

/** the registration fields that hold an uploaded document */
export const REG_DOC_FIELDS = [
  "r_proof_of_identity",
  "o_proof_of_reg",
  "o_bank_statement",
] as const;

/** what a writer is told when a document url fails `may_store_doc`. only a
 * hand-made request, or a page left open from before documents went private,
 * posts one. */
export const FOREIGN_DOC = "Upload the document again, then save.";
