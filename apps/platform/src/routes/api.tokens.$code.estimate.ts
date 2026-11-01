import { is_custom, tokens_map } from "@better-giving/crypto";
import type { ITokenEstimate } from "#/types/api";
import { api_error } from "@/helpers/api-error";
import { resp } from "@/helpers/https";
import { donation_quote } from "@/nowpayments/min";
import { coingecko } from "$/kit/coingecko";
import { np } from "$/kit/nowpayments";
import { public_api_route, read_only } from "$/public-api";
import type { Route } from "./+types/api.tokens.$code.estimate";

const cache = "public, s-maxage=30, stale-while-revalidate=60";

export const loader = public_api_route(async ({ params }: Route.LoaderArgs) => {
  const tkn = tokens_map[params.code];
  if (!tkn) return api_error("not_found", "No token has this code.");

  if (is_custom(tkn.id)) {
    //get usd rate from coingecko
    const res = await coingecko((x) => {
      // `?` inside pathname is encoded into the path, so coingecko never sees
      // the query and answers 404 for every custom token
      x.pathname = "api/v3/simple/price";
      x.searchParams.set("ids", tkn.cg_id);
      x.searchParams.set("vs_currencies", "usd");
      return x;
    });

    if (!res.ok) throw res;
    const {
      [tkn.cg_id]: { usd: usdpu },
    } = await res.json();

    return resp.json({ min: 1 / usdpu, usdpu } satisfies ITokenEstimate, 200, {
      "cache-control": cache,
    });
  }

  const { min, usdpu } = await donation_quote(np, tkn.code);
  return resp.json({ min, usdpu } satisfies ITokenEstimate, 200, {
    "cache-control": cache,
  });
});

export const action = read_only;
