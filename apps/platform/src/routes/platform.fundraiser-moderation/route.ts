import { href } from "react-router";
import { moved } from "#/helpers/moved";
import type { Route } from "./+types/route";

/** moved to /platform/campaign-moderation; old links keep working */
export const loader = ({ request }: Route.LoaderArgs) => {
  const { search } = new URL(request.url);
  return moved(`${href("/platform/campaign-moderation")}${search}`);
};
