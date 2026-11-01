import * as v from "valibot";
import { balance_txs_options } from "@/balance-txs";
import { resp, search } from "@/helpers/https";
import { bal_txs_list } from "$/pg/queries/bal-tx";
import type { Route } from "./+types/route";

export const loader = async ({ url }: Route.LoaderArgs) => {
  const p = v.safeParse(balance_txs_options, search(url));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const opts = p.output;

  return bal_txs_list({ ...opts, acc: "lock", outflow_only: true, limit: 10 });
};
