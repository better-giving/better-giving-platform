import type { Route } from "./+types/agents.mcp";
import { method_not_allowed } from "./agents/rpc";
import { action as mcp } from "./agents._index";

// the MCP endpoint answers POST alone; its GET is the Streamable HTTP SSE
// stream, which this server doesn't offer
export const loader = ({ request }: Route.LoaderArgs) =>
  method_not_allowed(request.method, "POST");

export const action = (args: Route.ActionArgs) =>
  args.request.method === "POST"
    ? mcp(args)
    : method_not_allowed(args.request.method, "POST");
