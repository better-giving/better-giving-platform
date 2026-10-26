import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { create_form } from "$/connector/form-writes";
import { open_key } from "$/connector/http";
import { list_forms } from "$/connector/reads";
import { db } from "$/pg/db";

export async function loader({ request }: LoaderFunctionArgs) {
  const live = await open_key(db, request);
  if (live instanceof Response) return live;
  return list_forms(db, live.npo_id, new URL(request.url));
}

export function action({ request }: ActionFunctionArgs) {
  return create_form(db, request);
}
