import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { connector_route, open_key } from "$/connector/http";
import { problem } from "$/connector/problem";
import { get_donor } from "$/connector/reads";
import { db } from "$/pg/db";

export const loader = connector_route(
  async ({ request, params }: LoaderFunctionArgs) => {
    const live = await open_key(db, request);
    if (live instanceof Response) return live;
    const id = params.id;
    if (!id)
      return problem(404, "not_found", { detail: "Donor id is missing." });
    return get_donor(db, live.npo_id, id, new URL(request.url));
  }
);

export function action(_args: ActionFunctionArgs) {
  return problem(404, "unknown_action");
}
