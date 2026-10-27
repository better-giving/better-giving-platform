import { safeParse } from "valibot";
import { endowUpdate } from "#/pages/admin/endow-update-action";
import { MAX_VIDEOS } from "#/routes/org.$org._index/api";
import { resp, search } from "@/helpers/https";
import type { IMedia } from "@/npo";
import { $int_gte1 } from "@/schemas";
import type { INpo } from "$/pg/queries/npo";
import { npo_get } from "$/pg/queries/npo";
import { npo_media_list } from "$/pg/queries/npo-media";
import type { Route } from "./+types/route";
import { VIDEOS_PAGE, videos_shown } from "./videos-page";

export interface IVideos {
  /** the ones the public page shows, newest first */
  featured: IMedia[];
  items: IMedia[];
  has_more: boolean;
  max: number;
  /** how many `items` this read asked for */
  limit: number;
}

export interface LoaderData extends INpo {
  base_url: string;
  videos: IVideos;
}

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const p = safeParse($int_gte1, params.id);
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const id = p.output;
  // "Load more" widens the read rather than paging it, so a revalidation after
  // a video write refreshes every row on screen
  const limit = videos_shown(search(request)[VIDEOS_PAGE]);
  const [npo, featured, all] = await Promise.all([
    npo_get(id),
    npo_media_list(id, { type: "video", featured: true, limit: MAX_VIDEOS }),
    npo_media_list(id, { type: "video", limit }),
  ]);
  if (!npo) throw resp.status(404);

  return {
    ...npo,
    base_url: new URL(request.url).origin,
    videos: {
      featured: featured.items,
      items: all.items,
      has_more: !!all.next,
      max: MAX_VIDEOS,
      limit,
    },
  } satisfies LoaderData;
};

export const action = endowUpdate({ success: "Organization updated" });
