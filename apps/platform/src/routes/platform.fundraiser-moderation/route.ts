import { href } from "react-router";
import { moved } from "#/helpers/moved";
import type { Route } from "./+types/route";

/** moved to /platform/campaign-moderation; old links keep working */
export const loader = ({ url }: Route.LoaderArgs) => {
  const { search } = url;
  return moved(`${href("/platform/campaign-moderation")}${search}`);
};
