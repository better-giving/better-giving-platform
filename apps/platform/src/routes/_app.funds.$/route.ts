import { moved } from "#/helpers/moved";
import type { Route } from "./+types/route";

/** funds/* moved to campaigns/*; old links and indexed urls follow */
export const loader = ({ params, request }: Route.LoaderArgs) => {
  const { search } = new URL(request.url);
  return moved(`/campaigns/${params["*"]}${search}`);
};
