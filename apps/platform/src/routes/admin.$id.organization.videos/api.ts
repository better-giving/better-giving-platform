import { data } from "react-router";
import { safeParse } from "valibot";
import { admin_ctx } from "#/.server/auth";
import { MAX_VIDEOS } from "#/routes/org.$org._index/api";
import { resp } from "@/helpers/https";
import type { IMedia } from "@/npo";
import { media_id } from "@/npo/schema";
import {
  npo_media_delete,
  npo_media_feature,
  npo_media_get,
  npo_media_put,
  npo_media_restore,
  npo_media_update,
} from "$/pg/queries/npo-media";
import type { Route } from "./+types/route";
import { restored_date, schema } from "./schema";

type IMediaRow = IMedia & { npo_id: number };

export const cap_error = (max: number) =>
  `Your page shows up to ${max} videos. Take one off first.`;

/** `npo_media_get` is unscoped and the writes are scoped, so a foreign id
 * would no-op behind a success answer */
const get_own = async (npo_id: number, mid: string) => {
  const m = (await npo_media_get(mid)) as IMediaRow | undefined;
  return m?.npo_id === npo_id ? m : undefined;
};

const not_found = () => data({ error: "Video not found" }, { status: 404 });

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

  // past the cap the video lands in the list only
  if (intent === "add") {
    const p = parse_url(fv);
    if (p.error) return p.error;
    const m = await npo_media_put(
      id,
      { url: p.url, featured: true },
      MAX_VIDEOS
    );
    return { ok: true, id: m.id };
  }

  // the link a delete removed, sent back as it was, so it keeps its place
  if (intent === "restore") {
    const p = parse_url(fv);
    if (p.error) return p.error;
    const d = safeParse(restored_date, fv.get("date_created") ?? "");
    if (d.issues) throw resp.status(400, d.issues[0].message);
    // a client that predates sending the removed row's id restores a new copy
    const sent_mid = fv.get("mediaId");
    const p_mid = sent_mid === null ? undefined : safeParse(media_id, sent_mid);
    if (p_mid?.issues) throw resp.status(400, p_mid.issues[0].message);
    const m = await npo_media_restore(
      id,
      {
        id: p_mid?.output ?? crypto.randomUUID(),
        url: p.url,
        featured: fv.get("featured") === "1",
        date_created: d.output,
      },
      MAX_VIDEOS
    );
    if (!m) return not_found();
    return { ok: true, id: m.id };
  }

  const p_mid = safeParse(media_id, fv.get("mediaId"));
  if (p_mid.issues) throw resp.status(400, p_mid.issues[0].message);
  const prev = await get_own(id, p_mid.output);
  if (!prev) return not_found();

  if (intent === "feature") {
    // `featured` is the state the sender saw, so a repeated press lands on the
    // same value rather than flipping it back
    if (fv.get("featured") === "1") {
      await npo_media_update(id, prev.id, { featured: false });
      return { ok: true };
    }
    if (!(await npo_media_feature(id, prev.id, MAX_VIDEOS))) {
      return data({ error: cap_error(MAX_VIDEOS) }, { status: 409 });
    }
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
