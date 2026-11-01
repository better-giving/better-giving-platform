import { type IToken, tokens_list } from "@better-giving/crypto";
import Fuse from "fuse.js";
import type { LoaderFunction } from "react-router";
import { resp } from "@/helpers/https";

const tokens_fuse = new Fuse<IToken>(tokens_list, {
  keys: ["name", "code", "network", "symbol"],
});
const subset = tokens_list.slice(0, 10);

const cache = "public, max-age=3600, s-maxage=3600";

export const loader: LoaderFunction = async ({ url }) => {
  const q = url.searchParams.get("q") || "";

  if (!q) return resp.json(subset, 200, { "cache-control": cache });
  const filtered = tokens_fuse.search(q, { limit: 10 }).map((x) => x.item);

  return resp.json(filtered, 200, { "cache-control": cache });
};
