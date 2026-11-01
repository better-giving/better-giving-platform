import { type ITicker, tickers } from "@better-giving/stocks";
import Fuse from "fuse.js";
import type { LoaderFunction } from "react-router";
import { resp } from "@/helpers/https";

const tickers_fuse = new Fuse<ITicker>(tickers, {
  keys: ["symbol", "name"],
});
const subset = tickers.slice(0, 10);

const cache = "public, max-age=3600, s-maxage=3600";

export const loader: LoaderFunction = async ({ url }) => {
  const q = url.searchParams.get("q") || "";

  if (!q) return resp.json(subset, 200, { "cache-control": cache });
  const filtered = tickers_fuse.search(q, { limit: 10 }).map((x) => x.item);

  return resp.json(filtered, 200, { "cache-control": cache });
};
