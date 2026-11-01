import { type ITicker, tickers } from "@better-giving/stocks";
import Fuse from "fuse.js";
import { resp } from "@/helpers/https";
import { public_api_route, read_only } from "$/public-api";
import type { Route } from "./+types/api.tickers._index";

const tickers_fuse = new Fuse<ITicker>(tickers, {
  keys: ["symbol", "name"],
});
const subset = tickers.slice(0, 10);

const cache = "public, max-age=3600, s-maxage=3600";

export const loader = public_api_route(
  async ({ request }: Route.LoaderArgs) => {
    const q = new URL(request.url).searchParams.get("q") || "";

    if (!q) return resp.json(subset, 200, { "cache-control": cache });
    const filtered = tickers_fuse.search(q, { limit: 10 }).map((x) => x.item);

    return resp.json(filtered, 200, { "cache-control": cache });
  }
);

export const action = read_only;
