import { href } from "react-router";
import { moved } from "#/helpers/moved";
import type { Route } from "./+types/route";

/** the editor moved to /campaigns/:fund_id/edit; old links and indexed urls follow */
export const loader = ({ params, request }: Route.LoaderArgs) => {
  const { search } = new URL(request.url);
  return moved(
    `${href("/campaigns/:fund_id/edit", { fund_id: params.fund_id })}${search}`
  );
};
