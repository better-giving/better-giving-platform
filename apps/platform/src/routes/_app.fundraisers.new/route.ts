import { href } from "react-router";
import { moved } from "#/helpers/moved";
import type { Route } from "./+types/route";

/** the creator moved to /campaigns/new; old links and indexed urls follow */
export const loader = ({ url }: Route.LoaderArgs) => {
  const { search } = url;
  return moved(`${href("/campaigns/new")}${search}`);
};
