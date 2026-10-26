import { href } from "react-router";
import { moved } from "#/helpers/moved";
import type { Route } from "./+types/donate-fund.$fund_id";

/** donate-fund/:fund_id moved to /campaigns/:fund_id/donate; shared publicly,
 * so old links and indexed urls must keep working */
export const loader = ({ params, request }: Route.LoaderArgs) => {
  const { search } = new URL(request.url);
  return moved(
    `${href("/campaigns/:fund_id/donate", { fund_id: params.fund_id })}${search}`
  );
};
