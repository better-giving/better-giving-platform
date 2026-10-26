import { photo_too_large, upload_limits } from "@/constants/upload";
import {
  basename,
  IMAGE_TYPES,
  sniff,
  store_upload,
  type_of,
} from "../blob-upload";
import { campaign_get, campaign_update } from "../pg/queries/campaign";
import type { DbOrTx } from "../pg/queries/helpers";
import { reserve_ip } from "./gate";
import {
  consume_photo_link,
  peek_photo_link,
  release_photo_link,
} from "./photo-links";

/** what `/photo-upload/:token` shows. `gone` is one shape for an unknown,
 * malformed, expired or spent link, or one whose campaign was deleted, so the
 * page tells a guesser nothing. */
export type PhotoPage =
  | { state: "gone" }
  | { state: "limited" }
  | { state: "ready"; campaign: string; error?: string }
  | { state: "saved"; campaign: string; photo: string }
  | { state: "failed"; campaign: string };

export type PhotoResult = { page: PhotoPage; status: number };

const GONE: PhotoResult = { page: { state: "gone" }, status: 404 };

/** a multipart body's framing beside the file itself */
const MULTIPART_SLACK = 64 * 1024;

/** the live link and its campaign's name, or null */
async function open_link(db: DbOrTx, token: string) {
  const link = await peek_photo_link(db, token);
  if (!link) return null;
  const campaign = await campaign_get(link.npo_id, link.campaign_id);
  return campaign ? { name: campaign.name } : null;
}

export async function read_photo_page(
  db: DbOrTx,
  token: string
): Promise<PhotoResult> {
  const live = await open_link(db, token);
  if (!live) return GONE;
  return { page: { state: "ready", campaign: live.name }, status: 200 };
}

/** the stored name: the upload's own stem, with the extension of the type its
 * bytes were checked to be */
function stored_name(file: File, type: string): string {
  const ext = IMAGE_TYPES[type]![0]!;
  const name = basename(file.name);
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).slice(0, 100);
  return `${stem || "campaign-photo"}${ext}`;
}

export async function save_photo(
  db: DbOrTx,
  request: Request,
  token: string
): Promise<PhotoResult> {
  // the page carries no key: the address is the only thing to charge
  if (!reserve_ip("photo_upload", request)) {
    return { page: { state: "limited" }, status: 429 };
  }
  const live = await open_link(db, token);
  if (!live) return GONE;
  const refuse = (status: number, error: string): PhotoResult => ({
    page: { state: "ready", campaign: live.name, error },
    status,
  });

  const declared = Number(request.headers.get("content-length"));
  if (declared > upload_limits.max_bytes + MULTIPART_SLACK) {
    return refuse(413, photo_too_large);
  }
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("photo");
  } catch {
    return refuse(400, "Choose a photo to upload.");
  }
  if (!(file instanceof File) || file.size === 0) {
    return refuse(400, "Choose a photo to upload.");
  }
  const type = type_of(file, basename(file.name), IMAGE_TYPES);
  if (!type) return refuse(415, "Choose a JPEG, PNG or WebP photo.");
  if (file.size > upload_limits.max_bytes) return refuse(413, photo_too_large);
  if ((await sniff(file)) !== type) {
    return refuse(
      415,
      "That file isn't the kind of image its name says. Choose a JPEG, PNG or WebP photo."
    );
  }

  const claim = await consume_photo_link(db, token);
  if (!claim) return GONE;
  try {
    const blob = await store_upload(stored_name(file, type), file, type);
    const wrote = await campaign_update(claim.npo_id, claim.campaign_id, {
      banner: blob.url,
    });
    if (wrote !== "ok") return GONE;
    return {
      page: { state: "saved", campaign: live.name, photo: blob.url },
      status: 200,
    };
  } catch (err) {
    // the link id, never the token: the token is the credential
    console.error("photo upload: save failed", { link: claim.id }, err);
    await release_photo_link(db, claim.id, claim.used_at).catch(() => false);
    return { page: { state: "failed", campaign: live.name }, status: 500 };
  }
}
