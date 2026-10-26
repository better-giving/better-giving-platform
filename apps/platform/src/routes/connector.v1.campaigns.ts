import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { connector_route, open_key } from "$/connector/http";
import { list_campaigns } from "$/connector/reads";
import { create_campaign } from "$/connector/writes";
import { db } from "$/pg/db";

export const loader = connector_route(
  async ({ request }: LoaderFunctionArgs) => {
    const live = await open_key(db, request);
    if (live instanceof Response) return live;
    return list_campaigns(db, live.npo_id, new URL(request.url));
  }
);

export const action = connector_route(({ request }: ActionFunctionArgs) => {
  return create_campaign(db, request);
});
