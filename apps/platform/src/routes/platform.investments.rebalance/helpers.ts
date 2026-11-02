import type { IComposition } from "@/nav";
import type { IBals, Tx } from "./types";

/** the unit price is total / units, so a portfolio with none can't be priced */
export const NO_UNITS_MSG = "Can't rebalance: the portfolio has no units yet.";

export const to_bals = (from: IComposition): IBals => {
  return Object.entries(from).reduce((acc, [ticker, { qty }]) => {
    acc[ticker] = qty;
    return acc;
  }, {} as IBals);
};

export const prices_fn = (txs: Tx[]) => {
  return txs.reduce(
    (acc, tx) => {
      if (tx.in_id === "CASH") {
        acc[tx.out_id] ||= [];
        acc[tx.out_id].push(+tx.price);
        return acc;
      }
      //out_id is cash
      acc[tx.in_id] ||= [];
      acc[tx.in_id].push(+tx.price);
      return acc;
    },
    { CASH: [1] } as { [ticker: string]: number[] }
  );
};
