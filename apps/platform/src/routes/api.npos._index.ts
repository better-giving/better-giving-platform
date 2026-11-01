import type { LoaderFunction } from "react-router";
import { safeParse } from "valibot";
import { get_npos } from "#/.server/npos";
import { resp, search } from "@/helpers/https";
import { npos_search } from "@/npo/schema";

const cache = "public, s-maxage=60, stale-while-revalidate=300";

export const loader: LoaderFunction = async ({ url }) => {
  const params = safeParse(npos_search, search(url));
  if (params.issues) return resp.err(400, params.issues[0].message);

  const page = await get_npos(params.output);

  return resp.json(page, 200, { "cache-control": cache });
};
