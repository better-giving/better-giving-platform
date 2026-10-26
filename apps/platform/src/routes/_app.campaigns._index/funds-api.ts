import { safeParse } from "valibot";
import { get_funds } from "#/.server/funds";
import { funds_search } from "@/campaign/schema";
import { resp, search } from "@/helpers/https";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export const loader = async ({ request }: Route.LoaderArgs) => {
  const p = safeParse(funds_search, search(request));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const s = p.output;
  const page = await get_funds(s);
  return page;
};
