import type { ActionFunctionArgs } from "react-router";
import { end_campaign } from "$/connector/campaign-writes";
import { connector_route } from "$/connector/http";
import { problem } from "$/connector/problem";
import { db } from "$/pg/db";

export function loader() {
  return problem(404, "unknown_action");
}

export const action = connector_route(
  ({ request, params }: ActionFunctionArgs) => {
    return end_campaign(db, request, params.id ?? "");
  }
);
