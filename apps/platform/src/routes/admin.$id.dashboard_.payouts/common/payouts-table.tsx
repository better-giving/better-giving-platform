import { EmptyRow, LoadMoreRow, PayoutStatus } from "@better-giving/ui";
import { format } from "date-fns";
import { ArrowRightIcon } from "lucide-react";
import type { IPaginator } from "#/types/components";
import { humanize } from "@/helpers/decimal";
import type { IPayout } from "@/payouts";
import { desc } from "./desc";

export interface IPayoutsTable extends IPaginator<IPayout> {}

export function PayoutsTable({
  items,
  classes = "",
  disabled,
  loading,
  load_next,
}: IPayoutsTable) {
  return (
    <div className={`${classes} table-scroll`}>
      <table className="table plain-zero-table">
        <thead>
          <tr>
            {/* icon: no header, and no width when there are no rows */}
            <th className="w-0 p-0" />
            <th>Amount</th>
            <th>From</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow col_span={5}>No payouts yet</EmptyRow>
          ) : (
            items.map((payout, idx) => (
              <tr key={idx}>
                <td className="w-8">
                  <ArrowRightIcon className="inline stroke-success icon-sm" />
                </td>
                <td>
                  <span
                    className={
                      payout.type === "refunded"
                        ? "line-through text-destructive-subtle-fg"
                        : ""
                    }
                  >
                    ${humanize(payout.amount)}
                  </span>
                </td>
                <td>{desc(payout)}</td>
                <td className="whitespace-nowrap">
                  {format(payout.date, "PP")}
                </td>
                <td>
                  <PayoutStatus type={payout.type} />
                </td>
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
