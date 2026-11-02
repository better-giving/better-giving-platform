import { format } from "date-fns";
import {
  ticker_colors,
  unmapped_ticker_color,
} from "#/pages/platform-admin/investments/common";
import { fmt_share, share_pct } from "#/routes/platform.investments/share";
import { humanize } from "@/helpers/decimal";
import type { ILog } from "@/nav";
import { prices_fn } from "../helpers";
import { type FV, ticker_nets } from "../types";
import { Diff } from "./diff";

interface Props {
  fv: FV;
  ltd: ILog;
  classes?: string;
}

export function Review(props: Props) {
  const nets = ticker_nets(props.fv.bals, props.fv.txs);
  const prices = prices_fn(props.fv.txs);

  const tickers = Object.values(props.ltd.composition)
    .map((t) => {
      const ps = prices[t.id] || [];
      const ps_sum = ps.reduce((a, b) => a + b, 0);
      const avg = ps.length > 0 ? ps_sum / ps.length : 0;
      const qty2 = nets[t.id] ?? t.qty;
      const price2 = avg || t.price;

      const value2 = qty2 * price2;

      return {
        ...t,
        pct: share_pct(t.value, props.ltd.value),
        qty2,
        price2,
        value2,
      };
    })
    .sort((a, b) => b.value2 - a.value2);

  const total_value_2 = tickers.reduce((a, b) => a + b.value2, 0);
  const tickers2 = tickers.map((t) => {
    return { ...t, pct2: share_pct(t.value2, total_value_2) };
  });

  return (
    <div className={`overflow-x-auto scrollbars ${props.classes || ""} p-8`}>
      <p className="text-gray-11 text-sm font-semibold">Portfolio value</p>
      <Diff
        classes="text-2xl font-bold mb-4"
        el="div"
        a={props.ltd.value}
        b={total_value_2}
        formatter={(x) => `$${humanize(x)}`}
      />
      <p className="text-gray-11 text-sm font-semibold">Unit price</p>
      {props.ltd.units === 0 ? (
        <div className="text-2xl font-bold mb-4">—</div>
      ) : (
        <Diff
          classes="text-2xl font-bold mb-4"
          el="div"
          a={props.ltd.price}
          b={total_value_2 / props.ltd.units}
          formatter={(x) => `$${humanize(x)}`}
        />
      )}
      <table className="table">
        <thead>
          <tr className="whitespace-nowrap">
            <th>Symbol</th>
            <th>Units</th>
            <th>Price</th>
            <th>Price date</th>
            <th>Value</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {tickers2.map((t) => (
            <tr key={t.id} className="text-sm whitespace-nowrap">
              <td
                style={{ color: ticker_colors[t.id] || unmapped_ticker_color }}
                className="font-bold"
              >
                {t.id}
              </td>
              <Diff
                el="td"
                classes="text-right"
                a={t.qty}
                b={t.qty2}
                formatter={(x) => humanize(x)}
              />
              <Diff
                el="td"
                classes="text-right"
                a={t.price}
                b={t.price2}
                formatter={(x) => `$${humanize(x)}`}
              />
              <td className="text-right">
                {t.price_date ? format(new Date(t.price_date), "PP") : "-"}
              </td>
              <Diff
                el="td"
                classes="text-right"
                a={t.value}
                b={t.value2}
                formatter={(x) => `$${humanize(x)}`}
              />
              {t.pct === null || t.pct2 === null ? (
                <td className="text-right">{fmt_share(t.pct2)}</td>
              ) : (
                <Diff
                  el="td"
                  classes="text-right"
                  a={t.pct}
                  b={t.pct2}
                  formatter={(x) => `${humanize(x)}%`}
                />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
