import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { connector_route, open_key } from "$/connector/http";
import { problem } from "$/connector/problem";
import { get_block_catalog } from "$/connector/reads";
import { db } from "$/pg/db";

export const loader = connector_route(
  async ({ request }: LoaderFunctionArgs) => {
    const live = await open_key(db, request);
    if (live instanceof Response) return live;
    return get_block_catalog(new URL(request.url));
  }
);

export function action(_args: ActionFunctionArgs) {
  return problem(404, "unknown_action");
}
