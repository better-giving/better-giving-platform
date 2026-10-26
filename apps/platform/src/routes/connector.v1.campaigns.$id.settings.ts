import type { ActionFunctionArgs } from "react-router";
import { update_campaign_settings } from "$/connector/campaign-writes";
import { problem } from "$/connector/problem";
import { db } from "$/pg/db";

export function loader() {
  return problem(404, "unknown_action");
}

export function action({ request, params }: ActionFunctionArgs) {
  return update_campaign_settings(db, request, params.id ?? "");
}
