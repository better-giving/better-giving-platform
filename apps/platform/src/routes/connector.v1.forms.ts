import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { create_form } from "$/connector/form-writes";
import { connector_route, open_key } from "$/connector/http";
import { list_forms } from "$/connector/reads";
import { db } from "$/pg/db";

export const loader = connector_route(
  async ({ request }: LoaderFunctionArgs) => {
    const live = await open_key(db, request);
    if (live instanceof Response) return live;
    return list_forms(db, live.npo_id, new URL(request.url));
  }
);

export const action = connector_route(({ request }: ActionFunctionArgs) => {
  return create_form(db, request);
});
