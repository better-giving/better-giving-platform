import type { LoaderFunction } from "react-router";
import * as v from "valibot";
import { get_session } from "#/.server/auth";
import { balance_txs_options } from "@/balance-txs";
import { resp, search } from "@/helpers/https";
import { bal_txs_list } from "$/pg/queries/bal-tx";

export const loader: LoaderFunction = async ({ request, url }) => {
  const p = v.safeParse(balance_txs_options, search(url));
  if (p.issues) throw resp.status(400, p.issues[0].message);

  const { user } = await get_session(request);
  if (!user) return resp.status(401);
  if (user.role !== "admin") {
    return resp.status(403);
  }

  const page = await bal_txs_list(p.output);

  return resp.json(page);
};
