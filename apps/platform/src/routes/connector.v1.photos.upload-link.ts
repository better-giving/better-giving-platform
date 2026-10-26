import type { ActionFunctionArgs } from "react-router";
import { create_photo_upload_link } from "$/connector/photo-writes";
import { problem } from "$/connector/problem";
import { db } from "$/pg/db";

export function loader() {
  return problem(404, "unknown_action");
}

export function action({ request }: ActionFunctionArgs) {
  return create_photo_upload_link(db, request);
}
