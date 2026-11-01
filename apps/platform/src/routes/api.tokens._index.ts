import { type IToken, tokens_list } from "@better-giving/crypto";
import Fuse from "fuse.js";
import { resp } from "@/helpers/https";
import { public_api_route, read_only } from "$/public-api";
import type { Route } from "./+types/api.tokens._index";

const tokens_fuse = new Fuse<IToken>(tokens_list, {
  keys: ["name", "code", "network", "symbol"],
});
const subset = tokens_list.slice(0, 10);

const cache = "public, max-age=3600, s-maxage=3600";

export const loader = public_api_route(
  async ({ request }: Route.LoaderArgs) => {
    const q = new URL(request.url).searchParams.get("q") || "";

    if (!q) return resp.json(subset, 200, { "cache-control": cache });
    const filtered = tokens_fuse.search(q, { limit: 10 }).map((x) => x.item);

    return resp.json(filtered, 200, { "cache-control": cache });
  }
);

export const action = read_only;
