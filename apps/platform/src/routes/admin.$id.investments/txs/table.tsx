import { EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { Arrow, Content, Tooltip } from "@better-giving/ui/tooltip";
import { format } from "date-fns";
import { ArrowRight, InfoIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { IPaginator } from "#/types/components";
import type { IBalanceTx } from "@/balance-txs";
import { humanize } from "@/helpers/decimal";
import { row_meta } from "./row-meta";

export interface Props extends IPaginator<IBalanceTx> {}

export function FlowIcon(this_account: string, data: IBalanceTx): ReactNode {
  if (data.account === this_account) {
    return <ArrowRight className="text-success icon-md" />;
  }
}

export function Table({
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
            {/* icon and description: no header, and no width of their own
                when there are no rows, so Amount leads an empty table */}
            <th className="w-0 p-0" />
            <th className="w-0 p-0" />
            <th>Amount</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <EmptyRow col_span={5}>No transactions yet</EmptyRow>
          )}
          {items.map((r, idx) => (
            <tr key={idx} className="text-sm">
              <td>{row_meta(r).icon}</td>
              <td className="whitespace-nowrap">{row_meta(r).description}</td>
              <td>
                <div className="relative">
                  {r.status === "cancelled" && (
                    <span className="absolute -left-5 top-0.5 flex">
                      <Tooltip
                        tip={
                          <Content className="max-w-xs text-xs">
                            <Arrow />
                            Transaction request was cancelled and will not be
                            processed.
                          </Content>
                        }
                      >
                        <InfoIcon className="text-gray-11 icon-sm" />
                      </Tooltip>
                    </span>
                  )}
                  ${humanize(r.amount)}{" "}
                </div>
              </td>
              <td className="whitespace-nowrap">
                {format(r.date_updated, "PP")}
              </td>

              <td className="text-xs">
                {r.status === "cancelled" ? (
                  <span className="text-destructive-subtle-fg">Cancelled</span>
                ) : r.status === "pending" ? (
                  <span className="text-warning-subtle-fg">Pending</span>
                ) : (
                  <span className="text-success-subtle-fg">Final</span>
                )}
              </td>
            </tr>
          ))}
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
