import { and, eq, not } from "drizzle-orm";
import { report_error } from "#/errors/report";
import { photo_too_large, upload_limits } from "@/constants/upload";
import {
  basename,
  discard_upload,
  IMAGE_TYPES,
  sniff,
  store_upload,
  type_of,
} from "../blob-upload";
import { campaign_get, next_updated_at } from "../pg/queries/campaign";
import type { DbOrTx } from "../pg/queries/helpers";
import { campaigns } from "../pg/schema/campaign";
import { reserve_ip } from "./gate";
import {
  consume_photo_link,
  peek_photo_link,
  record_saved_photo,
  release_photo_link,
  saved_photo_link,
} from "./photo-links";
import { campaign_status, ended_sql } from "./reads";

/** what `/photo-upload/:token` shows. `gone` is one shape for an unknown,
 * malformed or expired link, a spent one that saved nothing, or one whose
 * campaign was deleted or has ended, so the page tells a guesser nothing. A
 * link that saved its photo shows it as `saved` for good. */
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

/** the live link and its campaign's name, or null when the campaign is gone or ended */
async function open_link(db: DbOrTx, token: string) {
  const link = await peek_photo_link(db, token);
  if (!link) return null;
  const campaign = await campaign_get(link.npo_id, link.campaign_id);
  if (!campaign) return null;
  if (campaign_status(campaign.status, campaign.ends_at) === "ended") {
    return null;
  }
  return { name: campaign.name };
}

/** the saved page of a link whose photo went through, or null */
async function saved_page(
  db: DbOrTx,
  token: string
): Promise<PhotoResult | null> {
  const link = await saved_photo_link(db, token);
  if (!link) return null;
  const campaign = await campaign_get(link.npo_id, link.campaign_id);
  if (!campaign) return null;
  return {
    page: { state: "saved", campaign: campaign.name, photo: link.saved_url },
    status: 200,
  };
}

/** the banner write, which a campaign ended or deleted since `open_link` refuses */
async function set_banner(
  db: DbOrTx,
  npo_id: number,
  campaign_id: string,
  banner: string
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(campaigns)
    .set({ banner, updated_at: next_updated_at() })
    .where(
      and(
        eq(campaigns.id, campaign_id),
        eq(campaigns.owner_npo_id, npo_id),
        not(ended_sql(now))
      )
    )
    .returning({ id: campaigns.id });
  return rows.length === 1;
}

export async function read_photo_page(
  db: DbOrTx,
  token: string
): Promise<PhotoResult> {
  const live = await open_link(db, token);
  if (!live) return (await saved_page(db, token)) ?? GONE;
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
  // a spent link takes no second photo; one that saved shows what it saved
  if (!live) return (await saved_page(db, token)) ?? GONE;
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
  if (!claim) return (await saved_page(db, token)) ?? GONE;
  const saved_page_of = (photo: string): PhotoResult => ({
    page: { state: "saved", campaign: live.name, photo },
    status: 200,
  });
  let stored: string | null = null;
  try {
    stored = (await store_upload(stored_name(file, type), file, type)).url;
    const url = stored;
    // the banner and the link's record of it land together or not at all; a
    // refused banner wrote nothing, so it returns rather than rolls back
    const saved = await db.transaction(async (tx) => {
      if (!(await set_banner(tx, claim.npo_id, claim.campaign_id, url))) {
        return false;
      }
      if (!(await record_saved_photo(tx, claim.id, claim.used_at, url))) {
        throw new Error("photo upload: the claim moved before it was recorded");
      }
      return true;
    });
    if (!saved) {
      // ended or deleted while the file was on its way: nothing points at it
      await discard_upload(url).catch(() => undefined);
      await release_photo_link(db, claim.id, claim.used_at).catch(() => false);
      return GONE;
    }
    return saved_page_of(url);
  } catch (err) {
    // the link id, never the token: the token is the credential
    report_error(err, { where: "photo upload: save failed", link: claim.id });
    const failed: PhotoResult = {
      page: { state: "failed", campaign: live.name },
      status: 500,
    };
    if (stored) {
      // a commit whose reply was lost still saved: the link is the record. A
      // record that can't be read may point at the file, so the file and the
      // claim stay as they are
      const after = await saved_photo_link(db, token).catch(() => undefined);
      if (after === undefined) return failed;
      if (after?.saved_url === stored) return saved_page_of(stored);
      await discard_upload(stored).catch(() => undefined);
    }
    await release_photo_link(db, claim.id, claim.used_at).catch(() => false);
    return failed;
  }
}
