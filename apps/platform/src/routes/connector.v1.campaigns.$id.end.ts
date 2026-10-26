import type { ActionFunctionArgs } from "react-router";
import { end_campaign } from "$/connector/campaign-writes";
import { problem } from "$/connector/problem";
import { db } from "$/pg/db";

export function loader() {
  return problem(404, "unknown_action");
}

export function action({ request, params }: ActionFunctionArgs) {
  return end_campaign(db, request, params.id ?? "");
}
