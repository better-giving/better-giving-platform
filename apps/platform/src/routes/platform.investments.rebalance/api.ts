import { redirect } from "react-router";
import { safeParse } from "valibot";
import { dataWithError } from "#/.server/toast";
import { resp } from "@/helpers/https";
import type { IComposition, ITicker } from "@/nav";
import { NEGATIVE_BAL_MSG } from "@/nav/schemas";
import { db } from "$/pg/db";
import { nav_log_put, nav_ltd, rebalance_log_put } from "$/pg/queries/nav";
import type { Route } from "./+types/route";
import { NO_UNITS_MSG, prices_fn, to_bals } from "./helpers";
import { fv as schema, ticker_nets } from "./types";

export const loader = async (_: Route.LoaderArgs) => {
  return nav_ltd();
};

export const action = async ({ request }: Route.ActionArgs) => {
  const txs = await request.json().catch(() => undefined);
  if (txs === undefined) throw resp.status(400, "body is not json");

  const ltd = await nav_ltd();
  if (ltd.units === 0) {
    return dataWithError(null, NO_UNITS_MSG, { status: 400 });
  }
  const bals = to_bals(ltd.composition);

  const p = safeParse(schema, { txs, bals });
  if (p.issues) {
    const { message } = p.issues[0];
    if (message === NEGATIVE_BAL_MSG) return dataWithError(null, message);
    throw resp.status(400, message);
  }
  const fv = p.output;

  const timestamp = new Date().toISOString();
  const nets = ticker_nets(fv.bals, fv.txs);
  const prices = prices_fn(fv.txs);

  const tickers: ITicker[] = Object.values(ltd.composition).map((t) => {
    const ps = prices[t.id];
    const n = nets[t.id];
    if (!ps || n == null) return t; // no price or net, return original ticker

    const ps_sum = ps.reduce((a, b) => a + b, 0);
    const ps_avg = ps_sum / ps.length;

    return {
      ...t,
      qty: n,
      price: ps_avg,
      value: n * ps_avg,
      price_date: timestamp,
    };
  });
  const total = tickers.reduce((sum, t) => sum + t.value, 0);
  const comp = Object.fromEntries(
    tickers.map((t) => [t.id, t])
  ) as IComposition;

  const rebalance_id = crypto.randomUUID();
  const rebalance = {
    txs: fv.txs,
    bals: fv.bals,
    id: rebalance_id,
    date: timestamp,
  };

  const updated_nav: typeof ltd = {
    ...ltd,
    date: timestamp,
    reason: `rebalance: ${rebalance_id}`,
    composition: comp,
    value: total,
    price: total / ltd.units,
    price_updated: timestamp,
  };

  await db.transaction(async (pg) => {
    await rebalance_log_put(pg, rebalance);
    await nav_log_put(pg, updated_nav);
  });

  return redirect("..");
};
