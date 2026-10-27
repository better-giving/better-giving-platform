import { data } from "react-router";
import { safeParse } from "valibot";
import { admin_ctx } from "#/.server/auth";
import { MAX_VIDEOS } from "#/routes/org.$org._index/api";
import { resp } from "@/helpers/https";
import type { IMedia } from "@/npo";
import { media_id } from "@/npo/schema";
import {
  npo_media_delete,
  npo_media_get,
  npo_media_list,
  npo_media_put,
  npo_media_update,
} from "$/pg/queries/npo-media";
import type { Route } from "./+types/route";
import { schema } from "./schema";

type IMediaRow = IMedia & { npo_id: number };

export const cap_error = (max: number) =>
  `Your page shows up to ${max} videos. Take one off first.`;

/** `npo_media_get` is unscoped and the writes are scoped, so a foreign id
 * would no-op behind a success answer */
const get_own = async (npo_id: number, mid: string) => {
  const m = (await npo_media_get(mid)) as IMediaRow | undefined;
  return m?.npo_id === npo_id ? m : undefined;
};

/** the public page reads only the newest `MAX_VIDEOS` featured ones */
const page_full = async (npo_id: number) => {
  const page = await npo_media_list(npo_id, {
    type: "video",
    featured: true,
    limit: MAX_VIDEOS,
  });
  return page.items.length >= MAX_VIDEOS;
};

const not_found = () => data({ error: "Video not found" }, { status: 404 });

/** past the cap the video lands in the list only */
const put = async (npo_id: number, url: string, featured: boolean) => {
  const m = await npo_media_put(npo_id, { url, featured }, MAX_VIDEOS);
  return m.id;
};

const parse_url = (fv: FormData) => {
  const p = safeParse(schema, { url: fv.get("url") ?? "" });
  if (p.issues) {
    const errors = { url: p.issues[0].message };
    return { error: data({ errors }, { status: 400 }) };
  }
  return { url: p.output.url };
};

/** also answers the retired Media page's posts, so it reads only these */
type Args = Pick<Route.ActionArgs, "request" | "context">;

export const videos_action = async (x: Args) => {
  const id = x.context.get(admin_ctx);
  const fv = await x.request.formData();
  const intent = fv.get("intent");

  // a restore is the link a delete removed, sent back as it was
  if (intent === "add" || intent === "restore") {
    const p = parse_url(fv);
    if (p.error) return p.error;
    const featured = intent === "add" || fv.get("featured") === "1";
    const mid = await put(id, p.url, featured);
    return { ok: true, id: mid };
  }

  const p_mid = safeParse(media_id, fv.get("mediaId"));
  if (p_mid.issues) throw resp.status(400, p_mid.issues[0].message);
  const prev = await get_own(id, p_mid.output);
  if (!prev) return not_found();

  if (intent === "feature") {
    // `featured` is the state the sender saw, so a repeated press lands on the
    // same value rather than flipping it back
    const next = fv.get("featured") !== "1";
    if (next && !prev.featured && (await page_full(id))) {
      return data({ error: cap_error(MAX_VIDEOS) }, { status: 409 });
    }
    await npo_media_update(id, prev.id, { featured: next });
    return { ok: true };
  }

  if (intent === "edit") {
    const p = parse_url(fv);
    if (p.error) return p.error;
    await npo_media_update(id, prev.id, { url: p.url });
    return { ok: true };
  }

  if (intent === "delete") {
    await npo_media_delete(id, prev.id);
    return { ok: true };
  }

  throw resp.status(400, "unknown intent");
};
