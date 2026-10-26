import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { update_form } from "$/connector/form-writes";
import { connector_route, open_key } from "$/connector/http";
import { problem } from "$/connector/problem";
import { get_form } from "$/connector/reads";
import { db } from "$/pg/db";

export const loader = connector_route(
  async ({ request, params }: LoaderFunctionArgs) => {
    const live = await open_key(db, request);
    if (live instanceof Response) return live;
    const id = params.id;
    if (!id)
      return problem(404, "not_found", { detail: "Form id is missing." });
    return get_form(db, live.npo_id, id, new URL(request.url));
  }
);

export const action = connector_route(
  ({ request, params }: ActionFunctionArgs) => {
    return update_form(db, request, params.id ?? "");
  }
);
