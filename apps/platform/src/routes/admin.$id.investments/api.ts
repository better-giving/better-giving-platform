import { admin_ctx } from "#/.server/auth";
import type { IBalanceTx } from "@/balance-txs";
import { search } from "@/helpers/https";
import type { IComposition } from "@/nav/interfaces";
import type { IPageKeyed } from "@/types/api";
import { bal_tx_npo_txs } from "$/pg/queries/bal-tx";
import { nav_ltd } from "$/pg/queries/nav";
import { npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";

export interface LoaderData extends IPageKeyed<IBalanceTx> {
  id: number;
  bal_lock: number;
  composition: IComposition;
  total_inv_value: number;
}

export const loader = async (x: Route.LoaderArgs) => {
  const id = x.context.get(admin_ctx);

  const { next } = search(x.url);
  const [npo, ltd, btxs_page1] = await Promise.all([
    npo_get(id),
    nav_ltd(),
    bal_tx_npo_txs(id, "lock", {
      next,
      limit: 10,
    }),
  ]);
  return {
    id,
    bal_lock: (npo?.lock_units ?? 0) * ltd.price,
    composition: ltd.composition,
    total_inv_value: ltd.value,
    ...btxs_page1,
  } satisfies LoaderData;
};
