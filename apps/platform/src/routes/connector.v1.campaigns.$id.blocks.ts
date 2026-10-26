import type { ActionFunctionArgs } from "react-router";
import { update_campaign_blocks } from "$/connector/campaign-writes";
import { connector_route } from "$/connector/http";
import { problem } from "$/connector/problem";
import { db } from "$/pg/db";

export function loader() {
  return problem(404, "unknown_action");
}

export const action = connector_route(
  ({ request, params }: ActionFunctionArgs) => {
    return update_campaign_blocks(db, request, params.id ?? "");
  }
);
