import { href } from "react-router";
import { parseFormData } from "remix-hook-form";
import { moved } from "#/helpers/moved";
import { videos_action } from "#/routes/admin.$id.organization.videos/api";
import type { Route } from "./+types/route";

/** the Media page and its add/edit dialogs folded into Organization's Videos
 * group; old links and bookmarks land there */
export const loader = ({ params }: Route.LoaderArgs) =>
  moved(`${href("/admin/:id/organization", { id: params.id })}#videos`);

/** a press from a Media page loaded before this route redirected. the list
 * posted the videos action's own fields; the dialogs posted a url only, at
 * `new` or the video's id */
export const action = async (x: Route.ActionArgs) => {
  const rest = x.params["*"] ?? "";
  if (rest === "") return videos_action(x);

  const { url } = await parseFormData<{ url?: string }>(x.request);
  const fv = new FormData();
  fv.set("intent", rest === "new" ? "add" : "edit");
  fv.set("url", url ?? "");
  if (rest !== "new") fv.set("mediaId", rest);
  const request = new Request(x.request.url, { method: "POST", body: fv });
  return videos_action({ ...x, request });
};
