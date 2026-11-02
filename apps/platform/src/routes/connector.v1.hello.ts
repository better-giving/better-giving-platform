import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { CONNECTOR_ACTIONS } from "$/connector/actions";
import { reserve_ip } from "$/connector/gate";
import { connector_route } from "$/connector/http";
import { problem } from "$/connector/problem";

const NO_STORE = { "cache-control": "no-store" };

export const loader = connector_route(({ request }: LoaderFunctionArgs) => {
  if (!reserve_ip("hello", request)) return problem(429, "rate_limited");
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return Response.json(
    {
      service: "better-giving",
      contract: 1,
      release: sha || "dev",
      name: "Better Giving",
      actions: CONNECTOR_ACTIONS,
    },
    { headers: NO_STORE }
  );
});

export function action(_args: ActionFunctionArgs) {
  return problem(404, "unknown_action");
}
