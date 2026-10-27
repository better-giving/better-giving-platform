import { data, href } from "react-router";
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

type Refusal = Exclude<
  Awaited<ReturnType<typeof videos_action>>,
  { ok: boolean }
>;

/** the dialog's `useRemixForm` reads `errors` as react-hook-form field errors,
 * and has no field but the link to show one under */
const as_field_error = ({ data: d, init }: Refusal) => {
  const message = "errors" in d ? d.errors.url : d.error;
  return data(
    { errors: { url: { message, type: "custom" } } },
    { status: init?.status }
  );
};

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
  // the dialog closes only on a redirect, so only a refusal answers with data
  if (!("ok" in answer)) return as_field_error(answer);
  return redirectWithSuccess(
    videos_group(x.params.id),
    rest === "new" ? "Video added" : "Video updated"
  );
};
