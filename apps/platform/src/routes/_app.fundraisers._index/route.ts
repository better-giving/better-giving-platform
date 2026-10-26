import { href } from "react-router";
import { moved } from "#/helpers/moved";
import type { Route } from "./+types/route";

/** the list moved to /campaigns; old links and indexed urls follow */
export const loader = ({ request }: Route.LoaderArgs) => {
  const { search } = new URL(request.url);
  return moved(`${href("/campaigns")}${search}`);
};
