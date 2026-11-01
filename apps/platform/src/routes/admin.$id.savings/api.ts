import * as v from "valibot";
import { admin_ctx } from "#/.server/auth";
import type { IBalanceTx } from "@/balance-txs";
import { resp } from "@/helpers/https";
import type { IPageKeyed } from "@/types/api";
import { bal_tx_npo_txs } from "$/pg/queries/bal-tx";
import { npo_get } from "$/pg/queries/npo";
import type { Route } from "./+types/route";

export interface LoaderData extends IPageKeyed<IBalanceTx> {
  bal_liq: number;
}

export const loader = async (x: Route.LoaderArgs) => {
  const { searchParams: s } = x.url;
  const p = v.safeParse(v.nullable(v.string()), s.get("next"));
  if (p.issues) throw resp.status(400, p.issues[0].message);
  const key = p.output;

  const id = x.context.get(admin_ctx);

  const [npo, btx_page] = await Promise.all([
    npo_get(id),
    bal_tx_npo_txs(id, "liq", {
      next: key ?? undefined,
      limit: 10,
    }),
  ]);

  return {
    bal_liq: npo?.liq ?? 0,
    ...btx_page,
  } satisfies LoaderData;
};
