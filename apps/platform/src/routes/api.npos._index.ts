import { safeParse } from "valibot";
import { get_npos } from "#/.server/npos";
import { api_error } from "@/helpers/api-error";
import { resp, search } from "@/helpers/https";
import { npos_search } from "@/npo/schema";
import { public_api_route, read_only } from "$/public-api";
import type { Route } from "./+types/api.npos._index";

const cache = "public, s-maxage=60, stale-while-revalidate=300";

export const loader = public_api_route(
  async ({ request }: Route.LoaderArgs) => {
    const params = safeParse(npos_search, search(request));
    if (params.issues) {
      return api_error("invalid_request", params.issues[0].message);
    }

    const page = await get_npos(params.output);

    return resp.json(page, 200, { "cache-control": cache });
  }
);

export const action = read_only;
