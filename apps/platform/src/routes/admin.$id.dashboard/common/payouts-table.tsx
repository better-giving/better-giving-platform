import { EmptyRow, LoadMoreRow } from "@better-giving/ui";
import { format } from "date-fns";
import { ArrowRightIcon } from "lucide-react";
import {
  amount_cls,
  arrow_cls,
  PayoutStatusCell,
} from "#/components/returned-payout";
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
      <table className="table">
        <thead>
          <tr>
            <th />
            <th>Amount</th>
            <th>From</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <EmptyRow col_span={5}>No payouts yet</EmptyRow>
          )}
          {items.map((payout, idx) => (
            <tr key={idx}>
              <td className="w-8">
                <ArrowRightIcon
                  className={`inline ${arrow_cls(payout)} icon-sm`}
                />
              </td>
              <td>
                <span className={amount_cls(payout)}>
                  ${humanize(payout.amount)}
                </span>
              </td>
              <td>{desc(payout)}</td>
              <td>{format(payout.date, "PP")}</td>
              <td>
                <PayoutStatusCell payout={payout} />
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
