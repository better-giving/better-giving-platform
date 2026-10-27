import { href } from "react-router";
import { parseFormData } from "remix-hook-form";
import { redirectWithSuccess } from "#/.server/toast";
import { moved } from "#/helpers/moved";
import { videos_action } from "#/routes/admin.$id.organization.videos/api";
import type { Route } from "./+types/route";

const videos_group = (id: string) =>
  `${href("/admin/:id/organization", { id })}#videos`;

/** the Media page and its add/edit dialogs folded into Organization's Videos
 * group; old links and bookmarks land there */
export const loader = ({ params }: Route.LoaderArgs) =>
  moved(videos_group(params.id));

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
  const answer = await videos_action({ ...x, request });
  // the dialog closes only on a redirect; left open, its Save adds a duplicate
  if (!("ok" in answer)) return answer;
  return redirectWithSuccess(
    videos_group(x.params.id),
    rest === "new" ? "Video added" : "Video updated"
  );
};
