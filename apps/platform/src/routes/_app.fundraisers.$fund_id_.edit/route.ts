import { href } from "react-router";
import { moved } from "#/helpers/moved";
import type { Route } from "./+types/route";

// an editor left open on the old url still submits here, and a redirected
// POST would arrive as a GET; both paths carry `fund_id`, so the real action
// runs unchanged
export { action } from "../_app.campaigns.$fund_id_.edit/api";

/** the editor moved to /campaigns/:fund_id/edit; old links and indexed urls follow */
export const loader = ({ params, request }: Route.LoaderArgs) => {
  const { search } = new URL(request.url);
  return moved(
    `${href("/campaigns/:fund_id/edit", { fund_id: params.fund_id })}${search}`
  );
};
