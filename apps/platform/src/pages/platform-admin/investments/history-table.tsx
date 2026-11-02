import { EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import type { IPaginator } from "#/types/components";
import type { IBalanceTx } from "@/balance-txs";
import { humanize } from "@/helpers/decimal";
import type { ILog } from "@/nav";

export interface Props extends IPaginator<ILog> {}

export function FlowIcon(this_account: string, data: IBalanceTx): ReactNode {
  if (data.account === this_account) {
    return <ArrowRight className="text-success icon-md" />;
  }
}

export function HistoryTable({
  items,
  classes = "",
  disabled,
  loading,
  load_next,
}: Props) {
  return (
    <div className={`${classes} table-scroll`}>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Value</th>
            <th>Units</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow col_span={5}>No changes yet</EmptyRow>
          ) : (
            items.map((r, idx) => (
              <tr key={idx} className="text-sm">
                <td>{format(r.date, "PP")}</td>
                <td>{r.reason}</td>
                <td>${humanize(r.value)}</td>
                <td>{humanize(r.units)}</td>
                <td>${humanize(r.price)}</td>
              </tr>
            ))
          )}
        </tbody>
        {load_next && (
          <LoadMoreRow
            col_span={5}
            disabled={disabled}
            loading={loading}
            on_load_next={load_next}
          />
        )}
      </table>
    </div>
  );
}
